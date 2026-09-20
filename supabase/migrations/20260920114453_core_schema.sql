create type public.app_role as enum ('client', 'agent', 'admin');

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  slug        text not null unique check (slug = lower(slug)),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null check (length(trim(full_name)) > 0),
  role        public.app_role not null,
  org_id      uuid references public.organizations(id),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint profiles_client_requires_org check (
    (role =  'client' and org_id is not null) or
    (role <> 'client' and org_id is null)
  )
);

create index profiles_org_id_idx on public.profiles (org_id);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create table public.agent_organizations (
  agent_id    uuid not null references public.profiles(id) on delete cascade,
  org_id      uuid not null references public.organizations(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (agent_id, org_id)
);

create table public.invitations (
  id          uuid primary key default gen_random_uuid(),
  email       text not null check (email = lower(trim(email))),
  role        public.app_role not null,
  org_id      uuid references public.organizations(id),
  invited_by  uuid references public.profiles(id),
  status      text not null default 'pending'
                check (status in ('pending', 'accepted', 'revoked')),
  created_at  timestamptz not null default now(),
  accepted_at timestamptz,
  constraint invitations_client_requires_org check (
    (role =  'client' and org_id is not null) or
    (role <> 'client' and org_id is null)
  )
);

-- At most one live invitation per address.
create unique index invitations_one_pending_per_email
  on public.invitations (email)
  where status = 'pending';
