<script setup lang="ts">
import { useSessionStore } from "@/stores/session";
import { describeError } from "@/lib/errors";

const session = useSessionStore();
</script>

<template>
  <section class="space-y-3">
    <template v-if="session.status === 'error'">
      <h1 class="text-xl font-semibold">Une erreur est survenue</h1>
      <p>{{ describeError(session.error) }}</p>
    </template>
    <template v-else-if="session.status === 'disabled'">
      <h1 class="text-xl font-semibold">Accès désactivé</h1>
      <p>
        Votre compte existe mais son accès a été retiré.
        Contactez un administrateur si vous pensez qu'il s'agit d'une erreur.
      </p>
    </template>
    <template v-else>
      <h1 class="text-xl font-semibold">Compte non rattaché</h1>
      <p>
        Votre compte existe mais n'est rattaché à aucune organisation.
        Contactez un administrateur pour obtenir un accès.
      </p>
    </template>
  </section>
</template>
