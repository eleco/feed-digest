import { loadEnv, type Plugin } from "vite";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { serveReader } from "./node-reader";

export function localReader(): Plugin {
  return {
    name: "local-reader",
    configureServer(server) {
      const env = {
        ...loadEnv(server.config.mode, resolve("."), "READER_"),
        ...process.env,
      };
      const directory = resolve(".reader-data");
      const file = resolve(directory, "saved-posts.json.gz");
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split("?")[0];
        if (path !== "/reader" && path !== "/api/reader") {
          next();
          return;
        }
        void serveReader(
          req,
          res,
          {
            async read() {
              try {
                return await readFile(file);
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code === "ENOENT")
                  return null;
                throw error;
              }
            },
            async write(value) {
              await mkdir(directory, { recursive: true });
              const temporary = resolve(directory, randomUUID() + ".tmp");
              await writeFile(temporary, value);
              await rename(temporary, file);
            },
          },
          async () =>
            server.transformIndexHtml(
              "/reader.html",
              await readFile(resolve("site/reader.html"), "utf8"),
            ),
          env,
        );
      });
    },
  };
}
