// Revokes an invitation that is still `pending`.
//
// HOLDING COMMENT (task 13a, fix round 1): as things stand, this endpoint is
// unreachable in practice. invite-user now calls inviteUserByEmail for
// every role, not just client, so every product path resolves an
// invitation before this endpoint could ever see it `pending`: the
// new-invitation branch inserts it `pending` and the trigger flips it to
// `accepted` before that same request returns, the existing-account branch
// writes it `accepted` directly, and the failure branch deletes the row
// outright. There is no longer a window in which `.eq("status", "pending")`
// below can match anything -- it will only ever return
// `404 no_pending_invitation`. Withdrawing a person's access, client or
// internal, goes through admin-update-user with is_active: false.
//
// Whether this endpoint should be removed, repurposed, or kept as-is is a
// product decision that has been put to the user; this comment is a
// correction of fact pending that decision, not a change of behaviour.
import { handleCors, jsonResponse } from "../_shared/cors.ts";
import { adminClient, requireAdmin } from "../_shared/auth.ts";

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

  const { data, error } = await adminClient()
    .from("invitations")
    .update({ status: "revoked" })
    .eq("id", invitationId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (error) return jsonResponse(500, { error: "revoke_failed", detail: error.message });
  if (!data) return jsonResponse(404, { error: "no_pending_invitation" });

  return jsonResponse(200, { status: "revoked", invitation_id: data.id });
});
