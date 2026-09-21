import { execSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const BASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

const FUNCTIONS = [
  { name: "invite-user", validationErrorCode: "invalid_email" },
  { name: "revoke-invitation", validationErrorCode: "invalid_invitation_id" },
  { name: "admin-update-user", validationErrorCode: "invalid_user_id" },
] as const;

// clienta1 and agent1 are active, non-admin accounts. inactiveadmin has
// role admin but is_active false: auth_role() resolves it to null (see
// auth_helpers.sql's `and p.is_active` predicate), same as any other
// deactivated account. Using a deactivated CLIENT here would prove nothing
// -- a client's role is already !== 'admin' whether or not is_active is
// checked, so it takes the same 403 branch either way. Only a deactivated
// ADMIN can distinguish "the is_active predicate is intact" from "it was
// dropped": if it were dropped, this account's role would resolve to
// 'admin' and requireAdmin would let it through. It is the only automated
// check that deactivation revokes an administrator's own powers, not just
// hides their data.
const NON_ADMINS = [
  { label: "un client", email: "clienta1@allin.test" },
  { label: "un agent", email: "agent1@allin.test" },
  { label: "un administrateur désactivé", email: "inactiveadmin@allin.test" },
];

const ADMIN_EMAIL = "admin@allin.test";

async function signIn(email: string): Promise<string> {
  const response = await fetch(`${BASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password123" }),
  });
  const body = await response.json();
  if (!body.access_token) throw new Error(`connexion impossible pour ${email}`);
  return body.access_token;
}

function call(name: string, token: string | null, body: Record<string, unknown> = {}) {
  return fetch(`${BASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("contrôle d'accès des Edge Functions", () => {
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    for (const person of NON_ADMINS) {
      tokens[person.email] = await signIn(person.email);
    }
    tokens[ADMIN_EMAIL] = await signIn(ADMIN_EMAIL);
  });

  for (const { name, validationErrorCode } of FUNCTIONS) {
    for (const person of NON_ADMINS) {
      it(`${name} refuse ${person.label}`, async () => {
        const response = await call(name, tokens[person.email]);
        expect(response.status).toBe(403);
      });
    }

    // Anonymous call: measured against a live server, the Supabase functions
    // gateway rejects the missing JWT itself, before requireAdmin ever runs
    // inside the function -- hence 401, not the 403 requireAdmin would
    // return. This means the case has no regression value for requireAdmin
    // itself: it exercises Supabase's own infrastructure, not this
    // project's code. It is kept anyway because it costs nothing and it
    // guards the deployed configuration against someone disabling the
    // gateway's JWT verification -- requireAdmin's own unauthorized branch
    // (the `!authorization` check in _shared/auth.ts) would only be
    // exercised by this test if that verification were ever turned off.
    it(`${name} refuse un appel sans jeton`, async () => {
      const response = await call(name, null);
      expect(response.status).toBe(401);
    });

    // Positive control: without this, a requireAdmin that refused everyone
    // (admin included) would still pass every test above. An administrator
    // must clear the guard and reach the function's own input validation,
    // which fails on an empty body with its documented 400 + error code.
    it(`${name} laisse passer un administrateur jusqu'à la validation`, async () => {
      const response = await call(name, tokens[ADMIN_EMAIL]);
      const body = await response.json();
      expect(response.status).toBe(400);
      expect(body.error).toBe(validationErrorCode);
    });
  }

  // Regression test for task 13a: invite-user's internal-role branch used
  // to return "invitation_pending" without ever calling inviteUserByEmail,
  // on the assumption that an agent/admin's auth.users row would appear
  // later through an OAuth login. OAuth is deferred out of this lot, so
  // that branch never created an auth.users row and an internal invitation
  // stayed pending forever -- nothing in the pgTAP suite or the rest of
  // this file could catch it, since pgTAP only covers the trigger and the
  // rest of this file only covers access control. This is the only
  // automated check that an internal invitation is actually sent.
  describe("invite-user, chemin interne", () => {
    const email = `agent-fix13a-${Date.now()}@allin.test`;
    let serviceRoleKey = "";

    beforeAll(() => {
      // Read from the CLI instead of being committed anywhere: this key
      // exists only so the test below can delete the account it creates,
      // never to bypass access control in the assertion itself, which goes
      // through the same signed-in admin token as every other test above.
      const output = execSync("npx supabase status -o env", { encoding: "utf-8" });
      const match = output.match(/SERVICE_ROLE_KEY="([^"]+)"/);
      if (!match) throw new Error("clé service_role introuvable dans `supabase status`");
      serviceRoleKey = match[1];
    });

    afterAll(async () => {
      // Runs even if the assertion below fails, so the suite stays
      // re-runnable without a db:reset between runs.
      if (!serviceRoleKey) return;
      const admin = createClient<Database>(BASE_URL, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: found } = await admin
        .rpc("admin_find_user_by_email", { p_email: email })
        .maybeSingle();
      if (found?.user_id) {
        await admin.auth.admin.deleteUser(found.user_id);
      }
      await admin.from("invitations").delete().eq("email", email);
    });

    it("envoie effectivement l'invitation à une nouvelle adresse interne", async () => {
      const response = await call("invite-user", tokens[ADMIN_EMAIL], { email, role: "agent" });
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.status).toBe("invited");
    });
  });

  // Regression coverage for task 13b: since task 13a made invite-user
  // resolve every invitation immediately (accepted or deleted, never left
  // pending), revoke-invitation's old `.eq("status", "pending")` filter
  // could no longer match anything -- every call returned
  // `404 no_pending_invitation`. Withdrawing access now means removing it
  // from the account the invitation created, not just flipping a status
  // column nothing still reads as "pending". This is the only automated
  // check that the endpoint actually does that.
  describe("revoke-invitation, bout en bout", () => {
    const email = `agent-revoke13b-${Date.now()}@allin.test`;
    let serviceRoleKey = "";
    let admin: SupabaseClient<Database>;

    beforeAll(() => {
      // Same approach as the invite-user block above: read the key from the
      // CLI instead of committing it, only to verify state and clean up
      // afterwards -- every assertion still goes through the signed-in
      // admin token like the rest of this file.
      const output = execSync("npx supabase status -o env", { encoding: "utf-8" });
      const match = output.match(/SERVICE_ROLE_KEY="([^"]+)"/);
      if (!match) throw new Error("clé service_role introuvable dans `supabase status`");
      serviceRoleKey = match[1];
      admin = createClient<Database>(BASE_URL, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    });

    afterAll(async () => {
      // Runs even if the assertion below fails, so the suite stays
      // re-runnable without a db:reset between runs.
      if (!serviceRoleKey) return;
      const { data: found } = await admin
        .rpc("admin_find_user_by_email", { p_email: email })
        .maybeSingle();
      if (found?.user_id) {
        await admin.auth.admin.deleteUser(found.user_id);
      }
      await admin.from("invitations").delete().eq("email", email);
    });

    it("révoquer une invitation acceptée désactive le compte et marque l'invitation revoked", async () => {
      const inviteResponse = await call("invite-user", tokens[ADMIN_EMAIL], { email, role: "agent" });
      const inviteBody = await inviteResponse.json();
      expect(inviteResponse.status).toBe(200);
      const invitationId = inviteBody.invitation_id;

      const revokeResponse = await call("revoke-invitation", tokens[ADMIN_EMAIL], {
        invitation_id: invitationId,
      });
      const revokeBody = await revokeResponse.json();
      expect(revokeResponse.status).toBe(200);
      expect(revokeBody.status).toBe("revoked");
      expect(revokeBody.access_revoked).toBe(true);

      const { data: account } = await admin
        .rpc("admin_find_user_by_email", { p_email: email })
        .maybeSingle();
      const { data: profile } = await admin
        .from("profiles")
        .select("is_active")
        .eq("id", account?.user_id ?? "")
        .single();
      expect(profile?.is_active).toBe(false);

      const { data: invitation } = await admin
        .from("invitations")
        .select("status")
        .eq("id", invitationId)
        .single();
      expect(invitation?.status).toBe("revoked");

      // Idempotence: a second call on this same, now-revoked invitation
      // must not error -- a double click, or a retry after a lost
      // response, has to land on the same safe state instead.
      const secondRevoke = await call("revoke-invitation", tokens[ADMIN_EMAIL], {
        invitation_id: invitationId,
      });
      const secondBody = await secondRevoke.json();
      expect(secondRevoke.status).toBe(200);
      expect(secondBody.status).toBe("already_revoked");
      expect(secondBody.invitation_id).toBe(invitationId);
    });

    // Guard coverage, not a feature: an administrator must not be able to
    // withdraw their own access through this endpoint. Uses the seeded
    // admin@allin.test invitation directly -- nothing is created here, so
    // there is nothing for the afterAll above to clean up.
    it("refuse qu'un administrateur retire son propre accès, sans rien modifier", async () => {
      const { data: adminAccount } = await admin
        .rpc("admin_find_user_by_email", { p_email: ADMIN_EMAIL })
        .maybeSingle();
      const { data: adminInvitation } = await admin
        .from("invitations")
        .select("id")
        .eq("email", ADMIN_EMAIL)
        .single();

      const response = await call("revoke-invitation", tokens[ADMIN_EMAIL], {
        invitation_id: adminInvitation?.id,
      });
      const body = await response.json();
      expect(response.status).toBe(400);
      expect(body.error).toBe("cannot_modify_self");

      // A regression that performs the withdrawal before refusing the
      // request must be caught here -- not hidden behind the status
      // assertion alone.
      const { data: profile } = await admin
        .from("profiles")
        .select("is_active")
        .eq("id", adminAccount?.user_id ?? "")
        .single();
      expect(profile?.is_active).toBe(true);
    });
  });
});
