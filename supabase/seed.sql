-- Development fixtures, also used by the pgTAP suite.
-- Every account shares the password 'password123'.

insert into public.organizations (id, name, slug) values
  ('11111111-1111-1111-1111-111111111111', 'Acme',  'acme'),
  ('22222222-2222-2222-2222-222222222222', 'Beta',  'beta'),
  ('33333333-3333-3333-3333-333333333333', 'Ceres', 'ceres');

insert into public.invitations (email, role, org_id) values
  ('admin@allin.test',    'admin',  null),
  ('agent1@allin.test',   'agent',  null),
  ('agent2@allin.test',   'agent',  null),
  ('clienta1@allin.test', 'client', '11111111-1111-1111-1111-111111111111'),
  ('clienta2@allin.test', 'client', '11111111-1111-1111-1111-111111111111'),
  ('clientb1@allin.test', 'client', '22222222-2222-2222-2222-222222222222'),
  ('inactive@allin.test', 'client', '11111111-1111-1111-1111-111111111111');

-- Internal users arrive through OAuth: provider set, email confirmed.
-- Clients arrive through an admin invite: invited_at set.
-- A password is added to every account so the dev environment stays usable.
-- confirmation_token, recovery_token, email_change_token_new and email_change
-- have no default in this GoTrue version and must not be left NULL: its Go
-- driver scans them as plain strings and errors on NULL ("converting NULL to
-- string is unsupported").
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, invited_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  created_at, updated_at
)
select
  '00000000-0000-0000-0000-000000000000',
  v.id, 'authenticated', 'authenticated', v.email,
  crypt('password123', gen_salt('bf')),
  now(),
  case when v.provider = 'email' then now() end,
  jsonb_build_object('provider', v.provider, 'providers', jsonb_build_array(v.provider)),
  jsonb_build_object('full_name', v.full_name),
  '', '', '', '',
  now(), now()
from (values
  ('a0000000-0000-0000-0000-000000000001'::uuid, 'admin@allin.test',    'google', 'Awa Diallo'),
  ('b0000000-0000-0000-0000-000000000001'::uuid, 'agent1@allin.test',   'google', 'Bruno Lemoine'),
  ('b0000000-0000-0000-0000-000000000002'::uuid, 'agent2@allin.test',   'google', 'Bianca Rossi'),
  ('c0000000-0000-0000-0000-000000000001'::uuid, 'clienta1@allin.test', 'email',  'Chloé Marchand'),
  ('c0000000-0000-0000-0000-000000000002'::uuid, 'clienta2@allin.test', 'email',  'Camille Faure'),
  ('c0000000-0000-0000-0000-000000000003'::uuid, 'clientb1@allin.test', 'email',  'Cyril Bertin'),
  ('c0000000-0000-0000-0000-000000000004'::uuid, 'inactive@allin.test', 'email',  'Inès Dufour'),
  ('d0000000-0000-0000-0000-000000000001'::uuid, 'orphan@allin.test',   'email',  'Oscar Tanguy')
) as v(id, email, provider, full_name);

-- Password sign-in requires a matching identity row.
insert into auth.identities (
  provider_id, user_id, identity_data, provider, last_sign_in_at,
  created_at, updated_at
)
select
  u.id::text, u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email', now(), now(), now()
from auth.users u
where u.email like '%@allin.test';

-- The orphan account is deliberately left without a profile.
update public.profiles set is_active = false
 where id = 'c0000000-0000-0000-0000-000000000004';

insert into public.agent_organizations (agent_id, org_id) values
  ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('b0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222'),
  ('b0000000-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333');
