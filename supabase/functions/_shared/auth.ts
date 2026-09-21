import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { jsonResponse } from "./cors.ts";

// Deactivates a profile and drops its sessions. Shared by admin-update-user
// (deactivating an account) and revoke-invitation (withdrawing the access an
// invitation created), so the two endpoints cannot drift into two slightly
// different ways of doing the same thing. Error codes match what
// admin-update-user already returned before this extraction -- the front
// already translates them (see web/src/lib/errors.ts).
export async function deactivateAccount(
  admin: SupabaseClient,
  userId: string,
): Promise<{ error: Response } | { ok: true }> {
  const { error: updateError } = await admin
    .from("profiles")
    .update({ is_active: false })
    .eq("id", userId);

  if (updateError) {
    return { error: jsonResponse(500, { error: "update_failed", detail: updateError.message }) };
  }

  // Deactivation already cuts data access through auth_role(); dropping the
  // sessions also gets the person logged out of their browser.
  const { error: revokeError } = await admin.rpc("admin_revoke_sessions", { p_user_id: userId });
  if (revokeError) {
    return {
      error: jsonResponse(500, { error: "session_revoke_failed", detail: revokeError.message }),
    };
  }

  return { ok: true };
}

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

/**
 * Row shape returned by public.admin_find_user_by_email (declared in
 * 20260920130800_admin_find_user_by_email_arrival_route.sql).
 *
 * The service_role client is created untyped, so PostgREST resolves an RPC
 * result to `{}` and every field read off it is a type error -- nine of them,
 * invisible until `npm run fn:check` started running `deno check` over these
 * files. The shape is restated here rather than imported from
 * web/src/lib/database.types.ts because the Supabase bundler only ships what
 * lives under supabase/functions: a cross-tree import would type-check
 * locally and fail to deploy. If the SQL function's signature changes, this
 * type must change with it.
 */
export type AccountLookup = {
  user_id: string;
  has_profile: boolean;
  provider: string | null;
  is_confirmed: boolean;
};

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null;
}

/** The three roles a profile can hold. Shared so every endpoint validates
 * against the same list instead of restating it. */
export const APP_ROLES = ["client", "agent", "admin"] as const;
export type AppRole = (typeof APP_ROLES)[number];
