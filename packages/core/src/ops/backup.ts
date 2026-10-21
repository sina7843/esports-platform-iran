import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, mkdir, open, readdir, readFile, stat, writeFile, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { BSON, MongoClient, type Db, type Document, type IndexDescription } from 'mongodb';
import { DomainError } from '@esp/contracts';
import type { Container } from '../container.js';
import { newId } from '../ids.js';

/**
 * OPS-004/005 encrypted logical backup. A backup is a directory in an independent target (another disk/host mount,
 * never under DATA_DIR): one AES-256-GCM encrypted, gzip-compressed NDJSON file per collection, every stored file
 * object, index specifications, and a manifest whose HMAC (backup key) detects tampering. The key comes from the
 * environment (BACKUP_ENCRYPTION_KEY); it is never written next to the data.
 * ponytail: full logical dump per run. RPO ≤ 15 min then needs a run interval + duration under 15 min — the drill
 * measures that; beyond the measured size, switch to oplog/incremental snapshots.
 */
const { EJSON } = BSON;
const SKIP = new Set(['system.profile']);
const key32 = (key: string) => Buffer.from(hkdfSync('sha256', key, 'esp-backup-salt-v1', 'esp-backup-v1', 32));

export interface BackupManifest {
  format: 'esp-backup-v1';
  id: string;
  startedAt: string;
  finishedAt: string;
  sourceDb: string;
  collections: Array<{ name: string; documents: number; file: string; sha256: string; bytes: number; indexes: IndexDescription[] }>;
  files: Array<{ visibility: 'private' | 'public'; key: string; file: string; sha256: string; bytes: number }>;
  totals: { documents: number; files: number; bytes: number };
  hmac?: string;
}

async function encryptTo(path: string, source: Readable, key: string): Promise<{ sha256: string; bytes: number }> {
  await mkdir(dirname(path), { recursive: true });
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key32(key), iv);
  const out = createWriteStream(path, { mode: 0o600 });
  out.write(iv);
  await pipeline(source, createGzip(), c, out, { end: false });
  out.end(c.getAuthTag());
  await new Promise<void>((res, rej) => out.on('finish', res).on('error', rej));
  const h = createHash('sha256');
  for await (const ch of createReadStream(path)) h.update(ch as Buffer);
  return { sha256: h.digest('hex'), bytes: (await stat(path)).size };
}
async function decryptFrom(path: string, key: string): Promise<Readable> {
  const size = (await stat(path)).size;
  if (size < 28) throw new DomainError('VALIDATION_FAILED', `backup file too short: ${path}`);
  const fh = await open(path, 'r');
  const iv = Buffer.alloc(12);
  const tag = Buffer.alloc(16);
  await fh.read(iv, 0, 12, 0);
  await fh.read(tag, 0, 16, size - 16);
  await fh.close();
  const d = createDecipheriv('aes-256-gcm', key32(key), iv);
  d.setAuthTag(tag);
  const out = new PassThrough();
  pipeline(createReadStream(path, { start: 12, end: size - 17 }), d, createGunzip(), out).catch((e) => out.destroy(e as Error));
  return out;
}
const sha = async (path: string) => {
  const h = createHash('sha256');
  for await (const ch of createReadStream(path)) h.update(ch as Buffer);
  return h.digest('hex');
};
const sign = (m: BackupManifest, key: string) => createHmac('sha256', key32(key)).update(JSON.stringify({ ...m, hmac: undefined })).digest('hex');

async function* walk(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}

