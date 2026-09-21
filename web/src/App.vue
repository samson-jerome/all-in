<script setup lang="ts">
import AppShell from "@/components/AppShell.vue";
</script>

<template>
  <!-- Every route renders through this one AppShell slot: AppShell's error
       panel relies on there being exactly one RouterView to suppress. A
       second top-level router-view (an admin layout, a modal) would bypass
       that panel for whatever it renders. -->
  <AppShell>
    <RouterView />
  </AppShell>
</template>
