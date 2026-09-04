import http from "node:http";
import process from "node:process";

import { app } from "./app.ts";
import { env } from "./env.ts";
import { startSheetSyncSchedule } from "./lib/sheets/sheetSyncSchedule.ts";

const server = http.createServer(app);

const port = env.SERVER_PORT;
server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  // Started after the port is open so a failure to reach Google can never stop
  // the API serving; it only ever stages previews in any case.
  startSheetSyncSchedule();
});

process.on("SIGINT", () => {
  process.exit();
});