export async function createBackup(ct: Container, opts: { targetDir: string; key: string; label?: string }): Promise<{ dir: string; manifest: BackupManifest }> {
  const target = resolve(opts.targetDir);
  const data = resolve(ct.config.DATA_DIR);
  if (target === data || target.startsWith(data + sep) || data.startsWith(target + sep)) throw new DomainError('PRECONDITION_FAILED', 'the backup target must be outside the data directory (independent failure domain)');
  if (opts.key.length < 32) throw new DomainError('PRECONDITION_FAILED', 'the backup key must be at least 32 characters');
  const startedAt = new Date().toISOString();
  const id = `bak_${startedAt.replace(/[-:.TZ]/g, '').slice(0, 14)}_${newId().slice(-6)}`;
  const dir = join(target, id);
  await mkdir(dir, { recursive: true });
  const db = ct.dbh.db;
  const manifest: BackupManifest = { format: 'esp-backup-v1', id, startedAt, finishedAt: '', sourceDb: db.databaseName, collections: [], files: [], totals: { documents: 0, files: 0, bytes: 0 } };
  const record = { _id: id, startedAt, finishedAt: null as string | null, target: opts.label ?? 'default', file: id, sizeBytes: 0, collections: 0, documents: 0, encrypted: true, ok: false, error: null as string | null };
  try {
    for (const info of await db.listCollections({}, { nameOnly: true }).toArray()) {
      if (SKIP.has(info.name) || info.name.startsWith('system.')) continue;
      const col = db.collection(info.name);
      let n = 0;
      const gen = async function* () {
        for await (const doc of col.find({})) {
          n++;
          yield EJSON.stringify(doc as Document, { relaxed: false }) + '\n';
        }
      };
      const file = `db/${info.name}.ndjson.enc`;
      const r = await encryptTo(join(dir, file), Readable.from(gen()), opts.key);
      manifest.collections.push({ name: info.name, documents: n, file, sha256: r.sha256, bytes: r.bytes, indexes: (await col.indexes()).filter((i) => i.name !== '_id_') as IndexDescription[] });
      manifest.totals.documents += n;
      manifest.totals.bytes += r.bytes;
    }
    for (const visibility of ['private', 'public'] as const) {
      const root = join(data, `${visibility}-files`);
      for await (const p of walk(root)) {
        const k = relative(root, p).split(sep).join('/');
        const file = `files/${visibility}/${k}.enc`;
        const r = await encryptTo(join(dir, file), createReadStream(p), opts.key);
        manifest.files.push({ visibility, key: k, file, sha256: r.sha256, bytes: r.bytes });
        manifest.totals.files++;
        manifest.totals.bytes += r.bytes;
      }
    }
    manifest.finishedAt = new Date().toISOString();
    manifest.hmac = sign(manifest, opts.key);
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    Object.assign(record, { finishedAt: manifest.finishedAt, sizeBytes: manifest.totals.bytes, collections: manifest.collections.length, documents: manifest.totals.documents, ok: true });
    return { dir, manifest };
  } catch (e) {
    record.error = (e as Error).message.slice(0, 300);
    await rm(dir, { recursive: true, force: true });
    throw e;
  } finally {
    record.finishedAt ??= new Date().toISOString();
    await ct.c.backups.insertOne(record as never).catch(() => undefined);
  }
}

export async function readManifest(dir: string, key: string): Promise<BackupManifest> {
  const m = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as BackupManifest;
  const expected = Buffer.from(sign(m, key));
  const got = Buffer.from(m.hmac ?? '');
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) throw new DomainError('VALIDATION_FAILED', 'backup manifest signature does not match (wrong key or tampered)');
  return m;
}

/** Integrity check without restoring: manifest signature, every file's hash, and a full decrypt/decompress/parse count. */
export async function verifyBackup(dir: string, key: string): Promise<{ ok: boolean; problems: string[]; collections: number; documents: number; files: number }> {
  const problems: string[] = [];
  let m: BackupManifest;
  try {
    m = await readManifest(dir, key);
  } catch (e) {
    return { ok: false, problems: [(e as Error).message], collections: 0, documents: 0, files: 0 };
  }
  let documents = 0;
  for (const c of m.collections) {
    const p = join(dir, c.file);
    if ((await sha(p).catch(() => 'missing')) !== c.sha256) {
      problems.push(`hash mismatch: ${c.file}`);
      continue;
    }
    let n = 0;
    try {
      let buf = '';
      for await (const ch of await decryptFrom(p, key)) {
        buf += (ch as Buffer).toString('utf8');
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const l of lines) {
          if (!l) continue;
          EJSON.parse(l);
          n++;
        }
      }
      if (buf) {
        EJSON.parse(buf);
        n++;
      }
    } catch (e) {
      problems.push(`unreadable: ${c.file}: ${(e as Error).message}`);
    }
    if (n !== c.documents) problems.push(`count mismatch in ${c.name}: manifest ${c.documents}, file ${n}`);
    documents += n;
  }
  for (const f of m.files) if ((await sha(join(dir, f.file)).catch(() => 'missing')) !== f.sha256) problems.push(`hash mismatch: ${f.file}`);
  return { ok: problems.length === 0, problems, collections: m.collections.length, documents, files: m.files.length };
}

