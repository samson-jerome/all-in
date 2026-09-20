import { beforeAll, describe, expect, it } from "vitest";

const BASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

const FUNCTIONS = [
  { name: "invite-user", validationErrorCode: "invalid_email" },
  { name: "revoke-invitation", validationErrorCode: "invalid_invitation_id" },
  { name: "admin-update-user", validationErrorCode: "invalid_user_id" },
] as const;

// clienta1 and agent1 are active, non-admin accounts. inactive is a client
// whose is_active is false: auth_role() resolves it to null (see
// auth_helpers.sql), so it must be refused exactly like any other
// non-admin, not merely have its data hidden.
const NON_ADMINS = [
  { label: "un client", email: "clienta1@allin.test" },
  { label: "un agent", email: "agent1@allin.test" },
  { label: "un compte désactivé", email: "inactive@allin.test" },
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

    // Anonymous call: measured against a live server, the functions gateway
    // rejects the missing JWT itself, before requireAdmin ever runs inside
    // the function -- hence 401, not the 403 requireAdmin would return.
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
