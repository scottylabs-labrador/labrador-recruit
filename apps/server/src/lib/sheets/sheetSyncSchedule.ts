import { env } from "../../env.ts";
import { importService } from "../../services/importService.ts";

/**
 * Pulls every sheet-backed cycle on a timer.
 *
 * In-process rather than a platform cron. Railway's scheduled-job and
 * pre-deploy settings are not reachable from its CLI on this account - the same
 * limitation that put migrations in the container entrypoint - so a timer here
 * is the difference between a schedule that exists in the repository and one
 * that depends on somebody remembering to configure a dashboard.
 *
 * This assumes a single replica. With more than one, each would pull on its own
 * timer and stage duplicate previews; they would be harmless, since nothing is
 * committed without a person, but they would be noise. Move this to a real
 * scheduler before scaling the API out.
 */
export function startSheetSyncSchedule(): { stop: () => void } | null {
  const minutes = env.SHEET_SYNC_INTERVAL_MINUTES;
  if (minutes === undefined) {
    return null;
  }

  const run = async () => {
    let cycles: Awaited<ReturnType<typeof importService.listSheetBackedCycles>>;
    try {
      cycles = await importService.listSheetBackedCycles();
    } catch (error) {
      console.error("[sheet-sync] could not list cycles", error);
      return;
    }

    for (const cycle of cycles) {
      try {
        const result = await importService.syncOnSchedule(cycle);
        console.log(
          `[sheet-sync] cycle ${cycle.id}: staged import ${result.importId}, ` +
            `${String(result.preview.rowCount)} rows, ${String(result.preview.errorCount)} errors`,
        );
      } catch (error) {
        // One cycle's sheet being unreadable must not stop the others, and must
        // not take the process down: this runs unattended.
        console.error(`[sheet-sync] cycle ${cycle.id} failed`, error);
      }
    }
  };

  const timer = setInterval(() => void run(), minutes * 60_000);
  // Never hold the process open for a scheduled pull.
  timer.unref?.();

  console.log(`[sheet-sync] pulling every ${String(minutes)} minutes`);
  return { stop: () => clearInterval(timer) };
}
