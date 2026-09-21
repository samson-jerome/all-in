-- auth_org() and agent_covers_org() do NOT check organizations.is_active.
--
-- Since 20260921100000, can_read_org() does: deactivating an organisation cuts
-- its tenant off. Its two sibling helpers were left alone deliberately -- they
-- answer narrower questions ("which organisation is this client attached to",
-- "is this agent assigned to that organisation") and can_read_org() is the one
-- place the visibility rule lives.
--
-- The hazard is that both are granted to `authenticated` and read like
-- shortcuts. A lot-2 policy written as `auth_org() = tickets.org_id` -- the
-- obvious thing to write -- silently reopens the tenant that deactivation was
-- supposed to cut. Policies branch off can_read_org(), never off these two.
--
-- Carried as a comment on the function rather than by redefining it: the
-- bodies are correct, and an applied migration is not rewritten. `\df+` and
-- Studio both surface this where someone about to use them would look.
comment on function public.auth_org() is
  'Client''s own org_id. Does NOT check organizations.is_active -- use can_read_org() in policies, or a deactivated organisation stays readable.';

comment on function public.agent_covers_org(uuid) is
  'Agent''s portfolio membership. Does NOT check organizations.is_active -- use can_read_org() in policies, or a deactivated organisation stays readable.';
