import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import { useSessionStore } from "./stores/session";
import "./style.css";

const app = createApp(App);
app.use(createPinia());

// Resolve the session before the first render, so no screen flashes the wrong state.
await useSessionStore().init();

app.use(router);
app.mount("#app");
