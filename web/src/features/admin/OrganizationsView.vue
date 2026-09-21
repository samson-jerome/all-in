<script setup lang="ts">
import { onMounted, ref } from "vue";
import { supabase } from "@/lib/supabase";
import { describeError } from "@/lib/errors";
import type { Database } from "@/lib/database.types";

type Organization = Database["public"]["Tables"]["organizations"]["Row"];

const organizations = ref<Organization[]>([]);
const name = ref("");
const slug = ref("");
const message = ref("");

async function load() {
  const { data, error } = await supabase.from("organizations").select("*").order("name");
  if (error) {
    // A denied or failed read must say so, not render an empty table: "no
    // organisations" is a state the database does not actually have.
    message.value = describeError(error);
    return;
  }
  organizations.value = data ?? [];
  message.value = "";
}

async function create() {
  const { error } = await supabase
    .from("organizations")
    .insert({ name: name.value.trim(), slug: slug.value.trim().toLowerCase() });

  if (error) return void (message.value = describeError(error));
  name.value = "";
  slug.value = "";
  await load();
}

async function toggle(organization: Organization) {
  const { error } = await supabase
    .from("organizations")
    .update({ is_active: !organization.is_active })
    .eq("id", organization.id);

  if (error) return void (message.value = describeError(error));
  await load();
}

onMounted(load);
</script>

<template>
  <section class="space-y-6">
    <h1 class="text-xl font-semibold">Organisations</h1>

    <form class="flex gap-2" @submit.prevent="create">
      <input v-model="name" required placeholder="Nom"
             class="rounded border border-slate-300 px-3 py-2" />
      <input v-model="slug" required placeholder="identifiant"
             class="rounded border border-slate-300 px-3 py-2" />
      <button class="rounded bg-slate-900 px-3 py-2 text-white">Créer</button>
    </form>

    <table class="w-full text-left text-sm">
      <thead class="border-b border-slate-300">
        <tr><th class="py-2">Nom</th><th>Identifiant</th><th>État</th><th></th></tr>
      </thead>
      <tbody>
        <tr v-for="organization in organizations" :key="organization.id"
            class="border-b border-slate-100">
          <td class="py-2">{{ organization.name }}</td>
          <td>{{ organization.slug }}</td>
          <td>{{ organization.is_active ? "Active" : "Inactive" }}</td>
          <td>
            <button class="underline" @click="toggle(organization)">
              {{ organization.is_active ? "Désactiver" : "Réactiver" }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <p v-if="message" class="text-sm text-red-700">{{ message }}</p>
  </section>
</template>
