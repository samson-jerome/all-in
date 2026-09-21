-- Removes the OAuth arrival-route assumption from handle_new_user().
--
-- OAuth is deferred out of this lot (user decision) and free registration
-- stays closed ([auth] enable_signup = false). Under that combination, an
-- invited internal account arrives with provider = 'email' -- there is no
-- other provider left to arrive with -- so the previous role branch, which
-- demanded a confirmed, non-email provider for agent/admin, rejected every
-- internal invitation outright. No profile was ever created for an invited
-- agent or admin. supabase/seed.sql never caught this because it hand-wrote
-- provider = 'google' on the internal fixtures, reproducing the design
-- assumption instead of the product's actual behaviour.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation public.invitations%rowtype;
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

  -- Entry is by invitation only. Free registration is closed
  -- ([auth] enable_signup = false), so every auth.users row is created
  -- through the admin API on our invitation path, and invited_at is what
  -- GoTrue sets on that path. That makes invited_at a sufficient test of a
  -- legitimate arrival, for every role.
  --
  -- WARNING: this equivalence holds only while signup is closed. If
  -- [auth] enable_signup is ever set back to true -- which the deferred
  -- OAuth work will need -- anyone could create an account for an invited
  -- address and be handed its profile here. Re-read this function before
  -- changing that flag.
  if new.invited_at is null then
    return new;
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

-- The trigger itself is unchanged: on_auth_user_created is already declared
-- `after insert or update of invited_at on auth.users` (set up in
-- 20260920125831_fix_handle_new_user_invited_at.sql), which remains correct
-- for this rule.
