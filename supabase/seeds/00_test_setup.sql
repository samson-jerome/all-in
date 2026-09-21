-- Test bootstrap, run ahead of the fixtures by `[db.seed] sql_paths` on every
-- `supabase db reset`.
--
-- pgTAP lives here rather than in supabase/migrations/ because it is a test
-- dependency: a migration chain replays unattended on production, a seed does
-- not run there at all. See
-- 20260921100200_pgtap_out_of_the_migration_chain.sql.
create extension if not exists pgtap with schema extensions;

-- Under ./seeds/ and not under ./tests/: measured, `supabase test db` runs
-- pg_prove over every .sql under supabase/tests/, not just
-- supabase/tests/database/, and a bootstrap file with no TAP plan fails the
-- whole suite with "No plan found in TAP output".
