import { handleCors, jsonResponse } from "../_shared/cors.ts";
import {
  type AccountLookup,
  adminClient,
  APP_ROLES,
  normalizeEmail,
  requireAdmin,
} from "../_shared/auth.ts";

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
  if (!APP_ROLES.includes(role)) {
    return jsonResponse(400, { error: "invalid_role" });
  }
  if (role === "client" && !orgId) {
    return jsonResponse(400, { error: "org_required_for_client" });
  }
  if (role !== "client" && orgId) {
    return jsonResponse(400, { error: "org_forbidden_for_internal" });
  }

  const admin = adminClient();

  // An account may already exist without a profile even though free
  // registration is closed: it can have been created outside this endpoint
  // entirely, directly through the admin API or the Studio (see the
  // orphan@allin.test fixture), with no invitation ever pending for it. The
  // trigger only fires on insert or on the update that sets invited_at, so
  // inserting an invitation now would never cause it to fire again for this
  // user -- attach the profile directly instead of leaving a pending
  // invitation nothing will ever consume.
  const { data: existing, error: lookupError } = await admin
    .rpc("admin_find_user_by_email", { p_email: email })
    .maybeSingle<AccountLookup>();

  if (lookupError) {
    return jsonResponse(500, { error: "lookup_failed", detail: lookupError.message });
  }

  if (existing?.has_profile) {
    return jsonResponse(409, { error: "user_already_attached" });
  }

  if (existing?.user_id) {
    // Free registration is closed, so an account with no profile can only
    // be one our own invitation flow created earlier -- there is no other
    // route left to distinguish. This insert applies no arrival check of its
    // own: it depends entirely on that flag staying closed, exactly like
    // public.handle_new_user(). Re-read that function's warning comment
    // before ever reopening [auth] enable_signup.
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

  // Entry is by invitation only, for every role. This used to skip
  // inviteUserByEmail for agent/admin, on the assumption they would create
  // their auth.users row by signing in through OAuth instead. OAuth is
  // deferred out of this lot, so that row would otherwise never exist and
  // the invitation would stay pending forever. inviteUserByEmail is now the
  // only remaining way to create it, for every role alike.
  //
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
