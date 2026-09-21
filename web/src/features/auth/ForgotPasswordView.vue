<script setup lang="ts">
import { ref } from "vue";
import { supabase } from "@/lib/supabase";

const email = ref("");
const sent = ref(false);

async function send() {
  await supabase.auth.resetPasswordForEmail(email.value.trim().toLowerCase(), {
    redirectTo: `${window.location.origin}/auth/callback`,
  });
  // Always the same answer, so the form cannot be used to probe for accounts.
  sent.value = true;
}
</script>

<template>
  <section class="mx-auto max-w-sm space-y-4">
    <h1 class="text-xl font-semibold">Mot de passe oublié</h1>
    <form v-if="!sent" class="space-y-3" @submit.prevent="send">
      <input v-model="email" type="email" required placeholder="Adresse e-mail"
             class="w-full rounded border border-slate-300 px-3 py-2" />
      <button class="w-full rounded bg-slate-900 px-3 py-2 text-white">Envoyer</button>
    </form>
    <p v-else class="text-sm">
      Si un compte existe pour cette adresse, un lien vient d'être envoyé.
    </p>
  </section>
</template>
