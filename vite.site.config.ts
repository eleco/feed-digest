import { defineConfig } from "vite";
import { resolve } from "node:path";
import { localReader } from "./server/vite-reader";
export default defineConfig({
  root: "site",
  plugins: [localReader()],
  build: {
    outDir: "../site-dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve("site/index.html"),
        reader: resolve("site/reader.html"),
      },
    },
  },
});
