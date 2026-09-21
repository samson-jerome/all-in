<script setup lang="ts">
import { onMounted, ref } from "vue";
import { supabase } from "@/lib/supabase";
import { describeError } from "@/lib/errors";
import { callFunction } from "@/lib/functions";
import { useSessionStore } from "@/stores/session";

type UserRow = {
  id: string;
  full_name: string;
  role: "client" | "agent" | "admin";
  org_id: string | null;
  is_active: boolean;
};

type OrganizationOption = { id: string; name: string; is_active: boolean };

const session = useSessionStore();

const users = ref<UserRow[]>([]);
const organizations = ref<OrganizationOption[]>([]);
const portfolios = ref<Record<string, string[]>>({});
const message = ref("");
// Id of the user currently mid-way through "becoming a client": the role
// select alone cannot supply the organisation the endpoint requires, so this
// tracks that an inline picker is open for that row instead of submitting a
// change guaranteed to fail with org_required_for_client.
const pendingClientOrgFor = ref<string | null>(null);

async function load() {
  const [profilesResult, orgsResult, assignmentsResult] = await Promise.all([
    supabase.from("profiles").select("id, full_name, role, org_id, is_active").order("full_name"),
    supabase.from("organizations").select("id, name, is_active").order("name"),
    supabase.from("agent_organizations").select("agent_id, org_id"),
  ]);

  const error = profilesResult.error ?? orgsResult.error ?? assignmentsResult.error;
  if (error) {
    // A denied or failed read must say so, not render empty tables: "there
    // are no users" is a state the database does not actually have.
    message.value = describeError(error);
    return;
  }

  users.value = (profilesResult.data ?? []) as UserRow[];
  organizations.value = orgsResult.data ?? [];

  portfolios.value = {};
  for (const row of assignmentsResult.data ?? []) {
    (portfolios.value[row.agent_id] ??= []).push(row.org_id);
  }

  message.value = "";
}

// Organisations offered in a picker: active only, plus the current value if
// it happens to be one that has since been deactivated -- omitting it there
// would misrepresent a real, still-recorded assignment rather than just hide
// an unrelated choice.
//
// Since 20260921100000_org_is_active_cuts_access.sql, a deactivated
// organisation no longer grants its clients anything: the assignment is still
// recorded, but it no longer gives access. The reinjected option therefore
// says so (see optionLabel below) instead of reading like any other choice.
function pickerOptions(currentOrgId?: string | null): OrganizationOption[] {
  const active = organizations.value.filter((organization) => organization.is_active);
  if (!currentOrgId || active.some((organization) => organization.id === currentOrgId)) {
    return active;
  }
  const current = organizations.value.find((organization) => organization.id === currentOrgId);
  return current ? [...active, current] : active;
}

// Only the reinjected value above can ever be inactive: pickerOptions() with
// no argument returns active organisations only.
function optionLabel(organization: OrganizationOption): string {
  return organization.is_active
    ? organization.name
    : `${organization.name} (désactivée — accès coupé)`;
}

async function updateUser(user: UserRow, changes: Record<string, unknown>): Promise<boolean> {
  const { message: error } = await callFunction("admin-update-user", {
    user_id: user.id,
    ...changes,
  });
  message.value = error;
  if (error) return false;
  await load();
  return true;
}

async function onRoleChange(user: UserRow, event: Event) {
  const target = event.target as HTMLSelectElement;
  const newRole = target.value;

  if (newRole === "client" && !user.org_id) {
    // Converting an internal user to a client needs an organisation, which
    // this dropdown alone cannot supply. Ask for it inline instead of
    // submitting a change the endpoint would reject.
    pendingClientOrgFor.value = user.id;
    return;
  }

  pendingClientOrgFor.value = null;
  const ok = await updateUser(user, {
    role: newRole,
    // A client keeps its current organisation; an internal role never
    // carries one. Sending the client's stale org_id alongside a new
    // internal role would trip the endpoint's org_forbidden_for_internal
    // guard.
    org_id: newRole === "client" ? user.org_id : null,
  });

  if (!ok) {
    // This select is bound with a plain :value, so once the person picks an
    // option the browser owns the displayed value until something patches
    // it back. On success, load() replaces user.role and the normal render
    // cycle updates it; on failure nothing about user.role changes, so
    // nothing guarantees the control reverts on its own. Force it back to
    // what the database still holds rather than leave an unsaved choice on
    // screen.
    target.value = user.role;
  }
}

async function onOrgChange(user: UserRow, event: Event) {
  const target = event.target as HTMLSelectElement;
  const ok = await updateUser(user, { org_id: target.value });
  if (!ok) target.value = user.org_id ?? "";
}

