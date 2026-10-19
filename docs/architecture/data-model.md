# مدل داده (DATA-001..007)

منبع کد: `packages/core/src/db/collections.ts`؛ ایندکس‌ها: `packages/core/src/db/migrations.ts` (مهاجرت `0001_initial_indexes`).

## سلسله‌مراتب رقابتی (DATA-001)
```
events (_id, slug, organizerOrgId, state, visibility, rulesSnapshot, version)
 └─ disciplines (_id, eventId, gameId, gameVersion, platform, mode, rulesSnapshot)
     └─ stages (_id, disciplineId, order, format, state, dependsOnStageIds)
         └─ matches (_id, stageId, kind: head_to_head|lobby, sides[], state, lobby{host,password,releasedAt}, resultVersion, version)
             └─ game_units (_id, matchId, order, kind: map|set|round|attempt|lobby_round, values, provenance, resultVersion)
```
هر سطح شناسه پایدار ULID و ارجاع به والد دارد؛ `stages(disciplineId, order)` و `game_units(matchId, order)` یکتا هستند.

## شرکت در رویداد (DATA-002, ROS-006, RULE-006)
`participations`: رکورد مستقل با `snapshot {displayName, teamId, roster[]}` و `acceptedRules {packageId, version, hash, acceptedAt, acceptedBy}`. تغییر بعدی پروفایل/تیم این snapshot را تغییر نمی‌دهد. `matches.sides[]` نیز `displayName` و `roster` تاریخی و `origin {kind: seed|advance|quota|invite|waitlist, ref}` را نگه می‌دارد (STG-002).

ایندکس partial یکتا روی `(disciplineId, snapshot.teamId)` برای وضعیت‌های غیرپایانی، پایه REG-003 است.

## snapshot قوانین (BASE-005, RULE-007)
`RulesSnapshot {packageId, version, sourceRef, reviewedAt, label, clauses[{key, kind: mandatory|configurable|human_review, value, citation}], hash}` روی رویداد، رشته و رویارویی ذخیره می‌شود و پس از انتشار تغییر نمی‌کند؛ اصلاحیه نسخه جدید می‌سازد (ESP-02 جریان اصلاحیه را کامل می‌کند). seed مصنوعی برچسب `TEST ONLY` دارد و قانون رسمی نیست.

## اتصال موجودیت‌های وابسته (DATA-003)
همه موجودیت‌های بعدی (registration/payment/server allocation/dispute/sanction/prize/news/broadcast) باید `eventId` و در صورت وجود `disciplineId/stageId/matchId` داشته باشند؛ الگو در `participations`، `files.scope` و `audit.target/scope` پیاده شده است.

## زمان و پول (DATA-004/005)
- همه instantها رشته ISO-8601 UTC با پسوند `Z` (`UtcInstantSchema`)؛ `timeZone` رویداد برای نمایش.
- پول `{amount: int ریال, currency:'IRR'}`؛ تبدیل تومان آزمون‌شده در `contracts.test.ts`.

## حذف/تغییر نام حساب (DATA-006)
`principals.status: active|suspended|deleted`؛ سوابق مالی و نتیجه فقط به `principalId` و snapshotهای نمایشی اشاره می‌کنند، نه به پروفایل جاری. ناشناس‌سازی (ESP-02) `displayName` پروفایل را عوض می‌کند و snapshotهای تاریخی و دفتر مالی دست‌نخورده می‌مانند.

## منشأ و نسخه محاسبه (DATA-007)
`result_versions {targetType: match|game_unit|standing|rating, targetId, version, calcVersion, data, provenance{source, actorPrincipalId, reason, evidenceFileIds}}` با ایندکس یکتای `(targetType, targetId, version)`؛ `matches.resultVersion` و `game_units.resultVersion` به آخرین نسخه اشاره می‌کنند. `game_units.provenance.source: manual|referee|integration` داده خام اتصال را از ثبت دستی تفکیک می‌کند (SRV-003/004).

## هویت و مجوز
- `principals {kind, displayName, locale, timeZone, status, aclVersion}`
- `sessions {principalId, tokenHash, expiresAt, revokedAt, userAgent, ip}` — توکن خام ذخیره نمی‌شود؛ TTL index.
- `grants {principalId, role, scope{type,id}, grantedBy, grantedAt, expiresAt, revokedAt, revokedBy, reason}` — یکتا برای گرانت فعال.
- `approvals {action, scope, payload, requestedBy, decidedBy, state, expiresAt, version}`.

## زیرساخت
- `outbox` (رخداد + وضعیت/lease/attempts)، `processed_events` (`consumer:eventId`)، `realtime_events` (seq یکتا، TTL ۷ روز)، `counters` (seq اتمیک)، `audit_log` (append-only، زنجیره hash، schema validator)، `files` (نوع واقعی، sha256، scan، quarantine، retentionClass)، `migrations`.

## نقش دیتابیس تولید
نقش برنامه روی `audit_log` فقط `insert/find` دارد (`docker/mongo/init-prod.md`). پشتیبان‌گیری و رمزگذاری در `backup-restore.md`.
