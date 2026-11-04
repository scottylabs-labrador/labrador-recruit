import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import { API_PORT, API_URL, PG_PORT, stackEnv, WEB_PORT, WEB_URL } from "./config.ts";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const env = { ...process.env, ...stackEnv };
const children: ChildProcess[] = [];

/**
 * Waits for a process in the stack to answer.
 *
 * The window is three minutes, not one. Sixty seconds was enough on a warm
 * machine and not enough on a cold one: the API boots PGlite and runs every
 * migration, and the web service builds with Vite first. This suite has failed
 * three times on that boundary and passed on retry every time, which is the
 * signature of a ceiling set too low rather than anything being wrong.
 *
 * It is a ceiling, not a delay — a healthy stack still answers in seconds, so
 * raising it costs nothing when things work and stops a flake reading as a
 * regression when they are merely slow.
 */
async function waitFor(url: string) {
  const timeoutMs = 180_000;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      lastError = `responded ${res.status}`;
    } catch (error) {
      // Still booting.
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  // The last thing that went wrong, because "timed out" alone sends somebody
  // looking at the timeout rather than at the process that never came up.
  throw new Error(
    `Timed out after ${timeoutMs / 1000}s waiting for ${url}. Last attempt: ${String(lastError)}`,
  );
}

function spawnApp(command: string, args: string[], cwd: string) {
  const child = spawn(command, args, {
    cwd: path.join(root, cwd),
    env,
    stdio: "inherit",
  });
  children.push(child);
  child.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`${cwd} exited with code ${code}`);
      process.exit(code);
    }
  });
  return child;
}

function runApp(command: string, args: string[], cwd: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: path.join(root, cwd),
      env,
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cwd} ${command} exited ${code}`));
    });
  });
}

const pglite = new PGlite();
await migrate(drizzle({ client: pglite }), {
  migrationsFolder: path.join(root, "packages/db/drizzle"),
});

const pgServer = new PGLiteSocketServer({
  db: pglite,
  port: PG_PORT,
  host: "127.0.0.1",
  maxConnections: 20,
});
await pgServer.start();

spawnApp("bun", ["run", "src/server.ts"], "apps/server");
await waitFor(`${API_URL}/`);

await runApp("bunx", ["vite", "build"], "apps/web");
spawnApp(
  "bunx",
  ["vite", "preview", "--port", String(WEB_PORT), "--strictPort", "--host", "127.0.0.1"],
  "apps/web",
);
await waitFor(WEB_URL);

console.log(`e2e stack ready on ${WEB_URL} (api ${API_PORT})`);

async function shutdown() {
  for (const child of children) {
    child.kill("SIGTERM");
  }
  await pgServer.stop();
  await pglite.close();
}

process.on("SIGINT", () => void shutdown().then(() => process.exit(0)));
process.on("SIGTERM", () => void shutdown().then(() => process.exit(0)));
