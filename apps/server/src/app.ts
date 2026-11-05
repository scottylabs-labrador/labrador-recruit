import fs from "node:fs";
import path from "node:path";

import { toNodeHandler } from "better-auth/node";
import cors, { type CorsOptions } from "cors";
import type { ErrorRequestHandler, RequestHandler } from "express";
import express, { Router } from "express";
import swaggerUi, { type JsonObject } from "swagger-ui-express";
import { parse as parseYaml } from "yaml";

import { RegisterRoutes } from "../build/routes.ts";
import { env } from "./env.ts";
import { auth } from "./lib/auth.ts";
import { localStorage } from "./lib/storage.ts";
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

/**
 * An application export is the one request that is legitimately large.
 *
 * The whole file arrives base64-encoded in the JSON body, which costs a third
 * again on top of its own size: the Fall 2026 form is 66 columns of essays, so
 * 118 applicants is already half a megabyte and a cycle twice that would not
 * have fitted under the general limit. It was refused with "request entity too
 * large", which reads as a broken server rather than a file to split.
 *
 * Scoped to the import route rather than raised across the board. Body-parser
 * skips a request whose body is already parsed, so mounting this first wins for
 * this path and leaves every other route - including the unauthenticated ones -
 * at the smaller limit. Committing an import is a recruitment-admin action, so
 * the larger allowance is not reachable by an anonymous caller.
 */
app.use("/recruitment/cycles/:cycleId/imports", express.json({ limit: "16mb" }));

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

/**
 * The API lives under `/v1`.
 *
 * Mounted on a router rather than set through tsoa's `spec.basePath`, which
 * only prefixes the OpenAPI document and leaves the Express routes at the root.
 * Having those two disagree is a 404 that looks like a routing bug and is a
 * configuration one.
 *
 * The generated spec therefore describes paths without the prefix, and the web
 * client adds it to its base URL. See `apps/web/src/lib/apiClient.ts`.
 */
const v1 = Router();
RegisterRoutes(v1);
app.use("/v1", v1);

/*
 * Object storage, in development only.
 *
 * In production the browser PUTs and GETs straight to R2 and these paths do
 * not exist at all - `localStorage` is null and nothing is mounted. The local
 * adapter serves the bytes itself so that the whole upload flow can be built
 * and exercised before anyone has provisioned a bucket (see `#11`).
 *
 * Deliberately **outside `/v1`**: these are not part of the API contract and
 * must not appear in the generated spec, because a client written against
 * them would break the moment real storage arrives.
 *
 * The signature is the authorization here. A request with no signature, an
 * expired one, or one issued for a different key is 403 - which is the
 * property that makes the object key worthless on its own, in development
 * exactly as in R2.
 */
/**
 * A filename safe to put inside a quoted `Content-Disposition`.
 *
 * Quotes and backslashes removed rather than escaped. The header is a quoted
 * string, so a filename containing either can end the quoting early and inject
 * a second header parameter - and the filename came from the applicant.
 *
 * `replaceAll` rather than spreading the string: spreading iterates Unicode
 * code points, which splits an emoji in a filename into pieces and reassembles
 * it as mojibake. The applicant named their file; we only remove the two
 * characters that break the header.
 */
function safeFilename(name: string): string {
  return name.replaceAll('"', "").replaceAll("\\", "");
}

if (localStorage !== null) {
  const local = localStorage;

  app.put("/__local-storage/put", express.raw({ limit: "16mb", type: "*/*" }), (req, res) => {
    const verdict = local.verify(req.originalUrl.slice(req.originalUrl.indexOf("?")), "put");
    if (!verdict.ok || verdict.key === undefined) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }
    void local
      .put(verdict.key, new Uint8Array(req.body as Buffer))
      .then(() => res.status(200).json({ status: "ok" }))
      .catch(() => res.status(500).json({ message: "Could not store the file." }));
  });

  app.get("/__local-storage/get", (req, res) => {
    const query = req.originalUrl.slice(req.originalUrl.indexOf("?"));
    const verdict = local.verify(query, "get");
    if (!verdict.ok || verdict.key === undefined) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }
    void local
      .readPrefix(verdict.key, 16 * 1024 * 1024)
      .then((bytes) => {
        if (bytes === null) {
          res.status(404).json({ message: "Not found" });
          return;
        }
        const filename = new URLSearchParams(query).get("filename") ?? "download";
        /*
         * `attachment`, always, and the filename is quoted rather than
         * interpolated into a path. An applicant's upload must never be
         * rendered inline by the browser - that is how an accepted image
         * becomes a page running on this origin.
         */
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Disposition", `attachment; filename="${safeFilename(filename)}"`);
        res.status(200).send(Buffer.from(bytes));
      })
      .catch(() => res.status(500).json({ message: "Could not read the file." }));
  });
}
app.get("/", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use(errorHandler as ErrorRequestHandler);
app.use(notFoundHandler);

export { app };
