import { defineConfig } from "vite";
import { resolve } from "node:path";
export default defineConfig({
  root: "site",
  build: {
    outDir: "../site-dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve("site/index.html"),
      },
    },
  },
});
