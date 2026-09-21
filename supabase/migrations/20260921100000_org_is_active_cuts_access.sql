-- Deactivating an organisation must cut its tenant off. User decision, taken
-- during the final branch review.
--
-- organizations.is_active was consulted by no policy at all: auth_org(),
-- agent_covers_org() and can_read_org() all read profiles.is_active and never
-- the organisation's own flag. The administration screen offered "Désactiver"
-- and an "Active / Inactive" column as though they were an access control,
-- while every client of a deactivated organisation went on reading its row and
-- all of their colleagues' profiles. The button now cuts.
--
-- The check goes into can_read_org() rather than into each policy, because
-- can_read_org() is the single definition of "this organisation is visible to
-- me" and every policy lot 2 adds derives from it (a policy on tickets will
-- read can_read_org(tickets.org_id)). Placed here, the rule arrives with them
-- instead of having to be remembered four more times.
--
-- No exception for agents, and none for administrators either: an inactive
-- organisation is visible to nobody *as a tenant organisation*. A rule with no
-- exception is one a reader can hold in their head and one assertion can test.
create or replace function public.can_read_org(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_org is null then false
    when not exists (
      select 1
        from public.organizations o
       where o.id = p_org
         and o.is_active
    ) then false
    else coalesce(
           public.auth_role() = 'admin'
        or public.auth_org() = p_org
        or public.agent_covers_org(p_org),
      false)
  end;
$$;

-- Administration is not tenancy. Without this clause an administrator would
-- stop seeing a deactivated organisation the instant they deactivated it, and
-- could therefore never reactivate it: the flag would be a one-way door and
-- the "Réactiver" button on the organisations screen would have nothing left
-- to act on. This is exactly the shape profiles_select already has, and for
-- the same reason -- the administration screens need a route to a row that
-- does not go through can_read_org().
--
-- Deliberately an explicit clause on this one policy rather than an exception
-- inside can_read_org(): the helper keeps its one meaning, which lot 2 inherits
-- unchanged, and the exception stays visible where it is granted.
alter policy organizations_select on public.organizations
  using (public.auth_role() = 'admin' or public.can_read_org(id));
