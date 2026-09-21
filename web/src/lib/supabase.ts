import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * Type carried by an authentication link's fragment (`invite`, `recovery`,
 * …), captured before the client below can consume it — null on an ordinary
 * page load.
 *
 * It has to be read here, on the line before `createClient`, and not in the
 * view that needs it. The client is created with `detectSessionInUrl: true`,
 * and `main.ts` awaits the session store's `init()` before the router is even
 * installed: by the time `AuthCallbackView`'s `onMounted` runs, supabase-js
 * has already consumed the fragment and cleared it with
 * `history.replaceState`. Reading `window.location.hash` from the view
 * therefore always yielded null, the `type=invite` branch never ran, and an
 * invited person landed on the home page signed in, without ever being asked
 * for a password — measured in a browser, not deduced.
 *
 * Capturing it in this module rather than in an earlier import makes the
 * ordering structural instead of conventional: anything able to observe this
 * value has, by definition, already imported this module, whose body runs it
 * before the client exists.
 *
 * Two consequences to keep in mind before reusing it:
 *
 * - **It is a snapshot of the initial page load, not a live reading.** That
 *   is correct today because nothing in the application routes to
 *   `/auth/callback` from inside the app: the only way there is a full load
 *   from an e-mail link. The first in-app navigation to that route would
 *   read a stale `"invite"` and bounce an already-signed-in person to the
 *   password screen. Whoever adds such a navigation has to revisit this.
 * - **This module now touches `window` at import time**, so it can no longer
 *   be imported outside a DOM environment. The Vitest suite runs in `node`
 *   and gets away with it only because it mocks this module
 *   (`vi.mock("@/lib/supabase")`) instead of loading it.
 */
export const authLinkType = new URLSearchParams(window.location.hash.slice(1)).get("type");

// The anon key is public by design: RLS is the protection, not the secret.
export const supabase = createClient<Database>(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
);
