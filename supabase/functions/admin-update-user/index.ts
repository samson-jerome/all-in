import { handleCors, jsonResponse } from "../_shared/cors.ts";
import { adminClient, requireAdmin } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  const guard = await requireAdmin(req);
  if ("error" in guard) return guard.error;

  const body = await req.json().catch(() => null);
  const userId = body?.user_id;
  if (typeof userId !== "string") {
    return jsonResponse(400, { error: "invalid_user_id" });
  }

  // An administrator must not be able to lock themselves out.
  if (userId === guard.callerId && (body?.role !== undefined || body?.is_active === false)) {
    return jsonResponse(400, { error: "cannot_modify_self" });
  }

  const admin = adminClient();

  const { data: current, error: readError } = await admin
    .from("profiles")
    .select("id, role, org_id, is_active")
    .eq("id", userId)
    .maybeSingle();

  if (readError) return jsonResponse(500, { error: "read_failed", detail: readError.message });
  if (!current) return jsonResponse(404, { error: "profile_not_found" });

  const nextRole = body?.role ?? current.role;

  // A client account arrived by e-mail/password. Promoting it to an internal
  // role would reproduce the exact privilege escalation invite-user already
  // refuses, through a different door: internal staff must authenticate via
  // OAuth. Same predicate as handle_new_user() and invite-user's
  // viaConfirmedOAuth, sourced from the GoTrue admin API since this endpoint
  // only has a user_id, not an e-mail. Checked before any write.
  if ((nextRole === "agent" || nextRole === "admin") && current.role === "client") {
    const { data: authUser, error: authUserError } = await admin.auth.admin.getUserById(userId);
    if (authUserError || !authUser?.user) {
      return jsonResponse(500, {
        error: "auth_user_lookup_failed",
        detail: authUserError?.message,
      });
    }

    // app_metadata is server-set (GoTrue writes it on OAuth sign-in);
    // user_metadata is client-controlled and must never be trusted here.
    const provider = authUser.user.app_metadata?.provider;
    const viaConfirmedOAuth =
      provider != null && provider !== "email" && authUser.user.email_confirmed_at != null;

    if (!viaConfirmedOAuth) {
      return jsonResponse(409, { error: "arrival_route_mismatch" });
    }
  }

  const update: Record<string, unknown> = {};

  if (body?.role !== undefined) {
    if (!["client", "agent", "admin"].includes(nextRole)) {
      return jsonResponse(400, { error: "invalid_role" });
    }
    update.role = nextRole;
  }

  // The client/internal split drives org_id, and the check constraint would
  // reject any other combination anyway.
  if (nextRole === "client") {
    const orgId = body?.org_id ?? current.org_id;
    if (!orgId) return jsonResponse(400, { error: "org_required_for_client" });
    update.org_id = orgId;
  } else {
    update.org_id = null;
  }

  if (body?.is_active !== undefined) {
    if (typeof body.is_active !== "boolean") {
      return jsonResponse(400, { error: "invalid_is_active" });
    }
    update.is_active = body.is_active;
  }

  // Leaving the agent role behind means leaving the portfolio behind.
  if (nextRole !== "agent" && current.role === "agent") {
    const { error } = await admin.from("agent_organizations").delete().eq("agent_id", userId);
    if (error) return jsonResponse(500, { error: "portfolio_cleanup_failed", detail: error.message });
  }

  const { error: updateError } = await admin.from("profiles").update(update).eq("id", userId);
  if (updateError) {
    return jsonResponse(500, { error: "update_failed", detail: updateError.message });
  }

  // Deactivation already cuts data access through auth_role(); dropping the
  // sessions also gets the person logged out of their browser.
  if (body?.is_active === false) {
    const { error } = await admin.rpc("admin_revoke_sessions", { p_user_id: userId });
    if (error) return jsonResponse(500, { error: "session_revoke_failed", detail: error.message });
  }

  return jsonResponse(200, { status: "updated", user_id: userId });
});
