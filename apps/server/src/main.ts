import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app";

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";
const dbFile = process.env.LK_DB ?? path.resolve(here, "../data/lanternkeep.db");
const webDist = process.env.LK_WEB_DIST ?? path.resolve(here, "../../web/dist");

const app = await buildApp({ dbFile, logger: true, webDist });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

await app.server.listen({ port, host });
