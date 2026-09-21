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
 */
export const authLinkType = new URLSearchParams(window.location.hash.slice(1)).get("type");

// The anon key is public by design: RLS is the protection, not the secret.
export const supabase = createClient<Database>(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
);
