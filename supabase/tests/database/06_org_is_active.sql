-- Deactivating an organisation cuts its tenant off
-- (20260921100000_org_is_active_cuts_access.sql).
--
-- The seed deliberately carries no inactive organisation: making one of the
-- three fixtures inactive would shift every persona count in the other files
-- for a reason unrelated to what they measure. Acme is deactivated here
-- instead, inside this file's own transaction, and rolled back with it.
begin;
select plan(8);

-- Baseline, before the flag moves: whatever the other files assert, this file
-- has to show the counts actually changing rather than asserting a small
-- number that a coincidence could also produce.
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select count(*)::int from public.organizations), 1,
          'départ : le client d''Acme voit son organisation');
select is((select count(*)::int from public.profiles), 3,
          'départ : le client d''Acme voit les trois profils de son organisation');
reset role;

update public.organizations set is_active = false
 where id = '11111111-1111-1111-1111-111111111111';

-- The client of the deactivated organisation.
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select count(*)::int from public.organizations), 0,
          'organisation désactivée : son client ne la voit plus');
-- Their own row survives on the `id = auth.uid()` branch of profiles_select,
-- which is what the session store needs to tell "deactivated" apart from
-- "no profile at all". Their colleagues are gone.
select is((select count(*)::int from public.profiles), 1,
          'organisation désactivée : son client ne voit plus que son propre profil');
reset role;

-- The agent covering it. agent1 covers Acme and Beta; only Beta is left.
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select count(*)::int from public.organizations), 1,
          'organisation désactivée : l''agent qui la couvre ne la voit plus');
select ok(not public.can_read_org('11111111-1111-1111-1111-111111111111'),
          'can_read_org est faux sur une organisation désactivée, pour l''agent qui la couvre');
reset role;

-- The administrator. The rule has no exception, so can_read_org() is false for
-- them too -- and yet the administration screen must still list the row, or
-- nobody could ever reactivate it. That is organizations_select's own
-- administrator clause, not an exception hidden inside the helper.
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select ok(not public.can_read_org('11111111-1111-1111-1111-111111111111'),
          'can_read_org est faux sur une organisation désactivée, même pour l''administrateur');
select is((select count(*)::int from public.organizations), 3,
          'l''administrateur continue de voir une organisation désactivée, sans quoi il ne pourrait plus la réactiver');
reset role;

select * from finish();
rollback;
