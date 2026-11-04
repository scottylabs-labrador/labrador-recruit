import { notificationOutbox } from "@recruit/db/schema";

import type { Transaction } from "../lib/db.ts";

export interface NotificationRequest {
  template: string;
  recipientEmail: string;
  /**
   * Template variables only.
   *
   * **No applicant response text**, and nothing the recipient does not already
   * hold — see `docs/product-rules.md` section 6. The worker never logs this,
   * but an email that quoted somebody's essay back would be a disclosure to
   * whatever mail provider carried it.
   */
  payload?: Record<string, unknown>;
}

/**
 * Queues an email, inside the caller's transaction.
 *
 * Seam 3. **Track B owns this** (#29); it is here because Track A's submission
 * path needed something to call, and the signature is the agreed one from
 * `docs/collaboration.md`. The delivery side — claiming rows atomically,
 * backoff, retry, marking dead — is the worker, and is Track B's to write.
 *
 * Taking the transaction handle is the whole design, not a convenience. A
 * service physically cannot enqueue outside a transaction, so a confirmation
 * email can never exist for a submission that rolled back. The alternative —
 * sending inline — means a dead mail provider fails an application.
 *
 * TODO(track-b): #29 implements the worker that drains this.
 */
export async function enqueueNotification(
  tx: Transaction,
  request: NotificationRequest,
): Promise<void> {
  const now = new Date();
  await tx.insert(notificationOutbox).values({
    template: request.template,
    recipientEmail: request.recipientEmail,
    payloadJson: request.payload ?? null,
    // Available immediately. The worker's backoff pushes this forward on a
    // failed attempt.
    availableAt: now,
    createdAt: now,
  });
}
