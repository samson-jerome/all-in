-- These run as the table owner, which is what breaks the recursion: a policy
-- on profiles may call auth_role(), which reads profiles, without re-entering
-- the policy. An inactive account resolves to null and therefore to no access.
create or replace function public.auth_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
    from public.profiles p
   where p.id = (select auth.uid())
     and p.is_active;
$$;

create or replace function public.auth_org()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.org_id
    from public.profiles p
   where p.id = (select auth.uid())
     and p.is_active
     and p.role = 'client';
$$;

create or replace function public.agent_covers_org(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.agent_organizations ao
      join public.profiles p on p.id = ao.agent_id
     where ao.agent_id = (select auth.uid())
       and ao.org_id = p_org
       and p.is_active
       and p.role = 'agent'
  );
$$;

-- The single definition of "this organization is visible to me".
-- Every later feature branches off this function rather than restating the rule.
create or replace function public.can_read_org(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_org is null then false
    else coalesce(
           public.auth_role() = 'admin'
        or public.auth_org() = p_org
        or public.agent_covers_org(p_org),
      false)
  end;
$$;

revoke all on function public.auth_role()                from public, anon;
revoke all on function public.auth_org()                 from public, anon;
revoke all on function public.agent_covers_org(uuid)     from public, anon;
revoke all on function public.can_read_org(uuid)         from public, anon;

grant execute on function public.auth_role()            to authenticated;
grant execute on function public.auth_org()             to authenticated;
grant execute on function public.agent_covers_org(uuid) to authenticated;
grant execute on function public.can_read_org(uuid)     to authenticated;
