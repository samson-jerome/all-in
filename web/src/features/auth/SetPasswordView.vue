<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { supabase } from "@/lib/supabase";
import { describeError } from "@/lib/errors";

const password = ref("");
const message = ref("");
const router = useRouter();

async function save() {
  const { error } = await supabase.auth.updateUser({ password: password.value });
  if (error) return void (message.value = describeError(error));
  await router.push({ name: "home" });
}
</script>

<template>
  <section class="mx-auto max-w-sm space-y-4">
    <h1 class="text-xl font-semibold">Définir votre mot de passe</h1>
    <form class="space-y-3" @submit.prevent="save">
      <input v-model="password" type="password" required minlength="8"
             placeholder="Nouveau mot de passe"
             class="w-full rounded border border-slate-300 px-3 py-2" />
      <button class="w-full rounded bg-slate-900 px-3 py-2 text-white">Enregistrer</button>
    </form>
    <p v-if="message" class="text-sm text-red-700">{{ message }}</p>
  </section>
</template>
