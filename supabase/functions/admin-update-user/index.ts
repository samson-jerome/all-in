import { handleCors, jsonResponse } from "../_shared/cors.ts";
import { adminClient, APP_ROLES, requireAdmin, viaConfirmedOAuth } from "../_shared/auth.ts";

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

  // Validate body.role directly, not the value coalesced with the current
  // role further down -- otherwise an explicit `role: null` silently
  // collapses into "no change" while still taking the role-is-changing
  // path, and the caller gets a misleading 200 for a write that never
  // happened.
  if (body?.role !== undefined && !APP_ROLES.includes(body.role)) {
    return jsonResponse(400, { error: "invalid_role" });
  }

  if (body?.org_id !== undefined && body.org_id !== null && typeof body.org_id !== "string") {
    return jsonResponse(400, { error: "invalid_org_id" });
  }

  if (body?.is_active !== undefined && typeof body.is_active !== "boolean") {
    return jsonResponse(400, { error: "invalid_is_active" });
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

  // Mirrors invite-user: an internal role never carries an org_id. A caller
  // who omits org_id entirely keeps the existing behaviour of forcing it to
  // null below; only an explicit, non-null value is rejected here.
  if (
    (nextRole === "agent" || nextRole === "admin") &&
    body?.org_id !== undefined &&
    body.org_id !== null
  ) {
    return jsonResponse(400, { error: "org_forbidden_for_internal" });
  }

  // A client account arrived by e-mail/password. Promoting it to an internal
  // role would reproduce the exact privilege escalation invite-user already
  // refuses, through a different door: internal staff must authenticate via
  // OAuth. Same predicate as handle_new_user() and invite-user
  // (viaConfirmedOAuth), sourced from the GoTrue admin API since this
  // endpoint only has a user_id, not an e-mail. Checked before any write.
  if ((nextRole === "agent" || nextRole === "admin") && current.role === "client") {
    const { data: authUser, error: authUserError } = await admin.auth.admin.getUserById(userId);
    if (authUserError || !authUser?.user) {
      return jsonResponse(500, {
        error: "auth_user_lookup_failed",
        detail: authUserError?.message,
      });
    }

    if (
      !viaConfirmedOAuth(authUser.user.app_metadata?.provider, authUser.user.email_confirmed_at)
    ) {
      return jsonResponse(409, { error: "arrival_route_mismatch" });
    }
  }

  const update: Record<string, unknown> = {};

  if (body?.role !== undefined) {
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
    update.is_active = body.is_active;
  }

  // Purge the portfolio only on the transition into `client`: a client has
  // no portfolio, so that destination is the one that must arrive empty.
  // Moving between agent and admin, in either direction, keeps the rows --
  // an administrator holding portfolio rows is inert, because
  // can_read_org() grants admins access through its own branch without ever
  // consulting agent_organizations, and keeping the rows means a later
  // demotion back to agent restores the person's original scope instead of
  // starting from nothing.
  //
  // This delete is not wrapped in a transaction with the profile update
  // below (no RPC exists for that here, and adding one is out of scope for
  // this change). Keep the delete first: if only one of the two writes
  // lands, "still an agent with an empty portfolio" fails closed, whereas
  // the reverse order risks "demoted to client, but the portfolio row
  // survives" if the delete fails after the update already succeeded. Do
  // not reorder this.
  if (nextRole === "client") {
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
