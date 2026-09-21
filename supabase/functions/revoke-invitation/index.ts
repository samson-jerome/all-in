// Revokes an invitation and, if the account it created still exists,
// withdraws its access.
//
// Task 13a's fix round left a correction-of-fact comment here: once
// invite-user started calling inviteUserByEmail for every role, no product
// path ever left an invitation `pending` any more (the trigger accepts it
// immediately, the existing-account branch writes it accepted directly, and
// the failure branch deletes the row outright), so the old
// `.eq("status", "pending")` update below could never match anything.
//
// The capability an administrator expects behind this button -- "cancel
// this invitation, that person must not get in" -- is still legitimate.
// Under the new model it means: mark the invitation revoked AND remove the
// access of the account it created.
import { handleCors, jsonResponse } from "../_shared/cors.ts";
import {
  type AccountLookup,
  adminClient,
  deactivateAccount,
  requireAdmin,
} from "../_shared/auth.ts";

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  const guard = await requireAdmin(req);
  if ("error" in guard) return guard.error;

  const body = await req.json().catch(() => null);
  const invitationId = body?.invitation_id;
  if (typeof invitationId !== "string") {
    return jsonResponse(400, { error: "invalid_invitation_id" });
  }

  const admin = adminClient();

  const { data: invitation, error: readError } = await admin
    .from("invitations")
    .select("id, email, status")
    .eq("id", invitationId)
    .maybeSingle();

  if (readError) return jsonResponse(500, { error: "read_failed", detail: readError.message });
  if (!invitation) return jsonResponse(404, { error: "invitation_not_found" });

  // Idempotent: a double click, or a retry after a lost response, must not
  // turn into an error.
  if (invitation.status === "revoked") {
    return jsonResponse(200, { status: "already_revoked", invitation_id: invitation.id });
  }

  const { data: account, error: lookupError } = await admin
    .rpc("admin_find_user_by_email", { p_email: invitation.email })
    .maybeSingle<AccountLookup>();

  if (lookupError) {
    return jsonResponse(500, { error: "lookup_failed", detail: lookupError.message });
  }

  let accessRevoked = false;

  if (account?.has_profile) {
    // Same rule as admin-update-user: an administrator must not be able to
    // remove their own access, through this endpoint either.
    if (account.user_id === guard.callerId) {
      return jsonResponse(400, { error: "cannot_modify_self" });
    }

    const result = await deactivateAccount(admin, account.user_id);
    if ("error" in result) return result.error;
    accessRevoked = true;
  }
  // Else: the invitation was never consumed into an account (the bootstrap
  // case). Nothing to remove access from -- fall through to step 4.

  // Access must be withdrawn before the invitation is marked revoked: if
  // this second write fails, the resulting state is "access already
  // removed, invitation still accepted", which is safe. The reverse order
  // would leave a revoked invitation on an account that is still active.
  // Do not swap this order.
  const { error: revokeError } = await admin
    .from("invitations")
    .update({ status: "revoked" })
    .eq("id", invitationId);

  if (revokeError) return jsonResponse(500, { error: "revoke_failed", detail: revokeError.message });

  return jsonResponse(200, {
    status: "revoked",
    invitation_id: invitationId,
    access_revoked: accessRevoked,
  });
});
