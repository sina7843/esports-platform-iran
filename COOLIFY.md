# Coolify deployment

This repository now includes `compose.coolify.yaml` for the current low-traffic/test VPS.

## Coolify resource

- Resource type: **Docker Compose**
- Repository: `sina7843/esports-platform-iran`
- Branch: `main`
- Compose file: `/compose.coolify.yaml`
- Public service: **web**
- Internal port: **8080**
- Give **no domain** to `api`, `worker`, or `mongo`.

Traffic stays same-origin:

```
Browser -> Coolify/Traefik -> web:8080 (nginx) -> /api -> api:3000 -> mongo:27017
                                      \-> SPA static files
worker -------------------------------------------------> mongo
```

No host port is published. MongoDB is a single-node replica set because the application uses transactions.

## Environment

Copy the variable names from `coolify.env.example` into Coolify and replace placeholders.

For a domain such as `https://example.ir`:

```env
PUBLIC_WEB_ORIGIN=https://example.ir
PUBLIC_API_ORIGIN=https://example.ir
```

Generate `APP_SECRET` independently:

```sh
openssl rand -hex 32
```

Choose a private `AUTH_DEV_CODE` of at least 8 characters. Do not reuse the application secret.

## Important: this profile is test-mode, not hardened production

The current repository does not yet implement real production adapters for SMS, payment, email, video, or maps.
Production configuration deliberately rejects the development doubles. Therefore this Coolify profile defaults to
`NODE_ENV=development` / `APP_ENV=local` while still running the optimized Docker images.

Do not change it to production until real provider adapters are implemented and configured. Production must also
disable `AUTH_DEV_LOGIN_ENABLED` and use the real OTP path.

## First deploy / synthetic seed

API and worker apply database migrations automatically at startup. Seeding is intentionally not automatic.

If you need the synthetic test principals/catalog after the stack is healthy, open the **api** container terminal in
Coolify and run this once:

```sh
node -e "import('@esp/core').then(async m=>{const c=await m.createContainer({serviceName:'seed'});await m.runMigrations(c.dbh.db);await m.seedDatabase(c.c,c.acl);await c.close();})"
```

The seed code refuses production/staging.

## Persistence

These named volumes survive redeployments:

- `esports_mongo_data` — MongoDB data
- `esports_mongo_config` — MongoDB replica-set/config data
- `esports_app_data` — uploaded/private/public files

Never run `docker compose down -v` or prune production volumes.

The repository's encrypted backup system remains optional in this test profile. If enabled, `BACKUP_TARGET_DIR`
must point to an independently mounted filesystem and `BACKUP_ENCRYPTION_KEY` must be stored separately.
