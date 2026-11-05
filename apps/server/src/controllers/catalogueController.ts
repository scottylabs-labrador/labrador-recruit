import { Get, Route, SuccessResponse } from "tsoa";

import type { CurrentCycle, PublicOpening } from "../services/catalogueService.ts";
import { catalogueService } from "../services/catalogueService.ts";

/**
 * The public catalogue.
 *
 * Deliberately unauthenticated: this is what the landing page shows somebody
 * who is deciding whether to apply at all, and requiring an account to read it
 * would turn away the people it exists for.
 *
 * The rule for everything here is that it carries only what a poster on a wall
 * could say — no applicant data, no counts of applicants, no form contents, and
 * nothing about a cycle or a committee that has not been announced.
 */
@Route("")
export class CatalogueController {
  @Get("cycles/current")
  @SuccessResponse(200)
  async getCurrentCycle(): Promise<CurrentCycle> {
    return await catalogueService.getCurrentCycle();
  }

  @Get("openings")
  @SuccessResponse(200)
  async listOpenings(): Promise<PublicOpening[]> {
    return await catalogueService.listOpenings();
  }
}
