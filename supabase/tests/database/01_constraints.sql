begin;
select plan(6);

select has_table('public', 'organizations', 'la table organizations existe');
select has_table('public', 'profiles', 'la table profiles existe');

-- A dedicated organization: from task 3 onwards the seed already owns
-- 11111111-… and the slug 'acme', and this file runs against the seeded base.
insert into public.organizations (id, name, slug)
values ('99999999-9999-9999-9999-999999999999', 'Test Org', 'test-org');

-- A client must carry an organization.
prepare client_without_org as
  insert into public.profiles (id, full_name, role, org_id)
  values (gen_random_uuid(), 'Sans Org', 'client', null);
select throws_ok(
  'client_without_org', '23514',
  null, 'un client sans organisation est rejeté'
);

-- An agent must not carry one.
prepare agent_with_org as
  insert into public.profiles (id, full_name, role, org_id)
  values (gen_random_uuid(), 'Avec Org', 'agent',
          '99999999-9999-9999-9999-999999999999');
select throws_ok(
  'agent_with_org', '23514',
  null, 'un agent avec organisation est rejeté'
);

-- Only one pending invitation per address.
insert into public.invitations (email, role, org_id)
values ('dup@allin.test', 'client', '99999999-9999-9999-9999-999999999999');
prepare duplicate_pending as
  insert into public.invitations (email, role, org_id)
  values ('dup@allin.test', 'client', '99999999-9999-9999-9999-999999999999');
select throws_ok(
  'duplicate_pending', '23505',
  null, 'deux invitations en attente pour la même adresse sont rejetées'
);

-- A revoked invitation frees the address.
update public.invitations set status = 'revoked' where email = 'dup@allin.test';
select lives_ok(
  $$insert into public.invitations (email, role, org_id)
    values ('dup@allin.test', 'client', '99999999-9999-9999-9999-999999999999')$$,
  'une invitation révoquée libère l''adresse'
);

select * from finish();
rollback;
