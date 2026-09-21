<script setup lang="ts">
import { computed } from "vue";
import { useSessionStore } from "@/stores/session";
import { useRoute, useRouter } from "vue-router";
import { describeError } from "@/lib/errors";
import { PUBLIC_ROUTES } from "@/router/guards";

const session = useSessionStore();
const route = useRoute();
const router = useRouter();

async function signOut() {
  await session.signOut();
  await router.push({ name: "login" });
}

function retry() {
  window.location.reload();
}

// A public route (login, the invite/recovery callback, set-password,
// forgot-password, unlinked, forbidden) is how someone gets in or recovers
// access in the first place -- a missing or failed profile lookup there is
// either expected (the profile isn't created yet) or irrelevant to what the
// screen does. The error panel must never cover one of those, only a route
// that actually depends on a resolved, working session.
const showErrorPanel = computed(
  () => session.status === "error" && !PUBLIC_ROUTES.has(String(route.name)),
);
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
      <section v-if="showErrorPanel" class="space-y-3">
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
