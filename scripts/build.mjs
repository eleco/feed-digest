import { build } from "vite";
import { copyFile } from "node:fs/promises";
await build();
await build({
  configFile: false,
  build: {
    outDir: "dist",
    emptyOutDir: false,
    target: "chrome120",
    lib: {
      entry: "src/content/index.ts",
      name: "XFeedDigest",
      formats: ["iife"],
      fileName: () => "content.js",
    },
  },
});
await copyFile("manifest.json", "dist/manifest.json");

await copyFile("LICENSE", "dist/LICENSE");
await copyFile("PRIVACY.md", "dist/PRIVACY.txt");
await copyFile("THIRD_PARTY_NOTICES.txt", "dist/THIRD_PARTY_NOTICES.txt");
