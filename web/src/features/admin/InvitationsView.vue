<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { supabase } from "@/lib/supabase";
import { describeError } from "@/lib/errors";
import { callFunction } from "@/lib/functions";
import { ROLE_LABELS } from "@/lib/roles";
import type { Database } from "@/lib/database.types";

type Invitation = Database["public"]["Tables"]["invitations"]["Row"];

const STATUS_LABELS: Record<string, string> = {
  pending: "En attente",
  accepted: "Acceptée",
  revoked: "Révoquée",
};

const invitations = ref<Invitation[]>([]);
const organizations = ref<{ id: string; name: string; is_active: boolean }[]>([]);
// A new invitation must only offer an organisation someone can actually be
// attached to today.
const activeOrganizations = computed(() =>
  organizations.value.filter((organization) => organization.is_active),
);
const email = ref("");
const role = ref<"client" | "agent" | "admin">("client");
const orgId = ref("");
const message = ref("");
const notice = ref("");
// The invitee's own historical invitation row must not offer "Retirer
// l'accès" on itself: the endpoint refuses self-targeting the same way
// admin-update-user does, and offering a control that can only fail is
// dishonest UI. Fetched once from the current session's own auth data --
// profiles carries no email column to compare against.
const selfEmail = ref<string | null>(null);

async function load() {
  const [invitationsResult, orgsResult] = await Promise.all([
    supabase.from("invitations").select("*").order("created_at", { ascending: false }),
    supabase.from("organizations").select("id, name, is_active").order("name"),
  ]);

  const error = invitationsResult.error ?? orgsResult.error;
  if (error) {
    // A denied or failed read must say so, not render an empty table: "no
    // invitations" is a state the database does not actually have.
    message.value = describeError(error);
    return;
  }

  invitations.value = invitationsResult.data ?? [];
  organizations.value = orgsResult.data ?? [];
  message.value = "";
}

function isSelfInvitation(invitation: Invitation) {
  return (
    selfEmail.value !== null && invitation.email.toLowerCase() === selfEmail.value.toLowerCase()
  );
}

async function invite() {
  notice.value = "";
  const { data, message: error } = await callFunction<{ status: string }>("invite-user", {
    email: email.value,
    role: role.value,
    org_id: role.value === "client" ? orgId.value : null,
  });

  message.value = error;
  if (error) return;

  // invite-user always sends an invitation mail now (every role, since no
  // internal user provisions itself through OAuth any more), except in the
  // rare case where the address already had an account with no profile --
  // that account is attached directly, and no new mail goes out.
  notice.value = data?.status === "profile_created"
    ? "Un compte existait déjà pour cette adresse : le profil a été rattaché directement, aucun courriel n'a été envoyé."
    : "Invitation envoyée : la personne recevra un courriel avec un lien pour définir son mot de passe.";

  email.value = "";
  await load();
}

async function confirmRevoke(invitation: Invitation) {
  const confirmed = window.confirm(
    `Retirer l'accès de ${invitation.email} ? Son compte sera désactivé et ses sessions actives seront terminées.`,
  );
  if (!confirmed) return;

  notice.value = "";
  const { data, message: error } = await callFunction<{ access_revoked: boolean }>(
    "revoke-invitation",
    { invitation_id: invitation.id },
  );
  message.value = error;
  if (error) return;

  notice.value = data?.access_revoked
    ? `Accès retiré pour ${invitation.email}.`
    : `Invitation révoquée pour ${invitation.email}.`;
  await load();
}

onMounted(async () => {
  const { data } = await supabase.auth.getUser();
  selfEmail.value = data.user?.email ?? null;
  await load();
});
</script>

<template>
  <section class="space-y-6">
    <h1 class="text-xl font-semibold">Invitations</h1>

    <form class="flex flex-wrap gap-2" @submit.prevent="invite">
      <input v-model="email" type="email" required placeholder="Adresse e-mail"
             class="rounded border border-slate-300 px-3 py-2" />
      <select v-model="role" class="rounded border border-slate-300 px-3 py-2">
        <option value="client">Client</option>
        <option value="agent">Agent</option>
        <option value="admin">Administrateur</option>
      </select>
      <select v-if="role === 'client'" v-model="orgId" required
              class="rounded border border-slate-300 px-3 py-2">
        <option value="">Organisation…</option>
        <option v-for="organization in activeOrganizations" :key="organization.id"
                :value="organization.id">{{ organization.name }}</option>
      </select>
      <button class="rounded bg-slate-900 px-3 py-2 text-white">Inviter</button>
    </form>

    <p class="text-sm text-slate-500">
      Pour redonner l'accès à une personne qui l'a perdu, utilisez « Réactiver » sur l'écran
      Utilisateurs : son profil existe toujours, désactivé, et une nouvelle invitation à la
      même adresse sera refusée.
    </p>

    <p v-if="notice" class="text-sm text-slate-700">{{ notice }}</p>

    <table class="w-full text-left text-sm">
      <thead class="border-b border-slate-300">
        <tr><th class="py-2">Adresse</th><th>Rôle</th><th>État</th><th></th></tr>
      </thead>
      <tbody>
        <tr v-for="invitation in invitations" :key="invitation.id"
            class="border-b border-slate-100">
          <td class="py-2">{{ invitation.email }}</td>
          <td>{{ ROLE_LABELS[invitation.role] }}</td>
          <td>{{ STATUS_LABELS[invitation.status] ?? invitation.status }}</td>
          <td>
            <span v-if="isSelfInvitation(invitation) && invitation.status !== 'revoked'"
                  class="text-xs text-slate-400">Vous</span>
            <button v-else-if="invitation.status !== 'revoked'" class="underline"
                    @click="confirmRevoke(invitation)">Retirer l'accès</button>
          </td>
        </tr>
      </tbody>
    </table>

    <p v-if="message" class="text-sm text-red-700">{{ message }}</p>
  </section>
</template>
