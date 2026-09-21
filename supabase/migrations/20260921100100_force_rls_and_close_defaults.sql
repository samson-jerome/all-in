-- Two second lines of defence the design asked for and the lot did not deliver.
--
-- 1. `force row level security`. Section 4 of the design reads "Toutes les
--    tables sont en `enable row level security` **et** `force row level
--    security`". The two RLS migrations only ever ran `enable`; measured in
--    base, relforcerowsecurity was false on all four tables. `enable` alone
--    exempts the table owner from its own policies, so anything that ever
--    reaches these tables as `postgres` sees everything. Exploitability today
--    is low -- nothing reachable from a browser runs as `postgres`, which
--    carries `rolbypassrls` anyway, so this changes nothing observable right
--    now. That is precisely why it belongs here: it is the line of defence
--    lot 2 inherits, and it costs nothing to honour while the schema is small.
--
--    Measured before writing this, so the claim is not a hope: every one of
--    these tables is owned by `postgres`, every SECURITY DEFINER helper
--    (auth_role, auth_org, agent_covers_org, can_read_org, handle_new_user,
--    admin_find_user_by_email, admin_revoke_sessions) is owned by `postgres`,
--    and `postgres` has rolbypassrls = true. Forcing RLS therefore does not
--    put those helpers under their own policies, which is the one thing that
--    could have broken -- and the pgTAP suite is re-run to confirm it.
alter table public.organizations       force row level security;
alter table public.profiles            force row level security;
alter table public.agent_organizations force row level security;
alter table public.invitations         force row level security;

-- 2. Default privileges. pg_default_acl shows `postgres` granting arwdDxtm on
--    every future table of `public` to `anon` and `authenticated`. Nothing is
--    exposed today, because each of the two RLS migrations opens with an
--    explicit `revoke all ... from anon, authenticated` -- but that safety
--    rests entirely on whoever adds the next table remembering to write that
--    line. Forgotten once, on a table without RLS, and it is world-readable
--    and world-writable from a browser with the public anon key.
--
--    Closing it here inverts the default: a new table grants nothing until
--    someone grants it on purpose. The existing grants are unaffected --
--    default privileges only ever apply to objects created after this runs --
--    so nothing in the current schema changes.
alter default privileges in schema public
  revoke all on tables from anon, authenticated;

-- Sequences carry the same default: a future sequence handed to anon would
-- leak and let anyone burn identifiers.
--
-- Functions are deliberately NOT revoked here. The same default makes every
-- new function executable by anon unless revoked -- which each helper above
-- has to undo by hand today -- but closing it wholesale would also revoke
-- EXECUTE from `authenticated` on every future function, including the
-- helpers the policies call, and every one of them would then need an
-- explicit grant. That is a trade worth making deliberately, not as a
-- side effect of this migration. Measured after this migration:
-- pg_default_acl still shows `f | postgres | {anon=X, authenticated=X}`
-- for schema public.
alter default privileges in schema public
  revoke all on sequences from anon, authenticated;
