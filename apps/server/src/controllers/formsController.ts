import { Get, Path, Route, Security, SuccessResponse } from "tsoa";

import { BEARER_AUTH, OIDC_AUTH } from "../lib/authentication.ts";
import { NotFoundError } from "../middlewares/errorHandler.ts";
import type { PublishedForm } from "../services/formService.ts";
import { formService } from "../services/formService.ts";

@Route("forms")
export class FormsController {
  /**
   * The newest published version of a form, with its questions.
   *
   * Authenticated, per `docs/api.md` section 3. The landing page needs
   * committee names and descriptions, which `/v1/openings` serves publicly —
   * it does not need the whole question set. Serving that anonymously would
   * publish every committee's question design, archived cycles included,
   * permanently and to anybody.
   *
   * Unavailable for any reason is 404, never 403: a draft is a director's work
   * in progress, and telling an applicant one exists leaks that a committee is
   * preparing to recruit. The same applies to a committee whose opening has not
   * opened yet.
   */
  @Get("{formId}/published")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async getPublishedForm(@Path() formId: string): Promise<PublishedForm> {
    const published = await formService.getPublishedForm(formId);
    if (!published) {
      throw new NotFoundError();
    }
    return published;
  }
}
