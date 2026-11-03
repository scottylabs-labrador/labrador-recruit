/**
 * The background worker.
 *
 * It exists for one structural reason: **a failing email provider must not be
 * able to fail an application submission.** A service writes `notification_outbox`
 * rows inside the same transaction as the domain event that caused them and
 * returns; this process delivers them out of band, records attempts, and retries.
 * A dead provider delays notifications. It does not lose applications.
 *
 * It also owns everything on a schedule. Do not add a `setInterval` to
 * `apps/server` — the previous version did, and those timers silently assume a
 * single replica and did nothing at all on a serverless host. Scheduled work
 * belongs here, where there is a real long-running process to hold it.
 *
 * This file is a shell. Workstream L owns the implementation; see
 * `docs/workstreams.md`. The loop below is deliberately the smallest thing that
 * runs, logs, and shuts down cleanly, so that the deployment wiring can be
 * proved before the delivery logic exists.
 */
import process from "node:process";

import { env } from "./env.ts";

/** How long to wait before looking for work again when the outbox was empty. */
const IDLE_POLL_MS = 5_000;

let running = true;

/**
 * Claim and deliver one batch of pending notifications.
 *
 * TODO(workstream-L): implement. The contract the rest of the system is written
 * against, from `docs/data-model.md` section 7 and `docs/architecture.md`
 * section 6:
 *
 * - Claim rows atomically — `FOR UPDATE SKIP LOCKED`, or a status
 *   compare-and-set — so two worker replicas can never send the same email
 *   twice. This is the requirement most easily lost when the loop gets
 *   refactored.
 * - Respect `available_at`, so a retry backs off rather than hammering a
 *   provider that is already failing.
 * - Record `attempts`, `last_attempt_at`, and `last_error` on every outcome. A
 *   notification that silently vanished is indistinguishable from one that was
 *   never enqueued, and somebody will have to tell an applicant which happened.
 * - Mark permanently undeliverable rows `dead` rather than retrying forever.
 * - Never log `payload_json`. See `docs/product-rules.md` section 6.
 *
 * @returns how many rows were processed, so the caller can poll faster while
 *   there is a backlog and idle when there is not.
 */
async function drainOutboxBatch(): Promise<number> {
  return await Promise.resolve(0);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  console.log(`worker: started, polling every ${IDLE_POLL_MS}ms when idle`);

  while (running) {
    let processed = 0;
    try {
      processed = await drainOutboxBatch();
    } catch (error) {
      // Never exit on a delivery error. The outbox is durable, so the correct
      // response to a transient failure is to try again shortly; crashing would
      // hand the problem to the orchestrator for no benefit.
      console.error("worker: batch failed", error);
    }

    if (processed === 0) {
      await sleep(IDLE_POLL_MS);
    }
  }

  console.log("worker: stopped");
}

function shutdown(signal: string): void {
  // Finish the batch in flight rather than killing it, so a notification is not
  // left claimed-but-unsent by a deploy.
  console.log(`worker: ${signal} received, finishing current batch`);
  running = false;
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Fail fast and loudly on a configuration mistake, before claiming any work.
console.log(`worker: database target resolved (${new URL(env.DATABASE_URL).host})`);

await main();
