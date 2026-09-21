import { handleCors, jsonResponse } from "../_shared/cors.ts";
import { adminClient, APP_ROLES, deactivateAccount, requireAdmin } from "../_shared/auth.ts";

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

  // A deactivation (is_active: false) is applied separately below through
  // deactivateAccount(), shared with revoke-invitation. Reactivation and any
  // other is_active value still go through this same combined update.
  //
  // This means a role/org_id change combined with a deactivation is no
  // longer written in one statement: the combined update below commits
  // role/org_id first, then deactivateAccount() writes is_active in a
  // second statement. A failure of that second write would leave
  // role/org_id changed with is_active still true -- a state the old
  // single-statement path could not produce. Accepted as unreachable in
  // practice: same row, same service_role connection, and no constraint on
  // public.profiles involves is_active alone, so nothing plausible fails
  // between the two writes.
  if (body?.is_active !== undefined && body.is_active !== false) {
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

  if (body?.is_active === false) {
    const result = await deactivateAccount(admin, userId);
    if ("error" in result) return result.error;
  }

  // Reactivation also clears the `revoked` status revoke-invitation left
  // behind, because that status is what the invitations screen reads.
  //
  // revoke-invitation marks the invitation `revoked` AND deactivates the
  // profile. The way back, which the invitations screen itself points at, is
  // "Réactiver" here -- and it used to restore profiles.is_active while
  // leaving the invitation `revoked`. The users screen then said "Actif"
  // about an account the security screen called "Révoquée", with no control
  // offered to change it. Worse than the contradiction: `revoked` is what
  // revoke-invitation tests for idempotence, so that account could never be
  // cut off again through that button -- the endpoint returned
  // `already_revoked` without touching anything.
  //
  // Chosen over the other way out -- teaching the invitations screen to
  // display the profile's real is_active -- for two reasons. The front cannot
  // make that join at all: invitations carries an email, profiles carries no
  // email column, and nothing readable from a browser bridges the two.
  // And displaying the truth would have left the endpoint just as unable to
  // re-cut access. `status` is a current-state column in this model, not an
  // audit log: there is no history table behind it, and an account whose
  // access has been restored is, currently, accepted.
  if (body?.is_active === true) {
    const { data: account, error: accountError } = await admin.auth.admin.getUserById(userId);
    const email = account?.user?.email?.trim().toLowerCase();

    if (accountError || !email) {
      // Deliberately not fatal. profiles.is_active is the source of truth for
      // access and it is already written; answering 500 here would tell an
      // administrator the reactivation failed when it succeeded. Logged
      // instead, with what it takes to finish the job by hand.
      console.error(
        `admin-update-user: compte ${userId} réactivé, mais son adresse est introuvable — statut d'invitation laissé à 'revoked' : ${
          accountError?.message ?? "aucune adresse sur le compte"
        }`,
      );
    } else {
      const { error: reviveError } = await admin
        .from("invitations")
        .update({ status: "accepted" })
        .eq("email", email)
        .eq("status", "revoked");

      if (reviveError) {
        console.error(
          `admin-update-user: compte ${userId} (${email}) réactivé, mais le statut d'invitation n'a pas pu être repris — ${reviveError.message}`,
        );
      }
    }
  }

  return jsonResponse(200, { status: "updated", user_id: userId });
});
