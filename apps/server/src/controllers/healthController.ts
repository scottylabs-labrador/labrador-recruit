import { Get, Route, SuccessResponse } from "tsoa";

/**
 * Liveness, for the platform's health check and for a developer confirming the
 * API is up at all.
 *
 * Deliberately unauthenticated, and deliberately says nothing else. A health
 * endpoint is the most-probed surface on any deployment, so it returns what a
 * poster on a wall could say and not a version, a count, or a configuration
 * value that would help somebody decide what to try next.
 */
@Route("health")
export class HealthController {
  @Get()
  @SuccessResponse(200)
  getHealth(): { status: "ok" } {
    return { status: "ok" };
  }
}
