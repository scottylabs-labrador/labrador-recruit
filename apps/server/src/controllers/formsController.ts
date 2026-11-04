import { Get, Path, Route, SuccessResponse } from "tsoa";

import { NotFoundError } from "../middlewares/errorHandler.ts";
import type { PublishedForm } from "../services/formService.ts";
import { formService } from "../services/formService.ts";

@Route("forms")
export class FormsController {
  /**
   * The newest published version of a form, with its questions.
   *
   * Deliberately **public**. The landing page shows a committee's questions
   * before anybody signs in, and requiring an account to read what is being
   * asked would turn away applicants who are still deciding whether to apply.
   * Nothing here is applicant data — it is what a poster on a wall could say.
   *
   * Unavailable for any reason is 404, never 403: a draft is a director's work
   * in progress, and telling an applicant one exists leaks that a committee is
   * preparing to recruit.
   */
  @Get("{formId}/published")
  @SuccessResponse(200)
  async getPublishedForm(@Path() formId: string): Promise<PublishedForm> {
    const published = await formService.getPublishedForm(formId);
    if (!published) {
      throw new NotFoundError();
    }
    return published;
  }
}
