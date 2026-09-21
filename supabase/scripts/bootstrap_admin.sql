-- Seeds the very first administrator invitation. Nobody can invite them,
-- so this runs once per environment, with the address passed in.
-- Usage: psql "$DB_URL" -v email="personne@exemple.fr" -f this_file.sql
--
-- `returning id` is what tells the caller whether it inserted anything. Both
-- `not exists` guards below make the insert conditional, so an empty result
-- means the row was already there -- someone else's, or an earlier run's --
-- and the caller must not delete it if the rest of the bootstrap fails. See
-- the rollback in bootstrap_admin.sh.
--
-- :'email', not :email. The former is psql's own quoting: it wraps the value
-- in a single-quoted SQL literal and doubles any quote inside it. This file
-- used to take a value the caller had pre-quoted, which broke on the first
-- apostrophe in an address -- o'brien@example.fr closed the literal early and
-- psql died on `syntax error at or near "brien"`. An apostrophe in a name is
-- not an edge case, it is a category of person.
insert into public.invitations (email, role, org_id)
select lower(trim(:'email')), 'admin', null
where not exists (
  select 1 from public.invitations
   where email = lower(trim(:'email')) and status = 'pending'
)
and not exists (
  select 1 from auth.users u
    join public.profiles p on p.id = u.id
   where lower(trim(u.email)) = lower(trim(:'email'))
)
returning id;
