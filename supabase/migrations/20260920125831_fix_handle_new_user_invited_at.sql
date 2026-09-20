-- Fixes handle_new_user for the real GoTrue /auth/v1/invite sequence.
--
-- GoTrue's invite endpoint inserts the auth.users row with invited_at still
-- NULL, then sets invited_at with a separate UPDATE. The original trigger
-- only fired on INSERT, so it always saw invited_at IS NULL for an invited
-- client and took the early-return branch: no profile was ever attached
-- through the product's main onboarding route.
--
-- The fix makes the trigger also fire on the UPDATE that sets invited_at.
-- This relies on password self-registration being closed at the auth layer
-- (supabase/config.toml, [auth] enable_signup = false, the global flag --
-- see the comment there for why it is the global one and not
-- [auth.email]'s): GoTrue's invite call reuses whatever auth.users row
-- already matches that email, so if self-registration were open, a
-- squatter could create that row first with their own password and this
-- trigger would attach the invited role to the squatter's account the
-- moment GoTrue set invited_at on it. With signup closed, no such row can
-- exist ahead of an invitation, so the only account a client invitation can
-- ever attach to is the one GoTrue's own insert just created. The
-- role/arrival-route rule that protects the agent/admin branch is
-- untouched. Firing twice for the same user (once on INSERT, once on the
-- later UPDATE) is now possible, so the function gains an idempotence guard
-- that returns early once a profile already exists for that user.
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
  -- Idempotence guard: the trigger can now fire more than once for the same
  -- user (INSERT, then the UPDATE that sets invited_at). A profile already
  -- attached means there is nothing left to do.
  if exists (select 1 from public.profiles where id = new.id) then
    return new;
  end if;

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

-- Also fire when GoTrue's invite flow sets invited_at after the initial
-- insert, so an invited client is attached without waiting on any other
-- event.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of invited_at on auth.users
  for each row execute function public.handle_new_user();
