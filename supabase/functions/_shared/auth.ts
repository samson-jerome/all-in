import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { jsonResponse } from "./cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** Bypasses RLS. Only ever used after the caller has been proven to be an admin. */
export function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Resolves the caller from their own token and checks their role in the
 * database. Nothing in the request body is trusted to establish identity.
 */
export async function requireAdmin(
  req: Request,
): Promise<{ error: Response } | { callerId: string }> {
  const authorization = req.headers.get("Authorization");
  if (!authorization) {
    return { error: jsonResponse(401, { error: "unauthorized" }) };
  }

  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await caller.auth.getUser();
  if (userError || !userData.user) {
    return { error: jsonResponse(401, { error: "unauthorized" }) };
  }

  const { data: role, error: roleError } = await caller.rpc("auth_role");
  if (roleError || role !== "admin") {
    return { error: jsonResponse(403, { error: "forbidden" }) };
  }

  return { callerId: userData.user.id };
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null;
}

/** The three roles a profile can hold. Shared so every endpoint validates
 * against the same list instead of restating it. */
export const APP_ROLES = ["client", "agent", "admin"] as const;
export type AppRole = (typeof APP_ROLES)[number];

/**
 * True when an account arrived through a confirmed, non-email provider --
 * i.e. real OAuth, not a self-service password signup. This is the single
 * TypeScript expression of the arrival-route rule the handle_new_user()
 * trigger enforces in SQL: `provider IS NOT NULL AND provider <> 'email' AND
 * email_confirmed_at IS NOT NULL`. Every place that needs to tell a genuine
 * OAuth arrival from a password signup on the same address calls this
 * instead of restating the predicate.
 *
 * `provider` must come from `app_metadata` (server-set by GoTrue on
 * sign-in), never from `user_metadata` (client-controlled) -- the latter
 * would let a caller forge their own arrival route.
 *
 * `emailConfirmedAt` accepts either the raw `email_confirmed_at` timestamp
 * (nullable string, as returned by the GoTrue admin API's getUserById) or an
 * already-resolved boolean (as returned by admin_find_user_by_email's
 * `is_confirmed` column, computed in SQL as `email_confirmed_at is not
 * null`) -- both reduce to the same confirmed-or-not check, so callers on
 * either side of that boundary can share this one expression.
 */
export function viaConfirmedOAuth(
  provider: string | null | undefined,
  emailConfirmedAt: string | boolean | null | undefined,
): boolean {
  const confirmed =
    typeof emailConfirmedAt === "boolean" ? emailConfirmedAt : emailConfirmedAt != null;
  return provider != null && provider !== "email" && confirmed;
}
