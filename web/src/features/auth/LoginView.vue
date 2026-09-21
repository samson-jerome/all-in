<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { supabase } from "@/lib/supabase";
import { useSessionStore } from "@/stores/session";

const email = ref("");
const password = ref("");
const message = ref("");
const busy = ref(false);
const route = useRoute();
const router = useRouter();
const session = useSessionStore();

async function signInWithPassword() {
  busy.value = true;
  message.value = "";
  const { error } = await supabase.auth.signInWithPassword({
    email: email.value.trim().toLowerCase(),
    password: password.value,
  });
  if (error) {
    busy.value = false;
    message.value = "Adresse ou mot de passe incorrect.";
    return;
  }
  // Settle the store before navigating: onAuthStateChange applies the new
  // session asynchronously, and the guard decides on session.status -- without
  // waiting here, the guard can still see the pre-login state and bounce
  // back to this screen right after a correct password.
  await session.sync();
  busy.value = false;
  await router.push(String(route.query.redirect ?? "/"));
}
</script>

<template>
  <section class="mx-auto max-w-sm space-y-6">
    <h1 class="text-xl font-semibold">Connexion</h1>

    <form class="space-y-3" @submit.prevent="signInWithPassword">
      <input v-model="email" type="email" required placeholder="Adresse e-mail"
             class="w-full rounded border border-slate-300 px-3 py-2" />
      <input v-model="password" type="password" required placeholder="Mot de passe"
             class="w-full rounded border border-slate-300 px-3 py-2" />
      <button type="submit" :disabled="busy"
              class="w-full rounded bg-slate-900 px-3 py-2 text-white">Se connecter</button>
    </form>

    <p class="text-sm">
      <RouterLink :to="{ name: 'forgot-password' }" class="underline">
        Mot de passe oublié
      </RouterLink>
    </p>

    <p v-if="message" class="text-sm text-red-700">{{ message }}</p>
  </section>
</template>
