-- Extends admin_find_user_by_email so invite-user's "existing account"
-- branch can apply the exact same arrival-route rule as handle_new_user()
-- before attaching a role to an account that already exists but has no
-- profile yet.
--
-- Without this, the Edge Function had no way to tell a real OAuth arrival
-- from a self-service password signup on the same address, and would
-- attach an agent/admin profile to whichever account matched the email --
-- exactly the escalation handle_new_user() refuses for the same reason.
drop function if exists public.admin_find_user_by_email(text);

create function public.admin_find_user_by_email(p_email text)
returns table (
  user_id      uuid,
  has_profile  boolean,
  provider     text,
  is_confirmed boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id,
         exists (select 1 from public.profiles p where p.id = u.id),
         u.raw_app_meta_data ->> 'provider',
         u.email_confirmed_at is not null
    from auth.users u
   where lower(trim(u.email)) = lower(trim(p_email))
   limit 1;
$$;

revoke all on function public.admin_find_user_by_email(text) from public, anon, authenticated;
grant execute on function public.admin_find_user_by_email(text) to service_role;
