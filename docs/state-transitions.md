# جدول گذار وضعیت‌ها (ESP-SRS فصل ۱۵)

> این فایل از `packages/contracts/src/states.ts` تولید می‌شود؛ دستی ویرایش نکنید. دستور: `pnpm docs:generate`.

قاعده عمومی: تغییر وضعیت فقط از طریق گذار نام‌دار و با `expectedVersion` (optimistic concurrency) انجام می‌شود. ارسال مقدار دلخواه `status` از API رد می‌شود (`ILLEGAL_TRANSITION`). گذارهای علامت‌خورده با «تأیید دوم» نیازمند تأیید مستقل شخص دیگری با مجوز `approval.decide` هستند (ACL-003).

## رویداد (`event`)

وضعیت آغازین: `draft` (پیش‌نویس)

| وضعیت | برچسب فارسی |
|---|---|
| `draft` | پیش‌نویس |
| `in_review` | در بررسی |
| `published` | منتشرشده |
| `registration_open` | ثبت‌نام باز |
| `registration_closed` | ثبت‌نام بسته |
| `preparing` | آماده‌سازی |
| `active` | فعال |
| `paused` | متوقف |
| `finished` | پایان‌یافته |
| `closed` | بسته‌شده |
| `cancelled` | لغوشده |
| `archived` | آرشیوی |

| گذار | از | به | نقش مجاز | پیش‌شرط | اثر | اعلان | جبران/بازگشت | تأیید دوم |
|---|---|---|---|---|---|---|---|---|
| `submit_for_review` | `draft` | `in_review` | organizer | completeness check passes (EVT-007): rules snapshot, prizes, fees, cancellation and dispute terms present | event locked for editing except by reviewer notes | organizer, platform review queue | return_to_draft | — |
| `return_to_draft` | `in_review` | `draft` | platform_admin, rules_officer, organizer | review notes recorded | editing re-enabled | organizer | none (re-submit) | — |
| `publish` | `in_review`, `draft` | `published` | organizer, platform_admin, system | system only for a schedule set by an authorized organizer (EVT-006), same gate; rules package consistent (RULE-010), organizer authority and limits ok (ADM-004), visibility set (EVT-003) | public page, search indexing per visibility, rules snapshot frozen | followers of organizer/game, scheduled posts | cancel (with refund policy) — unpublish is not silent | — |
| `open_registration` | `published` | `registration_open` | organizer, system | registration window start reached or manual open; capacity and quotas defined | registrations accepted | followers | close_registration | — |
| `close_registration` | `registration_open` | `registration_closed` | organizer, system | deadline reached or manual | no new registrations; waitlist processing continues per policy | pending registrants | reopen_registration (organizer, reason) | — |
| `reopen_registration` | `registration_closed` | `registration_open` | organizer | no stage started; reason recorded | registrations accepted again | waitlist | close_registration | — |
| `start_preparation` | `registration_closed` | `preparing` | organizer, system | minimum participants satisfied or exception approved (15.5 shortage) | draw/schedule tools enabled; roster locks per stage | confirmed participants | reopen_registration | — |
| `activate` | `preparing` | `active` | organizer, event_operator | first stage draw published and schedule confirmed | live center opens; matches may start | participants, staff, followers | pause | — |
| `pause` | `active` | `paused` | organizer, event_operator, head_referee | reason category (outage, forced game update, infrastructure) | all running matches paused; schedule proposals generated (SCH-006) | participants, staff, public status | resume | — |
| `resume` | `paused` | `active` | organizer, event_operator, head_referee | pause reason resolved; rules compatibility re-checked after forced updates | matches resume with recorded pause duration | participants, staff | pause | — |
| `finish` | `active` | `finished` | organizer, system | all stages finished; no provisional results in rank-affecting matches | final standings computed version-stamped | participants, newsroom | reopen handled through result-correction case, not a status rollback | — |
| `close` | `finished` | `closed` | organizer, finance_officer | END-006: all rank-affecting cases resolved; open financial obligations listed | honors, points and quotas applied exactly once (END-004); prizes move to payout workflow | winners, finance | none (corrections use RES-006 case flow with second approval) | بله |
| `archive` | `closed`, `cancelled` | `archived` | organizer, platform_admin, system | retention clock started; media and news linked | read-only archive page (AUD-004) | none | none | — |
| `cancel` | `draft`, `in_review`, `published`, `registration_open`, `registration_closed`, `preparing`, `active`, `paused` | `cancelled` | organizer, platform_admin | reason; refund/ticket/prize disposition chosen (15.5) | registrations → cancelled/refund queue, tickets voided, prizes cancelled | all registrants, ticket holders, staff | none | بله |

