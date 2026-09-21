import { createRouter, createWebHistory } from "vue-router";
import { installGuards } from "./guards";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "home", component: () => import("@/features/home/HomeView.vue") },
    // The account and administration routes arrive with their screens, in task 12.
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
  ],
});

installGuards(router);
