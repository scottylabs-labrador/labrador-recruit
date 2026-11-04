import http from "node:http";
import process from "node:process";

import { app } from "./app.ts";
import { env } from "./env.ts";

const server = http.createServer(app);

const port = env.SERVER_PORT;
server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

process.on("SIGINT", () => {
  process.exit();
});
