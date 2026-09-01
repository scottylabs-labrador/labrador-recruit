import type { Request as ExpressRequest } from "express";
import { Controller, Get, Path, Query, Request, Route, Security, SuccessResponse } from "tsoa";

import { BEARER_AUTH, OIDC_AUTH } from "../lib/authentication.ts";
import { getCycleIdForApplication, getRecruitmentUser } from "../lib/recruitmentContext.ts";
import { HttpError } from "../middlewares/errorHandler.ts";
import { applicantService } from "../services/applicantService.ts";

@Route("recruitment")
export class ApplicantsController extends Controller {
  /** Applications the caller may see in a cycle. */
  @Get("cycles/{cycleId}/applications")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async listApplications(
    @Request() req: ExpressRequest,
    @Path() cycleId: string,
    @Query() committeeId?: string,
    @Query() limit?: number,
    @Query() offset?: number,
  ) {
    const user = await getRecruitmentUser(req, cycleId);
    return applicantService.listApplications(user, cycleId, {
      ...(committeeId !== undefined && { committeeId }),
      ...(limit !== undefined && { limit }),
      ...(offset !== undefined && { offset }),
    });
  }

  /**
   * One application, grouped into readable sections. Applicant-provided links
   * are returned verbatim as inert strings; the server never fetches them.
   */
  @Get("applications/{applicationId}")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async getApplication(@Request() req: ExpressRequest, @Path() applicationId: string) {
    const cycleId = await getCycleIdForApplication(applicationId);
    if (!cycleId) {
      throw new HttpError(404, "Application not found");
    }
    const user = await getRecruitmentUser(req, cycleId);
    return applicantService.getApplication(user, applicationId);
  }
}
