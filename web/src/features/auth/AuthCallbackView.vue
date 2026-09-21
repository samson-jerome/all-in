<script setup lang="ts">
import { onMounted } from "vue";
import { useRouter } from "vue-router";
import { supabase } from "@/lib/supabase";
import { useSessionStore } from "@/stores/session";

const router = useRouter();
const session = useSessionStore();

onMounted(async () => {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return void router.replace({ name: "login" });

  // An invite or recovery link lands here with no usable password yet.
  const type = new URLSearchParams(window.location.hash.slice(1)).get("type");
  if (type === "invite" || type === "recovery") {
    return void router.replace({ name: "set-password" });
  }

  await session.whenReady();
  const destination =
    session.status === "unlinked" || session.status === "disabled"
      ? { name: "unlinked" }
      : { name: "home" };
  await router.replace(destination);
});
</script>

<template><p>Connexion en cours…</p></template>
