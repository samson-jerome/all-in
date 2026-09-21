import { beforeAll, describe, expect, it } from "vitest";

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

function call(name: string, token: string | null) {
  return fetch(`${BASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({}),
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
});
