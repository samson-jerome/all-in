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