/** Restores into an EMPTY target database (refuses otherwise) and recreates indexes and file objects. */
export async function restoreBackup(opts: { dir: string; key: string; mongoUrl: string; dataDir: string }): Promise<{ db: string; collections: number; documents: number; files: number; ms: number }> {
  const t0 = Date.now();
  const v = await verifyBackup(opts.dir, opts.key);
  if (!v.ok) throw new DomainError('PRECONDITION_FAILED', `backup failed verification: ${v.problems.join('; ')}`);
  const m = await readManifest(opts.dir, opts.key);
  const client = await new MongoClient(opts.mongoUrl).connect();
  try {
    const db: Db = client.db();
    if ((await db.listCollections({}, { nameOnly: true }).toArray()).length) throw new DomainError('PRECONDITION_FAILED', 'the restore target database is not empty');
    for (const c of m.collections) {
      const col = db.collection(c.name);
      let batch: Document[] = [];
      let buf = '';
      const flush = async () => {
        if (batch.length) await col.insertMany(batch, { ordered: false });
        batch = [];
      };
      for await (const ch of await decryptFrom(join(opts.dir, c.file), opts.key)) {
        buf += (ch as Buffer).toString('utf8');
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const l of lines) {
          if (!l) continue;
          batch.push(EJSON.parse(l) as Document);
          if (batch.length >= 1000) await flush();
        }
      }
      if (buf) batch.push(EJSON.parse(buf) as Document);
      await flush();
      if (!c.documents) await db.createCollection(c.name).catch(() => undefined);
      if (c.indexes.length) await col.createIndexes(c.indexes.map((i) => ({ ...i, ns: undefined, v: undefined })) as IndexDescription[]);
    }
    for (const f of m.files) {
      const root = resolve(opts.dataDir, `${f.visibility}-files`);
      const dest = resolve(root, f.key);
      if (!dest.startsWith(root + sep)) throw new DomainError('VALIDATION_FAILED', 'unsafe file key in backup');
      await mkdir(dirname(dest), { recursive: true });
      await pipeline(await decryptFrom(join(opts.dir, f.file), opts.key), createWriteStream(dest, { mode: 0o600 }));
    }
    return { db: db.databaseName, collections: m.collections.length, documents: m.totals.documents, files: m.files.length, ms: Date.now() - t0 };
  } finally {
    await client.close();
  }
}

/**
 * Deletion ledger outside the backups (OPS-003): ids only, no personal data. A restore imports it so data deleted after
 * the backup was taken cannot come back. Written at deletion time, not only at backup time.
 */
export async function appendTombstoneLog(ct: Pick<Container, 'config'>, t: { kind: string; ref: string; at: string; reason: string }): Promise<void> {
  const dir = ct.config.BACKUP_TARGET_DIR;
  if (!dir) return;
  await mkdir(resolve(dir), { recursive: true });
  await appendFile(join(resolve(dir), 'tombstones.ndjson'), `${JSON.stringify(t)}\n`, { mode: 0o600 });
}
export async function importTombstoneLog(ct: Container, targetDir: string): Promise<number> {
  let text: string;
  try {
    text = await readFile(join(resolve(targetDir), 'tombstones.ndjson'), 'utf8');
  } catch {
    return 0;
  }
  let n = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const t = JSON.parse(line) as { kind: 'principal' | 'file'; ref: string; at: string; reason: string };
    const r = await ct.c.tombstones.updateOne({ _id: `${t.kind}:${t.ref}` }, { $setOnInsert: { _id: `${t.kind}:${t.ref}`, ...t } }, { upsert: true });
    if (r.upsertedCount) n++;
  }
  return n;
}

/** Keeps the newest `keep` backups of the target; older full dumps are removed (disk capacity, OPS-006). */
export async function pruneBackups(targetDir: string, keep: number): Promise<number> {
  const names = (await readdir(resolve(targetDir), { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory() && e.name.startsWith('bak_')).map((e) => e.name).sort();
  const old = names.slice(0, Math.max(0, names.length - keep));
  for (const n of old) await rm(join(resolve(targetDir), n), { recursive: true, force: true });
  return old.length;
}
