// Revokes an invitation that is still `pending`.
//
// The trigger (handle_new_user) attaches the profile and marks the
// invitation `accepted` as soon as GoTrue records the invite -- for a
// client, that is the moment the invitation is *sent*, not accepted, so a
// client invitation is never `pending` long enough for this endpoint to
// reach it (see the ruling 2 measurement in the task report). This endpoint
// therefore only ever revokes internal (agent/admin) invitations, which stay
// `pending` until the invitee's first confirmed OAuth login. Withdrawing a
// client's access goes through admin-update-user with is_active: false.
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
