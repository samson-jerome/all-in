begin;
select plan(10);

-- Helper: insert an auth user the way a given arrival route would.
create or replace function pg_temp.new_auth_user(
  p_email text, p_provider text, p_invited boolean, p_confirmed boolean
) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    instance_id, id, aud, role, email,
    email_confirmed_at, invited_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated',
    'authenticated', p_email,
    case when p_confirmed then now() end,
    case when p_invited then now() end,
    jsonb_build_object('provider', p_provider),
    '{}'::jsonb, now(), now()
  );
  return v_id;
end;
$$;

-- pg_temp.new_auth_user() is called from its own top-level statement and its
-- result captured with \gset, then reused in the assertion below. Calling it
-- inline inside the assertion's subquery does not work reliably: a plain
-- SELECT takes a single snapshot for the whole statement, so a profile row
-- inserted by the trigger while evaluating the function is not visible to
-- another scan in that same statement; and on this schema's small
-- public.profiles table, the planner picks a Seq Scan for a `where id = ...`
-- filter, which evaluates the volatile function once per existing row and
-- inserts the same test email into auth.users several times, violating its
-- unique constraint. Splitting into two statements avoids both problems.

-- 1. An invited client gets a profile.
insert into public.invitations (email, role, org_id)
values ('t1@allin.test', 'client', '11111111-1111-1111-1111-111111111111');
select pg_temp.new_auth_user('t1@allin.test', 'email', true, false) as t1_id \gset
select is(
  (select role::text from public.profiles where id = :'t1_id'),
  'client', 'un client invité obtient son profil'
);

-- 2. The invitation is consumed.
select is(
  (select status from public.invitations where email = 't1@allin.test'),
  'accepted', 'l''invitation passe en accepted'
);

-- 3. No invitation, no profile.
select pg_temp.new_auth_user('t2@allin.test', 'email', false, true) as t2_id \gset
select is(
  (select count(*)::int from public.profiles where id = :'t2_id'),
  0, 'sans invitation, aucun profil n''est créé'
);

-- 4. A revoked invitation grants nothing.
insert into public.invitations (email, role, org_id, status)
values ('t3@allin.test', 'client', '11111111-1111-1111-1111-111111111111', 'revoked');
select pg_temp.new_auth_user('t3@allin.test', 'email', true, false) as t3_id \gset
select is(
  (select count(*)::int from public.profiles where id = :'t3_id'),
  0, 'une invitation révoquée ne rattache personne'
);

-- 5. The security hole: an account created outside the invitation route
-- must not claim an agent invitation. Entry is by invitation only now, so
-- this is no longer about the arrival provider -- it is about invited_at.
insert into public.invitations (email, role) values ('t4@allin.test', 'agent');
select pg_temp.new_auth_user('t4@allin.test', 'email', false, true) as t4_id \gset
select is(
  (select count(*)::int from public.profiles where id = :'t4_id'),
  0, 'un compte créé hors du parcours d''invitation ne peut pas s''emparer d''une invitation d''agent'
);

-- 6. The internal positive path: an agent invitation arriving through the
-- invitation flow, without any external provider, does produce a profile.
-- This is the real production case: no assertion covered it before.
insert into public.invitations (email, role) values ('t5@allin.test', 'agent');
select pg_temp.new_auth_user('t5@allin.test', 'email', true, true) as t5_id \gset
select is(
  (select role::text from public.profiles where id = :'t5_id'),
  'agent', 'un agent invité obtient son profil, sans fournisseur externe'
);

-- 7. Same route, but the address is not confirmed: a profile is still
-- created, because invited_at is what matters now, not confirmation.
insert into public.invitations (email, role) values ('t6@allin.test', 'agent');
select pg_temp.new_auth_user('t6@allin.test', 'email', true, false) as t6_id \gset
select is(
  (select role::text from public.profiles where id = :'t6_id'),
  'agent', 'un agent invité obtient son profil même sans adresse confirmée'
);

-- 8. The real GoTrue invite sequence: the row is inserted with invited_at
-- still NULL, then a separate UPDATE sets it. The client must still get
-- attached, through the AFTER UPDATE OF invited_at trigger.
insert into public.invitations (email, role, org_id)
values ('t7@allin.test', 'client', '11111111-1111-1111-1111-111111111111');
select pg_temp.new_auth_user('t7@allin.test', 'email', false, false) as t7_id \gset
update auth.users set invited_at = now() where id = :'t7_id';
select is(
  (select role::text from public.profiles where id = :'t7_id'),
  'client', 'un client invité via /auth/v1/invite obtient son profil dès que invited_at est renseigné'
);

-- 9. Same scenario: the invitation itself must also be consumed, not just
-- the profile created.
select is(
  (select status from public.invitations where email = 't7@allin.test'),
  'accepted', 'l''invitation via /auth/v1/invite passe aussi en accepted'
);

-- 10. Idempotence guard: firing the trigger a second time for the same user
-- (a further UPDATE of invited_at, as GoTrue could in principle issue) must
-- not duplicate the profile or violate profiles_pkey.
update auth.users set invited_at = now() where id = :'t7_id';
select is(
  (select count(*)::int from public.profiles where id = :'t7_id'),
  1, 'un second déclenchement sur invited_at ne duplique pas le profil'
);

select * from finish();
rollback;
