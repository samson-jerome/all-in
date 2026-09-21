-- Seeds the very first administrator invitation. Nobody can invite them,
-- so this runs once per environment, with the address passed in.
-- Usage: psql "$DB_URL" -v email="'personne@exemple.fr'" -f this_file.sql
insert into public.invitations (email, role, org_id)
select lower(trim(:email)), 'admin', null
where not exists (
  select 1 from public.invitations
   where email = lower(trim(:email)) and status = 'pending'
)
and not exists (
  select 1 from auth.users u
    join public.profiles p on p.id = u.id
   where lower(trim(u.email)) = lower(trim(:email))
);
