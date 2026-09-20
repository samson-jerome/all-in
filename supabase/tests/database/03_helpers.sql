begin;
select plan(11);

-- Acting as client A1.
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;

select is(public.auth_role()::text, 'client', 'A1 est un client');
select is(public.auth_org(), '11111111-1111-1111-1111-111111111111'::uuid,
          'A1 appartient à Acme');
select ok(public.can_read_org('11111111-1111-1111-1111-111111111111'),
          'A1 voit son organisation');
select ok(not public.can_read_org('22222222-2222-2222-2222-222222222222'),
          'A1 ne voit pas Beta');
reset role;

-- Acting as agent 1, who covers Acme and Beta.
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;

select is(public.auth_role()::text, 'agent', 'agent1 est un agent');
select is(public.auth_org(), null, 'un agent ne porte pas d''organisation propre');
select ok(public.can_read_org('22222222-2222-2222-2222-222222222222'),
          'agent1 voit Beta, qui est dans son portefeuille');
select ok(not public.can_read_org('33333333-3333-3333-3333-333333333333'),
          'agent1 ne voit pas Ceres');
reset role;

-- Acting as the administrator.
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select ok(public.can_read_org('33333333-3333-3333-3333-333333333333'),
          'l''administrateur voit toute organisation');
reset role;

-- A deactivated account resolves to nothing.
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000004","role":"authenticated"}';
set local role authenticated;
select is(public.auth_role(), null, 'un compte désactivé n''a plus de rôle');
reset role;

-- An account without a profile resolves to nothing.
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select is(public.auth_role(), null, 'un compte non rattaché n''a pas de rôle');
reset role;

select * from finish();
rollback;
