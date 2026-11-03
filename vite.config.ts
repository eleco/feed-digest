import { defineConfig } from "vite";
export default defineConfig({
  build: {
    outDir: "dist",
    target: "chrome120",
    rollupOptions: {
      input: {
        popup: "popup.html",
        settings: "settings.html",
        digest: "digest.html",
        activity: "activity.html",
        background: "src/background/index.ts",
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
      },
    },
  },
});