## ثبت‌نام (`registration`)

وضعیت آغازین: `draft` (پیش‌نویس)

| وضعیت | برچسب فارسی |
|---|---|
| `draft` | پیش‌نویس |
| `incomplete` | ناقص |
| `awaiting_payment` | انتظار پرداخت |
| `awaiting_review` | انتظار بررسی |
| `awaiting_capacity` | انتظار ظرفیت |
| `confirmed` | تأیید |
| `rejected` | رد |
| `withdrawn` | انصراف |
| `removed` | حذف |

| گذار | از | به | نقش مجاز | پیش‌شرط | اثر | اعلان | جبران/بازگشت | تأیید دوم |
|---|---|---|---|---|---|---|---|---|
| `submit` | `draft`, `incomplete` | `awaiting_review` | player, team_captain, team_manager, team_owner | eligibility checks pass (REG-002), rules version accepted (RULE-006), roster minimum met, capacity reserved atomically (REG-009) and fee is zero | reservation held until review deadline | organizer review queue | withdraw | — |
| `submit_with_fee` | `draft`, `incomplete` | `awaiting_payment` | player, team_captain, team_manager, team_owner | as submit, fee > 0; temporary reservation with expiry (REG-006) | payment intent created | registrant | expire_reservation | — |
| `mark_incomplete` | `awaiting_review` | `incomplete` | organizer, event_operator | reason and missing items listed (REG-004) | reservation kept until fix deadline | registrant | submit | — |
| `payment_confirmed` | `awaiting_payment` | `awaiting_review` | system | server-verified payment matched amount/order (FIN-002); reservation still valid | ledger entry; reservation converted | registrant, organizer | refund via payment machine | — |
| `payment_after_expiry` | `awaiting_payment`, `draft` | `awaiting_capacity` | system | verified payment arrived after reservation expired (REG-010) | explicit decision pending: allocate if capacity exists or refund | organizer, finance, registrant | refund | — |
| `join_waitlist` | `draft` | `awaiting_capacity` | system | quota full at submission; FIFO position recorded (REG-006) | no capacity held; promoted when capacity frees | registrant | withdraw | — |
| `allocate_for_payment` | `awaiting_capacity` | `awaiting_payment` | system, organizer | capacity freed for an unpaid waitlisted paid registration; atomic reservation with new payment window | order (re)opened, reservation expiry set | registrant | expire_reservation | — |
| `allocate_from_waitlist` | `awaiting_capacity` | `awaiting_review` | organizer, system | capacity freed; atomic allocation succeeded | reservation created | registrant | release_to_waitlist | — |
| `approve` | `awaiting_review` | `confirmed` | organizer, event_operator, system | auto or manual approval policy; documents verified by authorized staff only (REG-008) | participation record created with roster + display name snapshot (DATA-002) | registrant | remove (with reason) or withdraw | — |
| `reject` | `awaiting_review`, `awaiting_capacity` | `rejected` | organizer, event_operator, system | reason mandatory; appeal/re-review path offered (REG-004) | capacity released; fee refund queued per policy | registrant | request_re_review → awaiting_review | — |
| `request_re_review` | `rejected` | `awaiting_review` | player, team_captain, team_manager | within re-review window | queued again | organizer | reject | — |
| `withdraw` | `draft`, `incomplete`, `awaiting_payment`, `awaiting_review`, `awaiting_capacity`, `confirmed` | `withdrawn` | player, team_captain, team_manager, team_owner | before withdrawal deadline or with refund-policy consequence shown (FIN-006) | capacity released; waitlist promotion job; refund per policy | organizer, waitlist | none | — |
| `remove` | `confirmed` | `removed` | organizer, head_referee, disciplinary_admin | documented reason (disqualification, no-show, discipline) linked to a case | participation flagged; bracket consequences per FMT-004 | registrant, affected opponents | reinstate via case decision (not a free status write) | — |
| `cancel_by_event` | `draft`, `incomplete`, `awaiting_payment`, `awaiting_review`, `awaiting_capacity`, `confirmed` | `removed` | system | parent event cancelled with approval (15.5 cancellation) | capacity released; refund per the published cancellation percentage; tickets voided | registrant | none | — |
| `expire_reservation` | `awaiting_payment` | `draft` | system | reservation expiry reached without verified payment | capacity released | registrant | submit_with_fee | — |

