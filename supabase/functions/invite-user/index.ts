import { handleCors, jsonResponse } from "../_shared/cors.ts";
import { adminClient, normalizeEmail, requireAdmin } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  const guard = await requireAdmin(req);
  if ("error" in guard) return guard.error;

  const body = await req.json().catch(() => null);
  const email = normalizeEmail(body?.email);
  const role = body?.role;
  const orgId = body?.org_id ?? null;

  if (!email) return jsonResponse(400, { error: "invalid_email" });
  if (!["client", "agent", "admin"].includes(role)) {
    return jsonResponse(400, { error: "invalid_role" });
  }
  if (role === "client" && !orgId) {
    return jsonResponse(400, { error: "org_required_for_client" });
  }
  if (role !== "client" && orgId) {
    return jsonResponse(400, { error: "org_forbidden_for_internal" });
  }

  const admin = adminClient();

  // An account may already exist without a profile: someone signed in through
  // OAuth before being invited. The insert trigger will never fire again for
  // them, so attach them directly instead of leaving a pending invitation.
  const { data: existing, error: lookupError } = await admin
    .rpc("admin_find_user_by_email", { p_email: email })
    .maybeSingle();

  if (lookupError) {
    return jsonResponse(500, { error: "lookup_failed", detail: lookupError.message });
  }

  if (existing?.has_profile) {
    return jsonResponse(409, { error: "user_already_attached" });
  }

  if (existing?.user_id) {
    if (role !== "client") {
      // Same predicate as handle_new_user(): only a confirmed, non-email
      // arrival proves this account was not created by a self-service
      // password signup. admin_find_user_by_email returns provider and
      // is_confirmed for exactly this check, so the two rules cannot drift.
      const viaConfirmedOAuth =
        existing.provider != null && existing.provider !== "email" && existing.is_confirmed;
      if (!viaConfirmedOAuth) {
        return jsonResponse(409, { error: "arrival_route_mismatch" });
      }
    }

    const { error: profileError } = await admin.from("profiles").insert({
      id: existing.user_id,
      full_name: email.split("@")[0],
      role,
      org_id: orgId,
    });
    if (profileError) {
      return jsonResponse(500, { error: "profile_creation_failed", detail: profileError.message });
    }

    // Consume any invitation an earlier attempt left pending for this
    // address, or record this one as already accepted -- otherwise the row
    // stays pending forever, blocking any future invitation to this
    // address, and the invited_by audit link is lost.
    const nowIso = new Date().toISOString();
    const { data: consumed, error: consumeError } = await admin
      .from("invitations")
      .update({ status: "accepted", accepted_at: nowIso, role, org_id: orgId })
      .eq("email", email)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (consumeError) {
      return jsonResponse(500, {
        error: "invitation_record_failed",
        detail: consumeError.message,
        user_id: existing.user_id,
      });
    }

    if (!consumed) {
      const { error: recordError } = await admin.from("invitations").insert({
        email,
        role,
        org_id: orgId,
        invited_by: guard.callerId,
        status: "accepted",
        accepted_at: nowIso,
      });
      if (recordError) {
        return jsonResponse(500, {
          error: "invitation_record_failed",
          detail: recordError.message,
          user_id: existing.user_id,
        });
      }
    }

    return jsonResponse(200, { status: "profile_created", user_id: existing.user_id });
  }

  const { data: invitation, error: invitationError } = await admin
    .from("invitations")
    .insert({ email, role, org_id: orgId, invited_by: guard.callerId })
    .select("id")
    .single();

  if (invitationError) {
    const conflict = invitationError.code === "23505";
    return jsonResponse(conflict ? 409 : 500, {
      error: conflict ? "invitation_already_pending" : "invitation_failed",
      detail: invitationError.message,
    });
  }

  // Internal users arrive through OAuth: there is nothing to send them, and
  // creating a password account would shadow their provider identity.
  if (role !== "client") {
    return jsonResponse(200, { status: "invitation_pending", invitation_id: invitation.id });
  }

  // The invitation row must exist before this call: it creates the auth user
  // immediately, which fires the trigger that consumes the invitation.
  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email);

  if (inviteError) {
    // Leave no ghost row that would silently attach a future signup.
    const { error: cleanupError } = await admin
      .from("invitations")
      .delete()
      .eq("id", invitation.id);

    if (cleanupError) {
      return jsonResponse(502, {
        error: "invite_email_failed",
        detail: inviteError.message,
        cleanup_error: cleanupError.message,
        orphaned_invitation_id: invitation.id,
      });
    }

    return jsonResponse(502, { error: "invite_email_failed", detail: inviteError.message });
  }

  return jsonResponse(200, { status: "invited", invitation_id: invitation.id });
});
