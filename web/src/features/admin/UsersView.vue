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

const session = useSessionStore();

const users = ref<UserRow[]>([]);
const organizations = ref<{ id: string; name: string }[]>([]);
const portfolios = ref<Record<string, string[]>>({});
const message = ref("");
// Id of the user currently mid-way through "becoming a client": the role
// select alone cannot supply the organisation the endpoint requires, so this
// tracks that an inline picker is open for that row instead of submitting a
// change guaranteed to fail with org_required_for_client.
const pendingClientOrgFor = ref<string | null>(null);

async function load() {
  const [{ data: profiles }, { data: orgs }, { data: assignments }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, role, org_id, is_active").order("full_name"),
    supabase.from("organizations").select("id, name").order("name"),
    supabase.from("agent_organizations").select("agent_id, org_id"),
  ]);

  users.value = (profiles ?? []) as UserRow[];
  organizations.value = orgs ?? [];

  portfolios.value = {};
  for (const row of assignments ?? []) {
    (portfolios.value[row.agent_id] ??= []).push(row.org_id);
  }
}

async function updateUser(user: UserRow, changes: Record<string, unknown>) {
  const { message: error } = await callFunction("admin-update-user", {
    user_id: user.id,
    ...changes,
  });
  message.value = error;
  if (!error) await load();
}

function onRoleChange(user: UserRow, newRole: string) {
  if (newRole === "client" && !user.org_id) {
    // Converting an internal user to a client needs an organisation, which
    // this dropdown alone cannot supply. Ask for it inline instead of
    // submitting a change the endpoint would reject.
    pendingClientOrgFor.value = user.id;
    return;
  }
  pendingClientOrgFor.value = null;
  updateUser(user, {
    role: newRole,
    // A client keeps its current organisation; an internal role never
    // carries one. Sending the client's stale org_id alongside a new
    // internal role would trip the endpoint's org_forbidden_for_internal
    // guard.
    org_id: newRole === "client" ? user.org_id : null,
  });
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

function organizationName(id: string) {
  return organizations.value.find((organization) => organization.id === id)?.name ?? id;
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
                    @change="onRoleChange(user, ($event.target as HTMLSelectElement).value)">
              <option value="client">Client</option>
              <option value="agent">Agent</option>
              <option value="admin">Administrateur</option>
            </select>
            <div v-if="pendingClientOrgFor === user.id" class="mt-1 flex items-center gap-1 text-xs">
              <select class="rounded border border-slate-300 px-1 py-0.5"
                      @change="confirmClientRole(user, ($event.target as HTMLSelectElement).value)">
                <option value="">Organisation…</option>
                <option v-for="organization in organizations" :key="organization.id"
                        :value="organization.id">{{ organization.name }}</option>
              </select>
              <button class="underline" @click="pendingClientOrgFor = null">annuler</button>
            </div>
          </td>
          <td>
            <select v-if="user.role === 'client'" :value="user.org_id ?? ''"
                    class="rounded border border-slate-300 px-2 py-1"
                    @change="updateUser(user, {
                      org_id: ($event.target as HTMLSelectElement).value,
                    })">
              <option v-for="organization in organizations" :key="organization.id"
                      :value="organization.id">{{ organization.name }}</option>
            </select>

            <div v-else-if="user.role === 'agent'" class="space-y-1">
              <div v-for="orgId in portfolios[user.id] ?? []" :key="orgId">
                {{ organizationName(orgId) }}
                <button class="ml-2 underline" @click="removeFromPortfolio(user.id, orgId)">
                  retirer
                </button>
              </div>
              <select class="rounded border border-slate-300 px-2 py-1"
                      @change="addToPortfolio(user.id, ($event.target as HTMLSelectElement).value)">
                <option value="">Ajouter une organisation…</option>
                <option v-for="organization in organizations" :key="organization.id"
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
