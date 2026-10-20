import type { Container } from '../container.js';
import type { MatchDoc } from '../db/collections.js';
import type { StandingRow } from '../competition/engine/index.js';

type Res = 'W' | 'L' | 'D';
const playedAt = (m: MatchDoc) => m.run?.endedAt ?? m.updatedAt;

/**
 * RANK-007/008 career read model, computed from final official results only (never from provisional or declared
 * data). A player's record follows their roster presence in sides of that time; a team's record follows the
 * participations whose snapshot carries the team id, so later roster moves or renames never rewrite it.
 */
export class CareerService {
  constructor(private readonly ct: Container) {}
  private get c() {
    return this.ct.c;
  }

  private result(m: MatchDoc, side: number): Res | null {
    const o = m.outcome;
    if (!o) return null;
    if (o.kind === 'draw') return 'D';
    if (o.kind === 'win') return o.winnerSide === side ? 'W' : 'L';
    if (o.kind === 'placements') {
      const pid = m.sides[side]?.participationId ?? m.participantIds?.[side];
      const pl = o.placements.find((p) => p.id === pid)?.placement;
      return pl === undefined ? null : pl === 1 ? 'W' : 'L';
    }
    return null;
  }

  private async rows(matches: MatchDoc[], sideOf: (m: MatchDoc) => number) {
    const events = new Map((await this.c.events.find({ _id: { $in: [...new Set(matches.map((m) => m.eventId))] } }, { projection: { name: 1 } }).toArray()).map((e) => [e._id, e.name]));
    const games = new Map((await this.c.disciplines.find({ _id: { $in: [...new Set(matches.map((m) => m.disciplineId))] } }, { projection: { gameId: 1 } }).toArray()).map((d) => [d._id, d.gameId]));
    return matches
      .map((m) => {
        const side = sideOf(m);
        const r = side >= 0 ? this.result(m, side) : null;
        if (!r) return null;
        const opp = m.sides.filter((_, i) => i !== side).map((s) => s.displayName).join('، ');
        return { matchId: m._id, eventId: m.eventId, eventName: events.get(m.eventId) ?? '', gameId: games.get(m.disciplineId) ?? '', opponent: opp, result: r, forfeit: m.outcome?.kind === 'win' && m.outcome.forfeit, at: playedAt(m) };
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
      .sort((a, b) => b.at.localeCompare(a.at));
  }
  /** Per-game totals (the profile record contract). */
  byGame(items: Array<{ result: Res; gameId: string }>) {
    const out = new Map<string, { gameId: string; played: number; wins: number; losses: number; draws: number }>();
    for (const i of items) {
      const g = out.get(i.gameId) ?? { gameId: i.gameId, played: 0, wins: 0, losses: 0, draws: 0 };
      g.played++;
      if (i.result === 'W') g.wins++;
      else if (i.result === 'L') g.losses++;
      else g.draws++;
      out.set(i.gameId, g);
    }
    return [...out.values()];
  }
  private totals(items: Array<{ result: Res }>) {
    return { played: items.length, wins: items.filter((i) => i.result === 'W').length, losses: items.filter((i) => i.result === 'L').length, draws: items.filter((i) => i.result === 'D').length };
  }

  async player(principalId: string) {
    const ms = await this.c.matches.find({ state: 'final', principalIds: principalId }).sort({ updatedAt: -1 }).limit(500).toArray();
    const items = await this.rows(ms, (m) => m.sides.findIndex((s) => s.roster.some((r) => r.principalId === principalId && r.present !== false)));
    return { ...this.totals(items), byGame: this.byGame(items), items: items.slice(0, 50) };
  }

  async team(teamId: string) {
    const parts = await this.c.participations.find({ 'snapshot.teamId': teamId }).toArray();
    const ids = parts.map((p) => p._id);
    const ms = ids.length ? await this.c.matches.find({ state: 'final', participantIds: { $in: ids } }).sort({ updatedAt: -1 }).limit(500).toArray() : [];
    const items = await this.rows(ms, (m) => m.sides.findIndex((s) => ids.includes(s.participationId)));
    // final placements per event (last stage's final standing)
    const standings = [];
    for (const p of parts) {
      const stage = await this.c.stages.find({ disciplineId: p.disciplineId, state: 'finished' }).sort({ order: -1 }).limit(1).next();
      const rv = stage ? await this.c.resultVersions.find({ targetType: 'standing', targetId: stage._id, 'data.final': true }).sort({ version: -1 }).limit(1).next() : null;
      const row = ((rv?.data['rows'] as StandingRow[] | undefined) ?? []).find((r) => r.id === p._id);
      if (!row) continue;
      const ev = await this.c.events.findOne({ _id: p.eventId }, { projection: { name: 1 } });
      standings.push({ eventId: p.eventId, eventName: ev?.name ?? '', nameAtTime: p.snapshot.displayName, place: row.rank, of: ((rv!.data['rows'] as StandingRow[]) ?? []).length, points: Number(row.metrics['points'] ?? row.metrics['total_points'] ?? 0) });
    }
    return { ...this.totals(items), items: items.slice(0, 50), standings };
  }

  /** Head-to-head between two players or two teams (kind decides how sides are matched). */
  async headToHead(kind: 'player' | 'team', a: string, b: string) {
    let ms: MatchDoc[];
    let sideOf: (m: MatchDoc, who: string) => number;
    if (kind === 'player') {
      ms = await this.c.matches.find({ state: 'final', principalIds: { $all: [a, b] } }).limit(500).toArray();
      sideOf = (m, who) => m.sides.findIndex((s) => s.roster.some((r) => r.principalId === who));
    } else {
      const pa = (await this.c.participations.find({ 'snapshot.teamId': a }, { projection: { _id: 1 } }).toArray()).map((p) => p._id);
      const pb = (await this.c.participations.find({ 'snapshot.teamId': b }, { projection: { _id: 1 } }).toArray()).map((p) => p._id);
      ms = pa.length && pb.length ? await this.c.matches.find({ state: 'final', $and: [{ participantIds: { $in: pa } }, { participantIds: { $in: pb } }] }).limit(500).toArray() : [];
      sideOf = (m, who) => m.sides.findIndex((s) => (who === a ? pa : pb).includes(s.participationId));
    }
    ms = ms.filter((m) => sideOf(m, a) >= 0 && sideOf(m, b) >= 0 && sideOf(m, a) !== sideOf(m, b));
    const items = await this.rows(ms, (m) => sideOf(m, a));
    return { a, b, ...this.totals(items), items: items.slice(0, 50) };
  }
}
