import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

/**
 * Reproduces the concurrency defect found in review round 3: applySession's
 * in-flight coalescer (`pendingApply`) is keyed by id, but two calls for
 * *different* ids share the same single slot. If a second call (for a
 * different id) settles first, its `finally` clears the slot; when the
 * first call's own query settles afterwards, its `finally` finds the slot
 * already cleared. The realistic trigger is Supabase broadcasting auth
 * events across same-origin tabs: this tab's own sign-in can still be in
 * flight when another tab's auth event (sign-out, or a different sign-in)
 * arrives and is applied here through the same listener.
 */

type AuthCallback = (event: string, session: { user: { id: string } } | null) => void;

// vi.mock's factory is hoisted above this file's imports, so anything it
// needs to share with the test body must live inside vi.hoisted too.
const state = vi.hoisted(() => {
  function createDeferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  }

  return {
    createDeferred,
    authCallback: null as AuthCallback | null,
    profileDeferreds: new Map<string, { promise: Promise<unknown>; resolve: (value: unknown) => void }>(),
  };
});

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn((cb: AuthCallback) => {
        state.authCallback = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from: vi.fn((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: (_col: string, id: string) => ({
              maybeSingle: () => {
                const deferred = state.createDeferred<{ data: unknown; error: null }>();
                state.profileDeferreds.set(id, deferred);
                return deferred.promise;
              },
            }),
          }),
        };
      }
      if (table === "agent_organizations") {
        return { select: () => Promise.resolve({ data: [], error: null }) };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  },
}));

import { supabase } from "@/lib/supabase";

function resolveProfile(id: string) {
  const deferred = state.profileDeferreds.get(id);
  if (!deferred) throw new Error(`no pending profiles query for id ${id}`);
  deferred.resolve({
    data: {
      id, full_name: `Test ${id}`, role: "client", org_id: null, is_active: true,
      created_at: "", updated_at: "",
    },
    error: null,
  });
}

// Flushing with a macrotask (rather than counting microtask ticks) waits for
// every microtask queued so far to drain, including the ones inside
// applySession's own try/finally.
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("session store applySession coalescing", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    state.authCallback = null;
    state.profileDeferreds.clear();
    vi.mocked(supabase.auth.getSession).mockReset();
    vi.mocked(supabase.from).mockClear();
  });

  it("does not let a different id's settlement corrupt this tab's own already-resolved session", async () => {
    const { useSessionStore } = await import("@/stores/session");
    const session = useSessionStore();

    // Boot anonymous and register the auth listener, exactly as main.ts does.
    vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({ data: { session: null } });
    await session.init();
    expect(state.authCallback).not.toBeNull();

    // Call A: this tab signs in as user-x. sync() awaits applySession
    // through the store's own try/catch, which is exactly where the
    // coordinator's "overwrites a correct ready session" consequence shows.
    vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
      data: { session: { user: { id: "user-x" } } },
    });
    const syncPromise = session.sync();

    // Let A's own getSession() resolve and applySession("user-x") register
    // itself as the coalescer's current owner before B arrives -- otherwise
    // B would register first and this wouldn't reproduce the reported order.
    await flush();

    // Call B: another tab's auth event for a *different* user arrives while
    // A's profile query is still in flight -- the cross-tab broadcast the
    // coordinator described.
    state.authCallback!("SIGNED_IN", { user: { id: "user-y" } });

    // Let B settle first: it becomes the coalescer's owner, then clears it.
    resolveProfile("user-y");
    await flush();

    // Now let A settle. Before the fix, A's finally dereferences the
    // coalescer slot that B's finally already cleared to null, which throws
    // and is caught by sync()'s own try/catch -- turning this correctly
    // resolved 'ready' session into a false 'error' one.
    resolveProfile("user-x");
    await syncPromise;

    // This reproduction is only about the coalescer, not about which of two
    // concurrent, unrelated identities ends up reflected in the store --
    // that ordering is incidental here and out of scope (the coordinator
    // was explicit: fix the null dereference, don't redesign the
    // coalescer). What must hold is that A's own settlement, after being
    // displaced, neither throws nor corrupts a resolved session into 'error'.
    expect(session.status).not.toBe("error");
    expect(session.status).toBe("ready");
    expect(session.error).toBeNull();
  });

  it("still coalesces two concurrent calls for the same id into a single profiles query", async () => {
    const { useSessionStore } = await import("@/stores/session");
    const session = useSessionStore();

    vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({ data: { session: null } });
    await session.init();

    state.authCallback!("SIGNED_IN", { user: { id: "user-z" } });
    state.authCallback!("SIGNED_IN", { user: { id: "user-z" } });

    const profilesCalls = vi.mocked(supabase.from).mock.calls.filter(([table]) => table === "profiles");
    expect(profilesCalls).toHaveLength(1);

    resolveProfile("user-z");
    await flush();

    expect(session.status).toBe("ready");
    expect(session.userId).toBe("user-z");
  });
});
