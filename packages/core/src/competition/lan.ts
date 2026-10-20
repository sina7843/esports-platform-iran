import { randomBytes } from 'node:crypto';
import { DomainError, type Scope } from '@esp/contracts';
import type { Container } from '../container.js';
import type { AccessCredentialDoc, AdmissionDoc, EquipmentDoc, OfflineImportDoc, PersonalEquipmentDoc, StationDoc, VenueDoc } from '../db/collections-esp04.js';
import { newId } from '../ids.js';
import { parseCsv } from '../files/csv.js';
import { CommerceService } from '../finance/commerce.js';
import { MatchResultService } from './results.js';
import { publicMatch } from './room.js';

const iso = () => new Date().toISOString();
const token = () => randomBytes(18).toString('base64url');
/** LAN-004: which areas each access role may enter. Staff may override per credential (recorded on issue). */
export const ROLE_AREAS: Record<AccessCredentialDoc['role'], Array<VenueDoc['areas'][number]['kind']>> = {
  player: ['hall', 'stage', 'warmup'],
  coach: ['hall', 'warmup'],
  media: ['media', 'audience'],
  staff: ['hall', 'stage', 'warmup', 'media', 'audience'],
  spectator: ['audience'],
};

/**
 * LAN-001..007: venue, areas and capacity; stations with network/device checklist, faults and moves; equipment loans;
 * personal equipment approval; role-separated access credentials with rotating single-use QR tokens and atomic
 * admission (a token admits once, two scans of the same token admit once); ticket admission via the ESP-03 order;
 * call-ups and a public hall display; the numbered emergency procedure import for attendance/results after a local
 * network outage, where nothing touches official data without a human decision on every conflicting row.
 */
export class LanService {
  constructor(private readonly ct: Container) {}
  private get c() {
    return this.ct.c;
  }
  private scope(eventId: string): Scope {
    return { type: 'event', id: eventId };
  }
  private async manage(eventId: string, actor: string, requestId: string) {
    await this.ct.acl.require(actor, 'venue.manage', this.scope(eventId), requestId);
  }

