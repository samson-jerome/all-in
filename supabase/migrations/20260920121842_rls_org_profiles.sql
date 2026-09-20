-- Supabase grants every new public table to anon and authenticated by default.
-- Take it all back, then hand out exactly what each role needs.
revoke all on table public.organizations from anon, authenticated;
revoke all on table public.profiles      from anon, authenticated;

grant select, insert, update on table public.organizations to authenticated;
grant select                 on table public.profiles      to authenticated;
-- RLS cannot restrict by column, so the column privilege does it: a user may
-- rename themselves and nothing else.
grant update (full_name)     on table public.profiles      to authenticated;

alter table public.organizations enable row level security;
alter table public.profiles      enable row level security;

create policy organizations_select on public.organizations
  for select to authenticated
  using (public.can_read_org(id));

create policy organizations_insert on public.organizations
  for insert to authenticated
  with check (public.auth_role() = 'admin');

create policy organizations_update on public.organizations
  for update to authenticated
  using (public.auth_role() = 'admin')
  with check (public.auth_role() = 'admin');

-- The admin clause is not redundant with can_read_org(): agents and
-- administrators carry a null org_id, and can_read_org(null) is false.
-- Without it, the user administration screen could not list them.
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or public.auth_role() = 'admin'
    or public.can_read_org(org_id)
  );

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
