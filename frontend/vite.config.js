import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/tiles": "http://localhost:3000",
    },
  },
});
