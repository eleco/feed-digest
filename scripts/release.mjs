import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { zipSync } from "fflate";
const files = {};
async function visit(dir, prefix = "") {
  for (const e of (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )) {
    const name = prefix + e.name;
    if (e.isDirectory()) await visit(dir + "/" + e.name, name + "/");
    else
      files[name] = [
        new Uint8Array(await readFile(dir + "/" + e.name)),
        { mtime: new Date(2026, 0, 1, 0, 0, 0) },
      ];
  }
}
await visit("dist");
await mkdir("releases", { recursive: true });
await writeFile(
  "releases/x-feed-digest-0.1.0.zip",
  zipSync(files, { level: 9 }),
);
