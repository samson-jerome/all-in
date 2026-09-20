begin;
select plan(9);

-- Agent 1 sees their own portfolio, and nothing of the invitations table.
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;

select is((select count(*)::int from public.agent_organizations), 2,
          'l''agent voit ses deux affectations');
select is((select count(*)::int from public.invitations), 0,
          'l''agent ne voit aucune invitation');

-- The privilege escalation test: an agent must not widen their own portfolio.
prepare agent_grants_self as
  insert into public.agent_organizations (agent_id, org_id)
  values ('b0000000-0000-0000-0000-000000000001',
          '33333333-3333-3333-3333-333333333333');
select throws_ok('agent_grants_self', '42501', null,
                 'un agent ne peut pas s''ajouter une organisation');

-- The agent has table-level delete privilege (administrators need it too),
-- so a delete the row-level policy rejects does not raise: it silently
-- touches zero rows, same as the organizations update case in
-- 04_rls_org_profiles.sql. The assertion has to look at the data.
delete from public.agent_organizations
 where agent_id = 'b0000000-0000-0000-0000-000000000001';
select is(
  (select count(*)::int from public.agent_organizations
    where agent_id = 'b0000000-0000-0000-0000-000000000001'),
  2, 'un agent ne peut pas modifier son portefeuille'
);
reset role;

-- A client sees neither table.
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select count(*)::int from public.agent_organizations), 0,
          'le client ne voit aucune affectation');
select is((select count(*)::int from public.invitations), 0,
          'le client ne voit aucune invitation');
reset role;

-- The administrator reads invitations but still cannot write them.
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;

select is((select count(*)::int from public.invitations), 7,
          'l''administrateur voit toutes les invitations');
select lives_ok(
  $$insert into public.agent_organizations (agent_id, org_id)
    values ('b0000000-0000-0000-0000-000000000002',
            '11111111-1111-1111-1111-111111111111')$$,
  'l''administrateur affecte une organisation à un agent'
);

prepare admin_writes_invitation as
  insert into public.invitations (email, role) values ('x@allin.test', 'agent');
select throws_ok('admin_writes_invitation', '42501', null,
                 'même l''administrateur n''écrit pas directement dans invitations');
reset role;

select * from finish();
rollback;
