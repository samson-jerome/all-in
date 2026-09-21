import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type ProfileError = { code?: string; message: string };

/**
 * 'unlinked' is a normal state: an account with no profile, and no access.
 * 'disabled' is likewise normal: a profile exists but is_active is false --
 * RLS still lets the owner read it, so this must be told apart from
 * 'unlinked' rather than silently reaching 'ready'.
 * 'error' means the profile lookup itself failed: unlike 'unlinked', this is
 * not a fact about the account, it is a fact about the last request.
 */
export type SessionStatus = "loading" | "anonymous" | "unlinked" | "disabled" | "ready" | "error";

export const useSessionStore = defineStore("session", () => {
  const status = ref<SessionStatus>("loading");
  const userId = ref<string | null>(null);
  const profile = ref<Profile | null>(null);
  const agentOrgIds = ref<string[]>([]);
  // Set only when status is 'error': the raw failure behind the failed
  // profile lookup, kept so a screen can turn it into a message via
  // describeError instead of re-deriving one.
  const error = ref<ProfileError | null>(null);

  const role = computed(() => profile.value?.role ?? null);
  const isAdmin = computed(() => role.value === "admin");

  let readyPromise: Promise<void> | null = null;

  async function loadProfile(id: string) {
    error.value = null;
    const { data, error: queryError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (queryError) {
      // A failed read is not an absent profile: don't tell someone their
      // account is unlinked because of a network error or a server issue.
      profile.value = null;
      agentOrgIds.value = [];
      error.value = queryError;
      status.value = "error";
      return;
    }

    if (!data) {
      profile.value = null;
      agentOrgIds.value = [];
      status.value = "unlinked";
      return;
    }

    if (!data.is_active) {
      // The RLS policy lets a user read their own row whatever is_active is,
      // so a deactivated account must be caught here -- otherwise the store
      // reaches 'ready', the shell renders, and every other query silently
      // returns nothing.
      profile.value = data;
      agentOrgIds.value = [];
      status.value = "disabled";
      return;
    }

    profile.value = data;

    // Loaded here even though lot 1 has nothing to filter: the ticket lists of
    // lot 2 need it from their very first render.
    if (data.role === "agent") {
      const { data: rows } = await supabase.from("agent_organizations").select("org_id");
      agentOrgIds.value = rows?.map((row) => row.org_id) ?? [];
    } else {
      agentOrgIds.value = [];
    }

    status.value = "ready";
  }

  async function applySession(id: string | null) {
    userId.value = id;
    if (!id) {
      profile.value = null;
      agentOrgIds.value = [];
      error.value = null;
      status.value = "anonymous";
      return;
    }
    await loadProfile(id);
  }

  function init(): Promise<void> {
    if (readyPromise) return readyPromise;

    readyPromise = (async () => {
      const { data } = await supabase.auth.getSession();
      await applySession(data.session?.user.id ?? null);

      supabase.auth.onAuthStateChange((_event, session) => {
        void applySession(session?.user.id ?? null);
      });
    })();

    return readyPromise;
  }

  async function whenReady(): Promise<void> {
    await init();
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  return { status, userId, profile, agentOrgIds, error, role, isAdmin, init, whenReady, signOut };
});