## رویارویی (`match`)

وضعیت آغازین: `awaiting_sides` (انتظار طرفین)

| وضعیت | برچسب فارسی |
|---|---|
| `awaiting_sides` | انتظار طرفین |
| `scheduled` | برنامه‌ریزی‌شده |
| `awaiting_readiness` | انتظار آمادگی |
| `ready` | آماده |
| `pre_game_selection` | انتخاب‌های پیش از بازی |
| `live` | جاری |
| `paused` | متوقف |
| `provisional` | پایان موقت |
| `disputed` | در اختلاف |
| `final` | نهایی |
| `cancelled` | لغوشده |

| گذار | از | به | نقش مجاز | پیش‌شرط | اثر | اعلان | جبران/بازگشت | تأیید دوم |
|---|---|---|---|---|---|---|---|---|
| `assign_sides` | `awaiting_sides` | `scheduled` | system, organizer, event_operator | both sides have a valid origin (previous match, seed, quota) and no duplicate advancement (STG-002) | slot filled; schedule candidate | participants | unassign via draw redo with reason (DRAW-003) | — |
| `open_checkin` | `scheduled` | `awaiting_readiness` | system, event_operator | check-in window opened (CHK-001) | readiness collection starts | captains/members | none | — |
| `mark_ready` | `awaiting_readiness` | `ready` | system, event_operator, referee | minimum roster readiness met for both sides (CHK-002) or operator manual check-in (CHK-003) | lobby data releasable to authorized members (ROOM-004) | participants, referee | back to awaiting_readiness if a side becomes unavailable | — |
| `start_selection` | `ready` | `pre_game_selection` | system, referee, event_operator | rules snapshot defines veto/pick order (CFG-003) | veto timer started | participants | none | — |
| `start` | `pre_game_selection`, `ready` | `live` | referee, event_operator, system, team_captain | selections complete or rules say none required; start actor and time recorded (RUN-001) | running; timers active | live center, participants | pause | — |
| `pause` | `live` | `paused` | referee, event_operator, team_captain, system | pause type tactical/technical within allowed count/duration (RUN-002) | pause recorded with reason | participants, referee | resume | — |
| `resume` | `paused` | `live` | referee, event_operator, system | return deadline not exceeded or referee decision recorded | running | participants | pause | — |
| `submit_result` | `live`, `paused` | `provisional` | team_captain, referee, system | result values valid against the game scoring model (RES-004); evidence attached if required | provisional result visible with label; opponent confirmation deadline starts | opponent, referee, live center (delayed projection) | dispute | — |
| `dispute` | `provisional` | `disputed` | team_captain, referee, system | conflicting submissions or an opened dispute case within deadline (AC-09) | auto-finalization blocked; case created | both sides, referee | finalize after decision | — |
| `finalize` | `provisional`, `disputed` | `final` | referee, head_referee, system | opponent confirmed or deadline passed with no active dispute (RES-003), or dispute decided; evidence source recorded (DATA-007) | advancement/standings computed once; downstream slots filled; outbox events for news/ranking (exactly-once via event id) | participants, newsroom, followers | result correction case (RES-006/007) with second approval; never a direct status write | — |
| `reopen` | `final` | `disputed` | head_referee, appeal_authority | documented reason; impact list previewed (RES-006); dependent matches started → automatic rewrite forbidden, case required (RES-007) | dependent actions frozen; affected parties listed | affected parties | finalize again with new result version | بله |
| `reset_sides` | `scheduled`, `awaiting_readiness`, `ready` | `awaiting_sides` | system | a result correction changed who occupies this slot and the match has not started (RES-007); runs only inside the correction saga | sides/readiness cleared; the slot is refilled from the corrected result by the next sync | previous and new occupants | assign_sides from the next sync | — |
| `cancel` | `awaiting_sides`, `scheduled`, `awaiting_readiness`, `ready`, `pre_game_selection`, `live`, `paused` | `cancelled` | organizer, head_referee, event_operator, system | reason type (walkover, forfeit type, stage cancelled, bye after a double no-show, grand-final reset not needed) per RUN-004; system only for bracket byes | bracket consequences per rules; no score invented | participants | none | — |
| `forfeit` | `scheduled`, `awaiting_readiness`, `ready`, `pre_game_selection`, `live`, `paused` | `final` | referee, head_referee, event_operator, organizer, system | forfeit / walkover / double no-show type and reason recorded by an official per the rules (RUN-004, FMT-004); system only for a participant withdrawn by an official decision | final outcome with forfeit flag; advancement consumes it | participants | reopen via result correction (ESP-05) | — |

