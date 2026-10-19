# MongoDB production initialization (operator runbook, run once)

Performed by the operator on the Iranian hosting infrastructure. Never by the coding agent. Secrets go to the
operations secret store, not to the repository.

## 1. Keyfile (replica-set member authentication)
```sh
docker volume create esp_mongo-keyfile
docker run --rm -v esp_mongo-keyfile:/etc/mongo alpine sh -c \
  'apk add --no-cache openssl >/dev/null && openssl rand -base64 756 > /etc/mongo/keyfile && chmod 400 /etc/mongo/keyfile && chown 999:999 /etc/mongo/keyfile'
```

## 2. Start Mongo without clients and initiate the set
```sh
docker compose -f compose.yaml -f compose.prod.yaml up -d mongo
docker compose exec mongo mongosh --quiet --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"mongo:27017"}]})'
```
For three members, list all three hosts here; the healthcheck in `compose.yaml` keeps re-checking until PRIMARY.

## 3. Users and least-privilege roles (localhost exception, first connection only)
```js
use admin
db.createUser({ user: "esp_admin", pwd: passwordPrompt(), roles: ["root"] })

use esports
// Application role: full CRUD on domain collections, INSERT/FIND ONLY on audit_log (SEC-007).
db.createRole({
  role: "esp_app",
  privileges: [
    { resource: { db: "esports", collection: "" }, actions: ["find", "insert", "update", "remove", "createIndex", "listIndexes", "listCollections", "collMod", "createCollection"] },
    { resource: { db: "esports", collection: "audit_log" }, actions: ["find", "insert", "createIndex", "listIndexes"] }
  ],
  roles: []
})
db.createUser({ user: "esp_app", pwd: passwordPrompt(), roles: ["esp_app"] })

// Backup role: read-only + oplog access for mongodump --oplog.
db.getSiblingDB("admin").createUser({ user: "esp_backup", pwd: passwordPrompt(), roles: ["backup"] })
```
Note: `update`/`remove` on `audit_log` are granted to nobody but `esp_admin`; routine administration uses `esp_app`.
MongoDB resource privileges apply at collection level, so the broader `collection: ""` grant must be split into explicit
collection entries if a stricter audit posture is required — list every collection from `packages/core/src/db/collections.ts`.

## 4. Application connection string (in the operator's .env, never committed)
`MONGO_URL=mongodb://esp_app:<password>@mongo:27017/esports?replicaSet=rs0&authSource=esports`

## 5. Verify
```sh
docker compose exec mongo mongosh -u esp_app -p --authenticationDatabase esports --quiet --eval 'db.hello().setName'
pnpm db:migrate status
```
