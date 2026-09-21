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

// Browser-facing URL of the front. Not one of the three the CLI injects on
// its own: it is declared in supabase/config.toml under
// [edge_runtime.secrets], and set with `supabase secrets set` on a deployed
// environment.
const SITE_URL = Deno.env.get("SITE_URL");

/**
 * The only route that turns an invitation link into a usable account.
 *
 * AuthCallbackView reads `type` out of the link fragment and, for `invite`
 * or `recovery`, sends the person to the password screen. It is mounted on
 * this path and nowhere else. A link that lands anywhere else leaves the
 * person signed in with no password ever set -- and, once that first session
 * expires, with no way to sign in again.
 */
const AUTH_CALLBACK_PATH = "/auth/callback";

/**
 * Same shape check as supabase/scripts/bootstrap_admin.sh applies to
 * SITE_URL. The two halves of the product build the same URL and must agree
 * on what a usable value is: a scheme-less `127.0.0.1:5173` is not merely
 * untidy, it produces a `redirect_to` GoTrue rejects -- and GoTrue's way of
 * rejecting it is to fall back to its own `site_url`, silently reinstating
 * the very defect the no-fallback rule below exists to prevent.
 */
const SITE_URL_PATTERN = /^https?:\/\/[^\s"?#&]+$/;

/**
 * Where an invitation link must send the person, or null when SITE_URL is
 * missing or malformed.
 *
 * There is deliberately no fallback. Calling inviteUserByEmail without a
 * `redirectTo` is not a neutral default: GoTrue then uses its own
 * `site_url`, the front's root, which is precisely the defect this function
 * exists to prevent. A fallback would reintroduce it, silently, in any
 * environment where someone forgot to set the variable -- invitations would
 * still be sent, and every single person invited under that configuration
 * would end up locked out. Refusing the request costs one loud failure on a
 * misconfigured deployment instead.
 *
 * The URL built here must also appear in `[auth] additional_redirect_urls`,
 * or GoTrue refuses the redirection.
 */
export function inviteRedirectTo(): string | null {
  if (!SITE_URL || !SITE_URL_PATTERN.test(SITE_URL)) return null;
  return `${SITE_URL.replace(/\/+$/, "")}${AUTH_CALLBACK_PATH}`;
}

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