  // ------------------------------------------------------------------ venue and stations (LAN-001/003/005)
  async createVenue(eventId: string, input: Omit<VenueDoc, '_id' | 'eventId' | 'createdAt' | 'version'>, actor: string, requestId: string): Promise<VenueDoc> {
    await this.manage(eventId, actor, requestId);
    if (!input.addressText.trim()) throw new DomainError('VALIDATION_FAILED', 'the address text is required (it is the fallback when no map is available)');
    if (new Set(input.areas.map((a) => a.key)).size !== input.areas.length) throw new DomainError('VALIDATION_FAILED', 'area keys must be unique');
    const doc: VenueDoc = { ...input, _id: newId('ven'), eventId, createdAt: iso(), version: 0 };
    await this.c.venues.insertOne(doc);
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'lan.venue.create', target: { type: 'event', id: eventId }, scope: this.scope(eventId), outcome: 'success', details: { venueId: doc._id }, requestId });
    return doc;
  }
  async venues(eventId: string): Promise<VenueDoc[]> {
    return this.c.venues.find({ eventId }).toArray();
  }

  async addStation(venueId: string, areaKey: string, label: string, actor: string, requestId: string): Promise<StationDoc> {
    const v = await this.c.venues.findOne({ _id: venueId });
    if (!v) throw new DomainError('NOT_FOUND', 'venue not found');
    await this.manage(v.eventId, actor, requestId);
    if (!v.areas.some((a) => a.key === areaKey)) throw new DomainError('VALIDATION_FAILED', 'unknown area');
    const doc: StationDoc = { _id: newId('stn'), eventId: v.eventId, venueId, areaKey, label, state: 'maintenance', matchId: null, checklist: [], faults: [], version: 0 };
    await this.c.stations.insertOne(doc);
    return doc;
  }
  async stations(eventId: string): Promise<StationDoc[]> {
    return this.c.stations.find({ eventId }).sort({ label: 1 }).toArray();
  }

  /** LAN-003: a station is ready only when every network/device checklist item is OK. */
  async checklist(stationId: string, items: Array<{ item: string; ok: boolean }>, actor: string, requestId: string): Promise<StationDoc> {
    const s = await this.c.stations.findOne({ _id: stationId });
    if (!s) throw new DomainError('NOT_FOUND', 'station not found');
    await this.manage(s.eventId, actor, requestId);
    if (!items.length) throw new DomainError('VALIDATION_FAILED', 'a checklist needs items');
    const all = items.every((i) => i.ok);
    const r = await this.c.stations.findOneAndUpdate({ _id: stationId, version: s.version }, { $set: { checklist: items.map((i) => ({ ...i, by: actor, at: iso() })), state: s.state === 'in_use' ? 'in_use' : all ? 'ready' : 'maintenance' }, $inc: { version: 1 } }, { returnDocument: 'after' });
    if (!r) throw new DomainError('VERSION_CONFLICT', 'station changed concurrently');
    return r;
  }

  /** LAN-005: report a fault; the station leaves service and the affected match needs a move. */
  async fault(stationId: string, note: string, actor: string, requestId: string): Promise<{ station: StationDoc; affectedMatchId: string | null }> {
    const s = await this.c.stations.findOne({ _id: stationId });
    if (!s) throw new DomainError('NOT_FOUND', 'station not found');
    await this.manage(s.eventId, actor, requestId);
    const r = await this.c.stations.findOneAndUpdate({ _id: stationId }, { $set: { state: 'faulty' }, $push: { faults: { at: iso(), by: actor, note, resolvedAt: null } }, $inc: { version: 1 } }, { returnDocument: 'after' });
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'lan.station.fault', target: { type: 'station', id: stationId }, scope: this.scope(s.eventId), outcome: 'success', details: { note, matchId: s.matchId }, requestId });
    return { station: r!, affectedMatchId: s.matchId };
  }

  /** Assign or move a match to a ready station (atomically claimed; the old station is freed). */
  async assign(matchId: string, stationId: string, reason: string, actor: string, requestId: string): Promise<StationDoc> {
    const m = await this.c.matches.findOne({ _id: matchId });
    if (!m) throw new DomainError('NOT_FOUND', 'match not found');
    await this.manage(m.eventId, actor, requestId);
    const claimed = await this.c.stations.findOneAndUpdate({ _id: stationId, eventId: m.eventId, state: 'ready', matchId: null }, { $set: { state: 'in_use', matchId }, $inc: { version: 1 } }, { returnDocument: 'after' });
    if (!claimed) throw new DomainError('CONFLICT', 'station is not ready or already in use');
    await this.c.stations.updateMany({ matchId, _id: { $ne: stationId } }, { $set: { matchId: null }, $inc: { version: 1 } });
    await this.c.stations.updateMany({ matchId: null, state: 'in_use', eventId: m.eventId, _id: { $ne: stationId } }, { $set: { state: 'ready' } });
    await this.c.matches.updateOne({ _id: matchId }, { $set: { 'resources.stationId': stationId }, $push: { 'schedule.history': { at: iso(), by: actor, from: m.scheduledAt, to: m.scheduledAt, reason: `station ${claimed.label}: ${reason}` } }, $inc: { version: 1 } });
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'lan.station.assign', target: { type: 'match', id: matchId }, scope: this.scope(m.eventId), outcome: 'success', details: { stationId, reason }, requestId });
    return claimed;
  }

  // ------------------------------------------------------------------ equipment (LAN-003)
  async addEquipment(eventId: string, label: string, kind: string, serial: string | null, actor: string, requestId: string): Promise<EquipmentDoc> {
    await this.manage(eventId, actor, requestId);
    const doc: EquipmentDoc = { _id: newId('eqp'), eventId, label, kind, serial, state: 'available', loan: null, history: [], version: 0 };
    await this.c.equipment.insertOne(doc);
    return doc;
  }
  async loan(equipmentId: string, to: string, condition: string, actor: string, requestId: string): Promise<EquipmentDoc> {
    const e = await this.c.equipment.findOne({ _id: equipmentId });
    if (!e) throw new DomainError('NOT_FOUND', 'equipment not found');
    await this.manage(e.eventId, actor, requestId);
    const r = await this.c.equipment.findOneAndUpdate({ _id: equipmentId, state: 'available' }, { $set: { state: 'loaned', loan: { to, at: iso(), by: actor, condition } }, $push: { history: { at: iso(), by: actor, action: 'loan', to, note: condition } }, $inc: { version: 1 } }, { returnDocument: 'after' });
    if (!r) throw new DomainError('CONFLICT', `equipment is ${e.state}`);
    return r;
  }
  async returnEquipment(equipmentId: string, condition: string, faulty: boolean, actor: string, requestId: string): Promise<EquipmentDoc> {
    const e = await this.c.equipment.findOne({ _id: equipmentId });
    if (!e) throw new DomainError('NOT_FOUND', 'equipment not found');
    await this.manage(e.eventId, actor, requestId);
    const r = await this.c.equipment.findOneAndUpdate({ _id: equipmentId, state: 'loaned' }, { $set: { state: faulty ? 'faulty' : 'available', loan: null }, $push: { history: { at: iso(), by: actor, action: faulty ? 'fault' : 'return', to: null, note: condition } }, $inc: { version: 1 } }, { returnDocument: 'after' });
    if (!r) throw new DomainError('CONFLICT', 'equipment is not on loan');
    return r;
  }
  async equipmentList(eventId: string, actor: string, requestId: string): Promise<EquipmentDoc[]> {
    await this.manage(eventId, actor, requestId);
    return this.c.equipment.find({ eventId }).sort({ label: 1 }).toArray();
  }
  async requestPersonal(eventId: string, item: string, actor: string): Promise<PersonalEquipmentDoc> {
    if (item.trim().length < 2) throw new DomainError('VALIDATION_FAILED', 'describe the item');
    const doc: PersonalEquipmentDoc = { _id: newId('peq'), eventId, principalId: actor, item: item.trim(), state: 'pending', decidedBy: null, note: null, createdAt: iso() };
    await this.c.personalEquipment.insertOne(doc);
    return doc;
  }
  async decidePersonal(id: string, approve: boolean, note: string, actor: string, requestId: string): Promise<PersonalEquipmentDoc> {
    const d = await this.c.personalEquipment.findOne({ _id: id });
    if (!d) throw new DomainError('NOT_FOUND', 'request not found');
    await this.manage(d.eventId, actor, requestId);
    const r = await this.c.personalEquipment.findOneAndUpdate({ _id: id, state: 'pending' }, { $set: { state: approve ? 'approved' : 'rejected', decidedBy: actor, note } }, { returnDocument: 'after' });
    if (!r) throw new DomainError('ILLEGAL_TRANSITION', 'already decided');
    return r;
  }

  // ------------------------------------------------------------------ credentials and admission (LAN-002/004/006)
  async issueCredential(eventId: string, principalId: string, role: AccessCredentialDoc['role'], areas: string[] | null, actor: string, requestId: string): Promise<AccessCredentialDoc> {
    await this.manage(eventId, actor, requestId);
    const venues = await this.venues(eventId);
    const allowedKinds = ROLE_AREAS[role];
    const defaults = venues.flatMap((v) => v.areas.filter((a) => allowedKinds.includes(a.kind)).map((a) => a.key));
    const doc: AccessCredentialDoc = { _id: newId('acr'), eventId, principalId, role, areas: areas ?? defaults, state: 'active', token: token(), tokenIssuedAt: iso(), issuedBy: actor, createdAt: iso(), version: 0 };
    try {
      await this.c.accessCredentials.insertOne(doc);
    } catch (e) {
      if ((e as { code?: number }).code === 11000) throw new DomainError('CONFLICT', 'this person already holds an active credential for that role');
      throw e;
    }
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'lan.credential.issue', target: { type: 'event', id: eventId }, scope: this.scope(eventId), outcome: 'success', details: { principalId, role, areas: doc.areas, custom: !!areas }, requestId });
    return doc;
  }
  async revokeCredential(credentialId: string, actor: string, requestId: string): Promise<void> {
    const cr = await this.c.accessCredentials.findOne({ _id: credentialId });
    if (!cr) throw new DomainError('NOT_FOUND', 'credential not found');
    await this.manage(cr.eventId, actor, requestId);
    await this.c.accessCredentials.updateOne({ _id: credentialId }, { $set: { state: 'revoked', token: `revoked:${token()}` }, $inc: { version: 1 } });
  }
  /** The holder's QR payload. Each display rotates the token, so a photographed code expires as soon as a new one is shown. */
  async myQr(eventId: string, actor: string): Promise<Array<{ credentialId: string; role: string; areas: string[]; qr: string }>> {
    const list = await this.c.accessCredentials.find({ eventId, principalId: actor, state: 'active' }).toArray();
    const out = [];
    for (const cr of list) {
      const t = token();
      await this.c.accessCredentials.updateOne({ _id: cr._id, state: 'active' }, { $set: { token: t, tokenIssuedAt: iso() }, $inc: { version: 1 } });
      out.push({ credentialId: cr._id, role: cr.role, areas: cr.areas, qr: `ESPQR:${t}` });
    }
    return out;
  }

  /**
   * Atomic admission: the token is consumed by a conditional update (and recorded under a unique index), so a replayed or
   * concurrently scanned code admits at most once. Area rules per role are enforced at the gate.
   */
  async admit(eventId: string, qr: string, gate: string, area: string, actor: string, requestId: string): Promise<{ admitted: true; role: string; principalId: string; admission: AdmissionDoc }> {
    await this.ct.acl.require(actor, 'gate.admit', this.scope(eventId), requestId);
    const tok = qr.startsWith('ESPQR:') ? qr.slice(6) : qr;
    const cr = await this.c.accessCredentials.findOneAndUpdate({ eventId, token: tok, state: 'active' }, { $set: { token: token(), tokenIssuedAt: iso() }, $inc: { version: 1 } }, { returnDocument: 'before' });
    if (!cr) {
      await this.ct.audit.append({ actorPrincipalId: actor, action: 'lan.admit.denied', target: { type: 'event', id: eventId }, scope: this.scope(eventId), outcome: 'denied', details: { gate, area, reason: 'invalid, used or revoked code' }, requestId });
      throw new DomainError('FORBIDDEN', 'invalid, already used or revoked code');
    }
    if (!cr.areas.includes(area)) throw new DomainError('FORBIDDEN', `a ${cr.role} credential does not open area "${area}"`);
    const adm: AdmissionDoc = { _id: newId('adm'), eventId, kind: 'credential', ref: cr._id, token: tok, gate, area, principalId: cr.principalId, by: actor, at: iso(), direction: 'in' };
    try {
      await this.c.admissions.insertOne(adm);
    } catch (e) {
      if ((e as { code?: number }).code === 11000) throw new DomainError('FORBIDDEN', 'code already used');
      throw e;
    }
    return { admitted: true, role: cr.role, principalId: cr.principalId, admission: adm };
  }

  /** LAN-006: spectator ticket at the gate — the ESP-03 ticket admits once; capacity of the area is checked. */
  async admitTicket(eventId: string, code: string, gate: string, area: string, actor: string, requestId: string): Promise<AdmissionDoc> {
    await this.ct.acl.require(actor, 'gate.admit', this.scope(eventId), requestId);
    const venue = (await this.venues(eventId)).find((v) => v.areas.some((a) => a.key === area));
    const cap = venue?.areas.find((a) => a.key === area)?.capacity ?? null;
    if (cap !== null && (await this.c.admissions.countDocuments({ eventId, area, direction: 'in' })) >= cap) throw new DomainError('PRECONDITION_FAILED', `area "${area}" is at capacity`);
    const t = await new CommerceService(this.ct).useTicket(code, actor, requestId);
    const adm: AdmissionDoc = { _id: newId('adm'), eventId, kind: 'ticket', ref: t._id, token: `ticket:${code}`, gate, area, principalId: null, by: actor, at: iso(), direction: 'in' };
    await this.c.admissions.insertOne(adm);
    return adm;
  }

  // ------------------------------------------------------------------ call-up and hall display (LAN-002/005)
  async callUp(matchId: string, actor: string, requestId: string) {
    const m = await this.c.matches.findOne({ _id: matchId });
    if (!m) throw new DomainError('NOT_FOUND', 'match not found');
    await this.manage(m.eventId, actor, requestId);
    const doc = { _id: matchId, eventId: m.eventId, stationIds: m.resources?.stationId ? [m.resources.stationId] : [], state: 'called' as const, calledAt: iso(), by: actor };
    await this.c.callups.updateOne({ _id: matchId }, { $set: doc }, { upsert: true });
    if (m.principalIds?.length) await this.ct.realtime.publish({ channel: 'notifications', type: 'lan.callup', audience: { kind: 'principals', principalIds: m.principalIds }, payload: { matchId } });
    await this.ct.realtime.publish({ channel: `event:${m.eventId}:public`, type: 'lan.callup', audience: { kind: 'public' }, payload: { matchId } });
    return doc;
  }
  async setCallupState(matchId: string, state: 'at_station' | 'ready', actor: string, requestId: string) {
    const cu = await this.c.callups.findOne({ _id: matchId });
    if (!cu) throw new DomainError('NOT_FOUND', 'match was not called up');
    await this.manage(cu.eventId, actor, requestId);
    await this.c.callups.updateOne({ _id: matchId }, { $set: { state } });
  }

  /** Public hall screen: schedule, live and called matches, recent final results — public serializer only. */
  async hallDisplay(eventId: string) {
    const now = Date.now();
    const ms = await this.c.matches.find({ eventId, state: { $ne: 'cancelled' } }, { projection: { lobby: 0 } }).sort({ scheduledAt: 1 }).limit(1000).toArray();
    const stations = new Map((await this.c.stations.find({ eventId }).toArray()).map((s) => [s._id, s.label]));
    const callups = new Map((await this.c.callups.find({ eventId }).toArray()).map((c) => [c._id, c.state]));
    const view = (m: (typeof ms)[number]) => ({ ...publicMatch(m), stationLabel: m.resources?.stationId ? (stations.get(m.resources.stationId) ?? null) : null, callup: callups.get(m._id) ?? null });
    return {
      serverTime: new Date(now).toISOString(),
      live: ms.filter((m) => ['live', 'paused'].includes(m.state)).map(view),
      called: ms.filter((m) => callups.has(m._id) && !['final', 'live'].includes(m.state)).map(view),
      upcoming: ms.filter((m) => m.scheduledAt && Date.parse(m.scheduledAt) >= now - 15 * 60_000 && ['scheduled', 'awaiting_readiness', 'ready', 'awaiting_sides'].includes(m.state)).slice(0, 20).map(view),
      results: ms.filter((m) => m.state === 'final').sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1)).slice(0, 20).map(view),
    };
  }

  // ------------------------------------------------------------------ emergency offline import (LAN-007)
  /**
   * Rows from the numbered paper procedure (EP-xx). Attendance rows: credentialId|principalId, gate, area, at.
   * Result rows: matchId, winnerSide (0/1), scoreA, scoreB, recordedBy. Every row is classified; nothing is applied yet.
   */
  async importOffline(eventId: string, procedureNo: string, kind: 'attendance' | 'result', csv: Buffer, actor: string, requestId: string): Promise<OfflineImportDoc> {
    await this.manage(eventId, actor, requestId);
    if (!/^EP-\d{2,3}$/.test(procedureNo)) throw new DomainError('VALIDATION_FAILED', 'procedure number must look like EP-01 (see the LAN operations guide)');
    const parsed = parseCsv(csv);
    const rows: OfflineImportDoc['rows'] = [];
    for (const [i, r] of parsed.rows.entries()) {
      const data = Object.fromEntries(parsed.header.map((h, j) => [h, r[j] ?? '']));
      let status: OfflineImportDoc['rows'][number]['status'] = 'pending';
      let conflict: string | null = null;
      if (kind === 'result') {
        const m = await this.c.matches.findOne({ _id: data['matchId'] ?? '', eventId });
        if (!m) { status = 'rejected'; conflict = 'unknown match'; }
        else if (!['0', '1'].includes(data['winnerSide'] ?? '')) { status = 'rejected'; conflict = 'winnerSide must be 0 or 1'; }
        else if (m.state === 'final') {
          const same = m.outcome?.kind === 'win' && String(m.outcome.winnerSide) === data['winnerSide'];
          status = same ? 'applied' : 'conflict';
          conflict = same ? 'already final with the same winner (no change)' : `official result already final with a different winner (${m.outcome?.kind === 'win' ? m.outcome.winnerSide : m.outcome?.kind})`;
        }
      } else {
        const cr = await this.c.accessCredentials.findOne({ eventId, $or: [{ _id: data['credentialId'] ?? '' }, { principalId: data['principalId'] ?? '' }] });
        if (!cr) { status = 'rejected'; conflict = 'no credential for this person'; }
        else if (Number.isNaN(Date.parse(data['at'] ?? ''))) { status = 'rejected'; conflict = 'time must be an ISO instant'; }
        else if (!cr.areas.includes(data['area'] ?? '')) { status = 'conflict'; conflict = `${cr.role} credential does not open area ${data['area']}`; }
      }
      rows.push({ row: i + 2, data, status, conflict, decidedBy: null });
    }
    const doc: OfflineImportDoc = { _id: newId('ofi'), eventId, procedureNo, kind, rows, createdBy: actor, createdAt: iso(), state: 'pending' };
    await this.c.offlineImports.insertOne(doc);
    for (const r of rows.filter((x) => x.status === 'conflict')) await this.c.reviewItems.insertOne({ _id: newId('rvw'), eventId, kind: 'offline_conflict', ref: { type: 'offline_import', id: doc._id }, detail: { row: r.row, conflict: r.conflict, data: r.data, procedureNo }, state: 'open', resolution: null, resolvedBy: null, createdAt: iso(), resolvedAt: null });
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'lan.offline.import', target: { type: 'event', id: eventId }, scope: this.scope(eventId), outcome: 'success', details: { procedureNo, kind, rows: rows.length, conflicts: rows.filter((r) => r.status === 'conflict').length }, requestId });
    return doc;
  }

  /**
   * A human applies or rejects rows. Pending rows become official through the normal paths (admission record, official
   * result via the result service). A conflicting row can only be rejected here or resolved through its review item.
   */
  async decideOffline(importId: string, decisions: Array<{ row: number; apply: boolean }>, actor: string, requestId: string): Promise<OfflineImportDoc> {
    const imp = await this.c.offlineImports.findOne({ _id: importId });
    if (!imp) throw new DomainError('NOT_FOUND', 'import not found');
    // results become official only by result authority (referee); attendance by venue staff
    if (imp.kind === 'result') await this.ct.acl.require(actor, 'match.result.verify', this.scope(imp.eventId), requestId);
    else await this.manage(imp.eventId, actor, requestId);
    const results = new MatchResultService(this.ct);
    const rows = [...imp.rows];
    for (const d of decisions) {
      const r = rows.find((x) => x.row === d.row);
      if (!r || (r.status !== 'pending' && !(r.status === 'conflict' && !d.apply))) continue;
      if (!d.apply) { r.status = 'rejected'; r.decidedBy = actor; continue; }
      if (imp.kind === 'result') {
        const m = (await this.c.matches.findOne({ _id: r.data['matchId']! }))!;
        const side = Number(r.data['winnerSide']) as 0 | 1;
        const scores = r.data['scoreA'] && r.data['scoreB'] ? ([Number(r.data['scoreA']), Number(r.data['scoreB'])] as [number, number]) : null;
        if (!['provisional', 'disputed'].includes(m.state)) {
          r.conflict = `match is ${m.state}; record the result through the match room / referee path first`;
          r.status = 'conflict';
          continue;
        }
        await results.finalize(m._id, { kind: 'win', winnerSide: side, scores, maps: null, forfeit: false, reason: `offline procedure ${imp.procedureNo}` }, actor, requestId);
      } else {
        const cr = (await this.c.accessCredentials.findOne({ eventId: imp.eventId, $or: [{ _id: r.data['credentialId'] ?? '' }, { principalId: r.data['principalId'] ?? '' }] }))!;
        await this.c.admissions.insertOne({ _id: newId('adm'), eventId: imp.eventId, kind: 'credential', ref: cr._id, token: `offline:${imp._id}:${r.row}`, gate: r.data['gate'] ?? 'offline', area: r.data['area'] ?? null, principalId: cr.principalId, by: actor, at: r.data['at']!, direction: 'in' }).catch(() => undefined);
      }
      r.status = 'applied';
      r.decidedBy = actor;
    }
    const state: OfflineImportDoc['state'] = rows.every((x) => x.status === 'applied' || x.status === 'rejected') ? 'applied' : rows.some((x) => x.status === 'applied') ? 'partially_applied' : 'pending';
    await this.c.offlineImports.updateOne({ _id: importId }, { $set: { rows, state } });
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'lan.offline.decide', target: { type: 'event', id: imp.eventId }, scope: this.scope(imp.eventId), outcome: 'success', details: { importId, decisions: decisions.length }, requestId });
    return (await this.c.offlineImports.findOne({ _id: importId }))!;
  }
}
