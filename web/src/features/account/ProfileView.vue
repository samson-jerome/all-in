<script setup lang="ts">
import { ref } from "vue";
import { supabase } from "@/lib/supabase";
import { describeError } from "@/lib/errors";
import { useSessionStore } from "@/stores/session";
import { ROLE_LABELS } from "@/lib/roles";

const session = useSessionStore();
const fullName = ref(session.profile?.full_name ?? "");
const message = ref("");

async function save() {
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: fullName.value.trim() })
    .eq("id", session.userId!);

  message.value = error ? describeError(error) : "Enregistré.";
  if (!error && session.profile) session.profile.full_name = fullName.value.trim();
}
</script>

<template>
  <section class="max-w-md space-y-4">
    <h1 class="text-xl font-semibold">Mon compte</h1>
    <p class="text-sm text-slate-600">
      Rôle : {{ ROLE_LABELS[session.role ?? "client"] }}
    </p>
    <form class="space-y-3" @submit.prevent="save">
      <input v-model="fullName" required placeholder="Nom complet"
             class="w-full rounded border border-slate-300 px-3 py-2" />
      <button class="rounded bg-slate-900 px-3 py-2 text-white">Enregistrer</button>
    </form>
    <p v-if="message" class="text-sm">{{ message }}</p>
  </section>
</template>
