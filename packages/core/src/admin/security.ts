import type { Container } from '../container.js';
import { sealedWithCurrent, seal, unseal } from '../identity/crypto.js';

/**
 * SEC-006 secret rotation. After APP_SECRET changes (old value moved to APP_SECRET_PREVIOUS), this re-seals every
 * stored encrypted secret under the current key so the old one can be retired. Sessions and signed links are
 * derived from the secret and end at rotation by design: people sign in again; short-lived links expire.
 * Idempotent and safe to rerun.
 */
export async function rotateSealedSecrets(ct: Container, actor: string, requestId: string): Promise<{ totp: number; partners: number; webhooks: number; failed: number }> {
  await ct.acl.require(actor, 'platform.settings', { type: 'site', id: 'site' }, requestId);
  const key = ct.config.appSecret;
  const out = { totp: 0, partners: 0, webhooks: 0, failed: 0 };
  const redo = async (boxed: string | null | undefined): Promise<string | null> => {
    if (!boxed || sealedWithCurrent(key, boxed)) return null;
    try {
      return seal(key, unseal(key, boxed));
    } catch {
      out.failed++;
      return null;
    }
  };
  for (const cred of await ct.c.credentials.find({ $or: [{ 'totp.secretEnc': { $ne: null } }, { 'totp.pendingSecretEnc': { $ne: null } }] }, { projection: { totp: 1 } }).toArray()) {
    const a = await redo(cred.totp.secretEnc);
    const b = await redo(cred.totp.pendingSecretEnc);
    if (a || b) {
      await ct.c.credentials.updateOne({ _id: cred._id }, { $set: { ...(a ? { 'totp.secretEnc': a } : {}), ...(b ? { 'totp.pendingSecretEnc': b } : {}) } });
      out.totp++;
    }
  }
  for (const p of await ct.c.partnerClients.find({}).toArray()) {
    const s = await redo(p.secretEnc);
    if (s) {
      await ct.c.partnerClients.updateOne({ _id: p._id }, { $set: { secretEnc: s } });
      out.partners++;
    }
  }
  for (const w of await ct.c.webhooks.find({}).toArray()) {
    const s = await redo(w.secretEnc);
    if (s) {
      await ct.c.webhooks.updateOne({ _id: w._id }, { $set: { secretEnc: s } });
      out.webhooks++;
    }
  }
  await ct.audit.append({ actorPrincipalId: actor, action: 'security.rotate_secrets', target: { type: 'secrets', id: 'sealed' }, scope: { type: 'site', id: 'site' }, outcome: out.failed ? 'failed' : 'success', details: { ...out }, requestId });
  return out;
}