## اعتراض (`dispute`)

وضعیت آغازین: `filed` (ثبت‌شده)

| وضعیت | برچسب فارسی |
|---|---|
| `filed` | ثبت‌شده |
| `assigned` | ارجاع‌شده |
| `defense_received` | دریافت دفاع |
| `under_review` | بررسی |
| `first_decision` | رأی نخست |
| `appeal` | تجدیدنظر |
| `closed` | مختومه |

| گذار | از | به | نقش مجاز | پیش‌شرط | اثر | اعلان | جبران/بازگشت | تأیید دوم |
|---|---|---|---|---|---|---|---|---|
| `assign` | `filed` | `assigned` | head_referee, system | assignee has no conflict of interest (REF-001) | assignee set; deadlines computed from rules package | assignee, parties | reassign with reason | — |
| `receive_defense` | `assigned` | `defense_received` | team_captain, player, system | within defense deadline | defense and evidence attached (private) | assignee | none | — |
| `start_review` | `assigned`, `defense_received` | `under_review` | referee, head_referee | defense received or deadline passed | evidence requests possible (REF-003) | parties | none | — |
| `decide_first` | `under_review` | `first_decision` | referee, head_referee | decision cites rules version and clause (RULE-011) | sanctions/result effects applied via their own machines; appeal window starts | parties (served), head referee | appeal | — |
| `appeal` | `first_decision` | `appeal` | team_captain, player, team_manager | within appeal deadline; independent appeal authority exists (REF-005) | appeal authority assigned ≠ first decider | appeal authority, parties | none | — |
| `close` | `first_decision`, `appeal` | `closed` | head_referee, appeal_authority, system | appeal window passed or appeal decided with cited clause | final; result correction case triggered if needed | parties, affected matches | none (platform-wide extension needs disciplinary_admin, INT-004) | — |

## پرداخت (`payment`)

وضعیت آغازین: `created` (ایجادشده)

| وضعیت | برچسب فارسی |
|---|---|
| `created` | ایجادشده |
| `awaiting_gateway` | انتظار درگاه |
| `verified` | موفق تأییدشده |
| `failed` | ناموفق |
| `unknown` | نامشخص |
| `awaiting_refund` | انتظار بازپرداخت |
| `refunded_partial` | بازپرداخت جزئی |
| `refunded_full` | بازپرداخت کامل |

| گذار | از | به | نقش مجاز | پیش‌شرط | اثر | اعلان | جبران/بازگشت | تأیید دوم |
|---|---|---|---|---|---|---|---|---|
| `redirect` | `created` | `awaiting_gateway` | system | gateway adapter configured (never a test double in production); order id + amount recorded | gateway reference stored | none | fail | — |
| `verify` | `awaiting_gateway`, `unknown` | `verified` | system | server-side verification matched amount, currency and order id (FIN-002); idempotent on gateway reference (FIN-004) | single ledger entry; registration payment_confirmed | payer | refund | — |
| `fail` | `created`, `awaiting_gateway`, `unknown` | `failed` | system | gateway reported failure or verification mismatch | no ledger effect | payer | none | — |
| `mark_unknown` | `awaiting_gateway` | `unknown` | system | callback missing/timeout; reconciliation job scheduled | reconciliation queue entry | finance dashboard | verify or fail after reconciliation | — |
| `request_refund` | `verified`, `refunded_partial` | `awaiting_refund` | finance_officer, system | refund policy outcome computed (FIN-006); amount ≤ remaining | refund intent; large refunds need second approval | payer | cancel refund request (returns to previous state) | — |
| `refund_partial` | `awaiting_refund` | `refunded_partial` | system, finance_officer | provider confirmed partial refund with reference | ledger refund entry | payer | none | بله |
| `refund_full` | `awaiting_refund` | `refunded_full` | system, finance_officer | provider confirmed full refund with reference | ledger refund entry; obligation closed, re-settlement blocked | payer | none | بله |

