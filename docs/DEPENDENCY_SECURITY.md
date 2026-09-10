# Dependency and migration security

`npm run check:dependencies` audits both production and development dependency
trees and fails on any known finding.

## Drizzle Kit advisory resolution

The four former moderate findings all originated in Drizzle Kit's obsolete
`@esbuild-kit` loader and esbuild development-server dependency. A forced npm
downgrade would have been incompatible, while the 1.0 release candidate tried
to rewrite the established flat D1 migration history. Neither was safe.

CC Mail already used hand-reviewed SQL migrations after the early generated
snapshots, and production applies those files with Wrangler. Drizzle Kit and
its stale configuration were therefore removed. Drizzle ORM remains the typed
runtime query layer and is not part of the advisory chain.

## Migration workflow

1. Update `src/db/schema/index.ts`.
2. Add the next numbered, additive SQL file under `drizzle/migrations/`.
3. Add that filename to `MIGRATION_NAMES` and keep `INITIAL_SCHEMA_SQL` current
   in `src/lib/setup/migration.ts`.
4. Run `npm run db:migrate:local`, then `npm run test:integration`.
5. CI verifies both a fresh schema and every incremental migration. Release
   applies migrations to staging before deployment and to production only
   after staging succeeds and the production environment is approved.

Applied migration files are immutable. Corrections require a new migration.
