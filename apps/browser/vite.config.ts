import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";

import tsconfigPaths from "vite-tsconfig-paths";
export default defineConfig({
  plugins: [
    tsconfigPaths(),
    tailwindcss(),
    tanstackRouter({
      target: "react",
      virtualRouteConfig: "./src/platform/routes.ts",
      routesDirectory: "./src",
    }),
    react(),
  ],
});
