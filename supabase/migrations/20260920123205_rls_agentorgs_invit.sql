revoke all on table public.agent_organizations from anon, authenticated;
revoke all on table public.invitations         from anon, authenticated;

grant select, insert, delete on table public.agent_organizations to authenticated;
-- Read only. Every write goes through an Edge Function, because creating an
-- invitation and calling the auth admin API must happen together.
grant select                 on table public.invitations         to authenticated;

alter table public.agent_organizations enable row level security;
alter table public.invitations         enable row level security;

create policy agent_organizations_select on public.agent_organizations
  for select to authenticated
  using (agent_id = (select auth.uid()) or public.auth_role() = 'admin');

create policy agent_organizations_insert on public.agent_organizations
  for insert to authenticated
  with check (public.auth_role() = 'admin');

create policy agent_organizations_delete on public.agent_organizations
  for delete to authenticated
  using (public.auth_role() = 'admin');

create policy invitations_select on public.invitations
  for select to authenticated
  using (public.auth_role() = 'admin');
