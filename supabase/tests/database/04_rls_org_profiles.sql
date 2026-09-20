begin;
select plan(12);

-- Client A1: one organization, and the profiles of that organization.
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;

select is((select count(*)::int from public.organizations), 1,
          'le client ne voit que son organisation');
select is((select count(*)::int from public.profiles), 3,
          'le client voit les trois profils de son organisation');
select is((select count(*)::int from public.profiles
            where id = 'b0000000-0000-0000-0000-000000000001'), 0,
          'le client ne voit aucun profil interne');

prepare client_creates_org as
  insert into public.organizations (name, slug) values ('Pirate', 'pirate');
select throws_ok('client_creates_org', '42501', null,
                 'un client ne peut pas créer d''organisation');

-- No policy matches, so the update silently touches zero rows rather than
-- raising: the assertion has to look at the data, not at an error.
update public.organizations set name = 'Détourné'
 where id = '11111111-1111-1111-1111-111111111111';
select is((select count(*)::int from public.organizations where name = 'Détourné'), 0,
          'un client ne peut pas renommer son organisation');

select lives_ok(
  $$update public.profiles set full_name = 'Chloé M.'
     where id = 'c0000000-0000-0000-0000-000000000001'$$,
  'un utilisateur peut se renommer'
);

prepare self_promote as
  update public.profiles set role = 'admin'
   where id = 'c0000000-0000-0000-0000-000000000001';
select throws_ok('self_promote', '42501', null,
                 'un utilisateur ne peut pas changer son propre rôle');

prepare delete_own_profile as
  delete from public.profiles where id = 'c0000000-0000-0000-0000-000000000001';
select throws_ok('delete_own_profile', '42501', null,
                 'la suppression de profil est refusée');
reset role;

-- Agent 1: two organizations, their clients, and themselves.
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select count(*)::int from public.organizations), 2,
          'l''agent voit les deux organisations de son portefeuille');
select is((select count(*)::int from public.profiles), 5,
          'l''agent voit les clients de son portefeuille et lui-même');
reset role;

-- Administrator: everything, except deletion.
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select count(*)::int from public.organizations), 3,
          'l''administrateur voit toutes les organisations');

prepare admin_deletes_org as
  delete from public.organizations
   where id = '33333333-3333-3333-3333-333333333333';
select throws_ok('admin_deletes_org', '42501', null,
                 'même l''administrateur ne peut pas supprimer une organisation');
reset role;

select * from finish();
rollback;
