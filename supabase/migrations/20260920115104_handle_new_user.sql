-- Links a freshly created auth user to a pending invitation.
-- No invitation, no profile: RLS then denies everything to that account.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation public.invitations%rowtype;
  v_provider   text := new.raw_app_meta_data ->> 'provider';
  v_full_name  text;
begin
  select * into v_invitation
    from public.invitations
   where email = lower(trim(new.email))
     and status = 'pending'
   limit 1;

  if not found then
    return new;
  end if;

  -- The arrival route must match the invited role, otherwise an outsider
  -- could claim a pending agent invitation by signing up with a password.
  if v_invitation.role = 'client' then
    if new.invited_at is null then
      return new;
    end if;
  else
    if v_provider is null
       or v_provider = 'email'
       or new.email_confirmed_at is null then
      return new;
    end if;
  end if;

  v_full_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    split_part(new.email, '@', 1)
  );

  insert into public.profiles (id, full_name, role, org_id)
  values (new.id, v_full_name, v_invitation.role, v_invitation.org_id);

  update public.invitations
     set status = 'accepted', accepted_at = now()
   where id = v_invitation.id;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Service-only helpers, called by Edge Functions with the service_role key.
create or replace function public.admin_find_user_by_email(p_email text)
returns table (user_id uuid, has_profile boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id,
         exists (select 1 from public.profiles p where p.id = u.id)
    from auth.users u
   where lower(trim(u.email)) = lower(trim(p_email))
   limit 1;
$$;

create or replace function public.admin_revoke_sessions(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.sessions where user_id = p_user_id;
$$;

revoke all on function public.admin_find_user_by_email(text) from public, anon, authenticated;
revoke all on function public.admin_revoke_sessions(uuid)    from public, anon, authenticated;
grant execute on function public.admin_find_user_by_email(text) to service_role;
grant execute on function public.admin_revoke_sessions(uuid)    to service_role;
