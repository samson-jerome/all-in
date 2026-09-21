import type { Router } from "vue-router";
import { useSessionStore } from "@/stores/session";

const PUBLIC_ROUTES = new Set([
  "login", "auth-callback", "set-password", "forgot-password", "unlinked", "forbidden",
]);

/**
 * Navigation comfort, not security. Forcing an admin URL as a client simply
 * yields a screen that cannot load anything -- RLS is what refuses.
 *
 * Protection is "not listed in PUBLIC_ROUTES", deny by default: a future
 * route added without an explicit meta flag would otherwise be silently
 * public. meta.roles narrows further for routes that declare it.
 */
export function installGuards(router: Router) {
  router.beforeEach(async (to) => {
    const session = useSessionStore();
    await session.whenReady();

    if (PUBLIC_ROUTES.has(String(to.name))) return true;

    if (session.status === "anonymous") {
      return { name: "login", query: { redirect: to.fullPath } };
    }
    if (session.status === "unlinked" || session.status === "disabled") {
      return { name: "unlinked" };
    }
    if (session.status === "error") {
      // Not an access decision: the profile lookup failed. Let the
      // navigation through so AppShell can show the failure everywhere,
      // rather than guessing an access level from missing data.
      return true;
    }

    const allowed = to.meta.roles as string[] | undefined;
    if (allowed && !allowed.includes(session.role ?? "")) return { name: "forbidden" };

    return true;
  });
}
