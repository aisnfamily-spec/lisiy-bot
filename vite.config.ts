import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import webExtension from "vite-plugin-web-extension";
import { cpSync } from "fs";

export default defineConfig({
  plugins: [
    react(),
    webExtension({
      manifest: "manifest.json",
    }),
    {
      name: "copy-icons",
      closeBundle() {
        cpSync("icons", "dist/icons", { recursive: true });
      },
    },
  ],
});
