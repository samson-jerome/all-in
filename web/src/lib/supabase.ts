import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

// The anon key is public by design: RLS is the protection, not the secret.
export const supabase = createClient<Database>(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
);
