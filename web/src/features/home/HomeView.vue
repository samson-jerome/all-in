<script setup lang="ts">
import { useSessionStore } from "@/stores/session";
const session = useSessionStore();
</script>

<template>
  <section class="space-y-2">
    <h1 class="text-xl font-semibold">Bonjour {{ session.profile?.full_name }}</h1>
    <p class="text-slate-600">Les tickets arriveront ici au lot 2.</p>
  </section>
</template>