## جایزه (`prize`)

وضعیت آغازین: `defined` (تعریف‌شده)

| وضعیت | برچسب فارسی |
|---|---|
| `defined` | تعریف‌شده |
| `recipient_verified` | احراز گیرنده |
| `ready_to_pay` | آماده پرداخت |
| `paying` | پرداخت در جریان |
| `paid` | پرداخت‌شده |
| `disputed` | مورد اختلاف |
| `cancelled` | لغوشده |

| گذار | از | به | نقش مجاز | پیش‌شرط | اثر | اعلان | جبران/بازگشت | تأیید دوم |
|---|---|---|---|---|---|---|---|---|
| `verify_recipient` | `defined` | `recipient_verified` | finance_officer, organizer | authorized recipient declared before competition (FIN-007); documents verified | recipient locked | recipient | dispute | — |
| `mark_ready` | `recipient_verified` | `ready_to_pay` | system, finance_officer | event closed; result final; responsible payer (platform/organizer) explicit (END-002) | payout queue | finance | dispute | — |
| `start_payout` | `ready_to_pay` | `paying` | finance_officer | second independent approval recorded (ACL-003) | payout instruction sent via provider or manual labeled path (FIN-005) | recipient | provider failure → ready_to_pay with incident | بله |
| `confirm_paid` | `paying` | `paid` | system, finance_officer | provider/manual reference recorded | ledger settled; duplicate settlement blocked | recipient | none | — |
| `dispute` | `defined`, `recipient_verified`, `ready_to_pay`, `paying` | `disputed` | finance_officer, organizer, head_referee | linked case id | payout frozen | recipient, finance | resolve back to recipient_verified | — |
| `resolve_dispute` | `disputed` | `recipient_verified` | finance_officer, appeal_authority | case closed | payout flow resumes | recipient | dispute | — |
| `cancel` | `defined`, `recipient_verified`, `ready_to_pay`, `disputed` | `cancelled` | finance_officer, organizer | event cancelled or result correction removed entitlement; reason | obligation closed | recipient | none | بله |

## خبر (`news_post`)

وضعیت آغازین: `draft` (پیش‌نویس)

| وضعیت | برچسب فارسی |
|---|---|
| `draft` | پیش‌نویس |
| `in_review` | در بررسی |
| `scheduled` | زمان‌بندی‌شده |
| `published` | منتشرشده |
| `corrected` | اصلاح‌شده |
| `retracted` | پس‌گرفته‌شده |
| `archived` | آرشیوی |

| گذار | از | به | نقش مجاز | پیش‌شرط | اثر | اعلان | جبران/بازگشت | تأیید دوم |
|---|---|---|---|---|---|---|---|---|
| `submit` | `draft` | `in_review` | reporter, photographer, editor | linked competitive reference (NEWS-003); no provisional result labeled final (NEWS-008) | review queue | editors | return to draft | — |
| `schedule` | `in_review`, `draft` | `scheduled` | editor, reporter | publish time respects stream delay policy (CAST-005/007); direct publish allowed only with explicit permission | scheduled job | author | unschedule → draft | — |
| `publish` | `in_review`, `scheduled`, `draft` | `published` | editor, system, reporter | official result fields come from competition engine, not editable (NEWS-005); dedupe key for automatic posts (NEWS-006) | public, stable URL, realtime event with visibleAt per delayed projection | followers per preferences | retract or correct | — |
| `correct` | `published`, `corrected` | `corrected` | editor, system | reason; correction notice shown (NEWS-004/007) | new version; previous text retained | readers via notice | none | — |
| `retract` | `published`, `corrected`, `scheduled` | `retracted` | editor | reason recorded | placeholder with retraction notice | followers | none | — |
| `archive` | `published`, `corrected`, `retracted` | `archived` | system, editor | event archived or retention | archive page | none | none | — |

