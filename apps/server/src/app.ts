import fs from "node:fs";
import path from "node:path";

import { toNodeHandler } from "better-auth/node";
import cors, { type CorsOptions } from "cors";
import type { ErrorRequestHandler, RequestHandler } from "express";
import express from "express";
import swaggerUi, { type JsonObject } from "swagger-ui-express";
import { parse as parseYaml } from "yaml";

import { RegisterRoutes } from "../build/routes.ts";
import { env } from "./env.ts";
import { auth } from "./lib/auth.ts";
import { errorHandler } from "./middlewares/errorHandler.ts";
import { notFoundHandler } from "./middlewares/notFoundHandler.ts";

const app = express();

const corsOptions: CorsOptions = {
  origin: env.ALLOWED_ORIGINS_REGEX?.split(",").map((origin) => new RegExp(origin)),
  credentials: true,
};
app.use(cors(corsOptions));

// Setup Authentication: https://www.better-auth.com/docs/integrations/express
app.all("/api/auth/*splat", toNodeHandler(auth) as unknown as RequestHandler);

// Mount after Better Auth so it can read the raw request body.
app.use(express.json({ limit: "1mb" }));

/**
 * The generated specification, if it is on disk beside us.
 *
 * Read defensively because the API also runs as a bundled serverless function,
 * where the working directory is not the package root and only the code that
 * was traced into the bundle exists at all. Failing to find it is not worth
 * taking the whole API down for: the documentation UI is a convenience, and
 * every route it describes works without it.
 */
function loadSwagger(): JsonObject | null {
  for (const candidate of ["./build/swagger.yaml", path.join(__dirname, "../build/swagger.yaml")]) {
    try {
      return parseYaml(fs.readFileSync(candidate, "utf8")) as JsonObject;
    } catch {
      continue;
    }
  }
  return null;
}

const swaggerJson = loadSwagger();
if (swaggerJson !== null) {
  app.use(
    "/swagger",
    // https://github.com/scottie1984/swagger-ui-express/issues/114#issuecomment-566022730
    express.static(path.join(__dirname, "../node_modules/swagger-ui-dist"), {
      index: false,
    }),
    swaggerUi.serve,
    swaggerUi.setup(swaggerJson),
  );
  app.get("/openapi.json", (_req, res) => {
    res.status(200).send(swaggerJson);
  });
}

RegisterRoutes(app);
app.get("/", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use(errorHandler as ErrorRequestHandler);
app.use(notFoundHandler);

export { app };