async function confirmClientRole(user: UserRow, orgId: string) {
  if (!orgId) return;
  pendingClientOrgFor.value = null;
  await updateUser(user, { role: "client", org_id: orgId });
}

async function addToPortfolio(agentId: string, orgId: string) {
  if (!orgId) return;
  const { error } = await supabase
    .from("agent_organizations")
    .insert({ agent_id: agentId, org_id: orgId });

  if (error) return void (message.value = describeError(error));
  await load();
}

async function removeFromPortfolio(agentId: string, orgId: string) {
  const { error } = await supabase
    .from("agent_organizations")
    .delete()
    .eq("agent_id", agentId)
    .eq("org_id", orgId);

  if (error) return void (message.value = describeError(error));
  await load();
}

// An agent's portfolio row, which is plain text rather than a picker. It gets
// the same marking as the client picker: a deactivated organisation is still
// a real, recorded assignment, and it now grants nothing. Marking one place
// and not the other would be worse than marking neither.
function organizationName(id: string) {
  const organization = organizations.value.find((candidate) => candidate.id === id);
  return organization ? optionLabel(organization) : id;
}

onMounted(load);
</script>

<template>
  <section class="space-y-6">
    <h1 class="text-xl font-semibold">Utilisateurs</h1>

    <table class="w-full text-left text-sm">
      <thead class="border-b border-slate-300">
        <tr><th class="py-2">Nom</th><th>Rôle</th><th>Organisation</th><th>État</th><th></th></tr>
      </thead>
      <tbody>
        <tr v-for="user in users" :key="user.id" class="border-b border-slate-100 align-top">
          <td class="py-2">{{ user.full_name }}</td>
          <td>
            <!-- Disabled for the connected administrator's own row: the
                 endpoint refuses any role change on the caller (cannot_modify_self),
                 so offering the control here would invite a click that can
                 only fail. -->
            <select :value="pendingClientOrgFor === user.id ? 'client' : user.role"
                    :disabled="user.id === session.userId"
                    class="rounded border border-slate-300 px-2 py-1 disabled:opacity-50"
                    @change="onRoleChange(user, $event)">
              <option value="client">Client</option>
              <option value="agent">Agent</option>
              <option value="admin">Administrateur</option>
            </select>
            <div v-if="pendingClientOrgFor === user.id" class="mt-1 flex items-center gap-1 text-xs">
              <select class="rounded border border-slate-300 px-1 py-0.5"
                      @change="confirmClientRole(user, ($event.target as HTMLSelectElement).value)">
                <option value="">Organisation…</option>
                <option v-for="organization in pickerOptions()" :key="organization.id"
                        :value="organization.id">{{ organization.name }}</option>
              </select>
              <button class="underline" @click="pendingClientOrgFor = null">Annuler</button>
            </div>
          </td>
          <td>
            <select v-if="user.role === 'client'" :value="user.org_id ?? ''"
                    class="rounded border border-slate-300 px-2 py-1"
                    @change="onOrgChange(user, $event)">
              <option v-for="organization in pickerOptions(user.org_id)" :key="organization.id"
                      :value="organization.id">{{ optionLabel(organization) }}</option>
            </select>

            <div v-else-if="user.role === 'agent'" class="space-y-1">
              <div v-for="orgId in portfolios[user.id] ?? []" :key="orgId">
                {{ organizationName(orgId) }}
                <button class="ml-2 underline" @click="removeFromPortfolio(user.id, orgId)">
                  Retirer
                </button>
              </div>
              <select class="rounded border border-slate-300 px-2 py-1"
                      @change="addToPortfolio(user.id, ($event.target as HTMLSelectElement).value)">
                <option value="">Ajouter une organisation…</option>
                <option v-for="organization in pickerOptions()" :key="organization.id"
                        :value="organization.id">{{ organization.name }}</option>
              </select>
            </div>

            <span v-else class="text-slate-400">—</span>
          </td>
          <td>{{ user.is_active ? "Actif" : "Désactivé" }}</td>
          <td>
            <!-- Same reasoning as the role select: an administrator cannot
                 deactivate themselves, so no control is offered for it. -->
            <span v-if="user.id === session.userId" class="text-xs text-slate-400">Vous</span>
            <button v-else class="underline" @click="updateUser(user, { is_active: !user.is_active })">
              {{ user.is_active ? "Désactiver" : "Réactiver" }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <p v-if="message" class="text-sm text-red-700">{{ message }}</p>
  </section>
</template>
