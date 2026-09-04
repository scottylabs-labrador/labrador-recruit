import type { Request as ExpressRequest } from "express";
import {
  Controller,
  Get,
  Path,
  Post,
  Query,
  Request,
  Route,
  Security,
  SuccessResponse,
} from "tsoa";

import { BEARER_AUTH, OIDC_AUTH } from "../lib/authentication.ts";
import { getCycleIdForApplication, getRecruitmentUser } from "../lib/recruitmentContext.ts";
import { HttpError } from "../middlewares/errorHandler.ts";
import { applicantService } from "../services/applicantService.ts";
import { githubService } from "../services/githubService.ts";

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
   * are returned verbatim as inert strings and are never fetched from here.
   *
   * GitHub is the single exception, and it is not made here: cached facts are
   * served from `/github` below, and fetching happens on a schedule rather
   * than while this page is being assembled. See `docs/product-rules.md` §1.
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

  /**
   * Cached GitHub facts for an applicant who supplied a GitHub link.
   *
   * A read of what was last fetched. Never contacts GitHub: the unauthenticated
   * budget is 60 requests an hour for the whole deployment, so a reviewer
   * opening ten applicants would otherwise spend a sixth of it.
   */
  @Get("applications/{applicationId}/github")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async getGithubProfile(@Request() req: ExpressRequest, @Path() applicationId: string) {
    const cycleId = await getCycleIdForApplication(applicationId);
    if (!cycleId) {
      throw new HttpError(404, "Application not found");
    }
    const user = await getRecruitmentUser(req, cycleId);
    return { profile: await githubService.getProfile(user, applicationId) };
  }

  /** Asks GitHub again for this one applicant, for a reviewer who wants it now. */
  @Post("applications/{applicationId}/github/refresh")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async refreshGithubProfile(@Request() req: ExpressRequest, @Path() applicationId: string) {
    const cycleId = await getCycleIdForApplication(applicationId);
    if (!cycleId) {
      throw new HttpError(404, "Application not found");
    }
    const user = await getRecruitmentUser(req, cycleId);
    return { profile: await githubService.refreshOne(user, applicationId) };
  }
}
