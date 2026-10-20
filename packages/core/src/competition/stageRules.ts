import { createHash } from 'node:crypto';
import { DomainError } from '@esp/contracts';
import type { Container } from '../container.js';
import type { DisciplineDoc, MatchDoc, StageDoc } from '../db/collections.js';
import type { MatchConfig } from '../db/collections-esp04.js';
import { checkSettings } from '../rules/rules.js';
import type { RuleValues } from './engine/rules.js';

type Value = string | number | boolean | Array<string | number> | null;

/**
 * Rule values for a stage = the discipline's frozen rules snapshot (accepted by participants) + the organizer's stage
 * settings, which may only touch configurable clauses inside their bounds (RULE-010, FMT-002). Nothing else feeds the
 * engine: no platform-wide defaults (IMPLEMENTATION_DECISIONS §3).
 */
export async function stageRuleValues(ct: Container, stage: StageDoc, discipline: DisciplineDoc): Promise<{ values: RuleValues; hash: string }> {
  const snap = discipline.rulesSnapshot;
  if (!snap) throw new DomainError('PRECONDITION_FAILED', 'the discipline has no frozen rules snapshot; publish the event first');
  const values: RuleValues = {};
  for (const c of snap.clauses) if (c.kind !== 'human_review') values[c.key] = c.value;
  const settings = stage.settings ?? {};
  if (Object.keys(settings).length) {
    const pkg = await ct.c.rulesPackages.findOne({ _id: snap.packageId }, { projection: { clauses: 1 } });
    if (!pkg) throw new DomainError('PRECONDITION_FAILED', 'rules package of the snapshot is missing');
    const v = checkSettings(pkg.clauses, settings as Record<string, Value>);
    if (v.length) throw new DomainError('VALIDATION_FAILED', 'stage settings violate the rules package', { violations: v });
    Object.assign(values, settings);
  }
  const hash = createHash('sha256').update(snap.hash).update(JSON.stringify(Object.entries(settings).sort(([a], [b]) => a.localeCompare(b)))).digest('hex');
  return { values, hash };
}

/** Validates organizer stage settings / overrides against the package before they are saved. */
export async function assertSettings(ct: Container, discipline: DisciplineDoc, settings: Record<string, unknown>): Promise<void> {
  const snap = discipline.rulesSnapshot;
  const pkgId = snap?.packageId ?? discipline.config.rulesPackageId;
  if (!pkgId) throw new DomainError('PRECONDITION_FAILED', 'the discipline has no rules package');
  const pkg = await ct.c.rulesPackages.findOne({ _id: pkgId }, { projection: { clauses: 1 } });
  if (!pkg) throw new DomainError('NOT_FOUND', 'rules package not found');
  const v = checkSettings(pkg.clauses, settings as Record<string, Value>);
  if (v.length) throw new DomainError('VALIDATION_FAILED', 'settings violate the rules package', { violations: v });
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/**
 * CFG-001..006: the match configuration shown in the room before play. Stage overrides (e.g. BO5 final, CFG-005)
 * apply by slot key, bracket or round. Missing values are listed in `undecided` — never filled with a default.
 */
export function matchConfig(values: RuleValues, stage: StageDoc, discipline: DisciplineDoc, match: Pick<MatchDoc, 'slot'>, rulesHash: string): MatchConfig {
  const slot = match.slot ?? null;
  let override: string | null = null;
  const v: RuleValues = { ...values };
  for (const o of stage.overrides ?? []) {
    const m = o.match;
    const hit = (m.slotKey ? m.slotKey === slot?.key : true) && (m.bracket ? m.bracket === slot?.bracket : true) && (m.round !== undefined ? m.round === slot?.round : true);
    if (slot && hit) {
      Object.assign(v, o.values);
      override = o.label;
    }
  }
  const timeout = str(v['veto.timeout_action']);
  const onExpiry = str(v['disconnect.on_expiry']);
  const cfg: MatchConfig = {
    gameVersion: discipline.gameVersion,
    mode: discipline.mode,
    serverRegion: str(v['server.region']),
    inputDevices: strs(v['input.devices']),
    crossplay: typeof v['crossplay'] === 'boolean' ? (v['crossplay'] as boolean) : null,
    bestOf: num(v['match.bo']) ?? 0,
    roundsPerMap: num(v['match.rounds_per_map']),
    overtime: str(v['match.overtime']),
    drawAllowed: v['match.draw_allowed'] === true,
    replayRule: str(v['match.replay']),
    winCondition: str(v['match.win_condition']),
    mapPool: strs(v['maps.pool']),
    vetoSequence: strs(v['veto.sequence']),
    turnSeconds: num(v['veto.turn_seconds']),
    timeoutAction: timeout === 'pool_order_first' || timeout === 'pool_order_last' || timeout === 'referee' ? timeout : null,
    sideRule: str(v['side.rule']),
    characterBans: num(v['characters.bans']) ?? 0,
    restrictions: strs(v['restrictions']),
    pauses: { tacticalPerSide: num(v['pause.tactical_per_side']), tacticalSeconds: num(v['pause.tactical_seconds']), technicalPerSide: num(v['pause.technical_per_side']), technicalSeconds: num(v['pause.technical_seconds']) },
    disconnect: { returnSeconds: num(v['disconnect.return_seconds']), onExpiry: onExpiry === 'forfeit_map' || onExpiry === 'forfeit_match' || onExpiry === 'referee' || onExpiry === 'continue_short' ? onExpiry : null },
    undecided: [],
    source: { rulesHash, stageId: stage._id, override },
  };
  const need: Array<[string, boolean]> = [
    ['match.bo', cfg.bestOf > 0],
    ['pause.tactical_per_side', cfg.pauses.tacticalPerSide !== null],
    ['pause.technical_per_side', cfg.pauses.technicalPerSide !== null],
    ['disconnect.return_seconds', cfg.disconnect.returnSeconds !== null],
    ['disconnect.on_expiry', cfg.disconnect.onExpiry !== null],
  ];
  if (cfg.vetoSequence.length) need.push(['maps.pool', cfg.mapPool.length > 0], ['veto.turn_seconds', cfg.turnSeconds !== null], ['veto.timeout_action', cfg.timeoutAction !== null]);
  cfg.undecided = need.filter(([, ok]) => !ok).map(([k]) => k);
  return cfg;
}
