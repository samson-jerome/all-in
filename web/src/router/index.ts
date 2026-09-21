import { createRouter, createWebHistory } from "vue-router";
import { installGuards } from "./guards";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "home", component: () => import("@/features/home/HomeView.vue") },
    { path: "/mon-compte", name: "account",
      component: () => import("@/features/account/ProfileView.vue") },
    { path: "/admin/organisations", name: "admin-organizations",
      component: () => import("@/features/admin/OrganizationsView.vue"),
      meta: { roles: ["admin"] } },
    { path: "/admin/utilisateurs", name: "admin-users",
      component: () => import("@/features/admin/UsersView.vue"),
      meta: { roles: ["admin"] } },
    { path: "/admin/invitations", name: "admin-invitations",
      component: () => import("@/features/admin/InvitationsView.vue"),
      meta: { roles: ["admin"] } },
    { path: "/connexion", name: "login",
      component: () => import("@/features/auth/LoginView.vue") },
    { path: "/auth/callback", name: "auth-callback",
      component: () => import("@/features/auth/AuthCallbackView.vue") },
    { path: "/definir-mot-de-passe", name: "set-password",
      component: () => import("@/features/auth/SetPasswordView.vue") },
    { path: "/mot-de-passe-oublie", name: "forgot-password",
      component: () => import("@/features/auth/ForgotPasswordView.vue") },
    { path: "/compte-non-rattache", name: "unlinked",
      component: () => import("@/features/auth/UnlinkedView.vue") },
    { path: "/acces-refuse", name: "forbidden",
      component: () => import("@/features/auth/ForbiddenView.vue") },
    // Unknown URL: send an anonymous visitor to login (not a blank page) and
    // an authenticated one home. Deliberately excluded from PUBLIC_ROUTES.
    { path: "/:pathMatch(.*)*", redirect: { name: "home" } },
  ],
});

installGuards(router);
