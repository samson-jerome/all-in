<script setup lang="ts">
import { useSessionStore } from "@/stores/session";
import { useRouter } from "vue-router";
import { describeError } from "@/lib/errors";

const session = useSessionStore();
const router = useRouter();

async function signOut() {
  await session.signOut();
  await router.push({ name: "login" });
}

function retry() {
  window.location.reload();
}
</script>

<template>
  <div class="min-h-screen bg-slate-50 text-slate-900">
    <header v-if="session.status === 'ready'"
            class="flex items-center gap-6 border-b border-slate-200 bg-white px-6 py-3">
      <RouterLink :to="{ name: 'home' }" class="font-semibold">allin</RouterLink>
      <!-- Navigation links arrive with the screens they point to, in task 12. -->
      <button class="ml-auto text-sm underline" @click="signOut">Se déconnecter</button>
    </header>
    <main class="mx-auto max-w-4xl p-6">
      <!-- The profile lookup itself failed: show it everywhere rather than
           letting a screen guess an access level from missing data. -->
      <section v-if="session.status === 'error'" class="space-y-3">
        <h1 class="text-xl font-semibold">Une erreur est survenue</h1>
        <p>{{ describeError(session.error) }}</p>
        <div class="flex gap-4">
          <button class="rounded bg-slate-900 px-3 py-2 text-white" @click="retry">
            Réessayer
          </button>
          <button class="text-sm underline" @click="signOut">Se déconnecter</button>
        </div>
      </section>
      <slot v-else />
    </main>
  </div>
</template>
