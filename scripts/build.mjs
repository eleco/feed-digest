import { build } from "vite";
import { copyFile, readFile, writeFile } from "node:fs/promises";
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
// Stamp the build's local date and time into version_name so the loaded build
// is visible on extension pages and chrome://extensions. "version" itself only
// allows four small integers, so it stays the release number.
const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
manifest.version_name = `${manifest.version} (${stamp})`;
await writeFile("dist/manifest.json", JSON.stringify(manifest, null, 2) + "\n");

await copyFile("LICENSE", "dist/LICENSE");
await copyFile("PRIVACY.md", "dist/PRIVACY.txt");
await copyFile("THIRD_PARTY_NOTICES.txt", "dist/THIRD_PARTY_NOTICES.txt");
