import type { AnswerValue } from "@recruit/common";
import type { Request as ExpressRequest } from "express";
import {
  Body,
  Controller,
  Get,
  Patch,
  Path,
  Post,
  Request,
  Route,
  Security,
  SuccessResponse,
} from "tsoa";

import { getAcUserFromRequest } from "../lib/accessControl.ts";
import { BEARER_AUTH, OIDC_AUTH } from "../lib/authentication.ts";
import { AuthenticationError } from "../middlewares/errorHandler.ts";
import type {
  ApplicationDetail,
  ApplicationSummary,
  DraftSaved,
} from "../services/applicationService.ts";
import { applicationService } from "../services/applicationService.ts";

interface DraftBody {
  /**
   * The revision the client last read.
   *
   * A stale value is refused with the current one rather than overwritten. A
   * laptop and a phone both autosaving is the ordinary case, and taking the
   * last write would lose whatever the slower tab did not have.
   */
  revision: number;
  answers: { questionKey: string; value: AnswerValue }[];
}

interface CreateApplicationBody {
  openingId: string;
}

interface ProfileView {
  cycleSlug: string;
  cycleName: string;
  closesAt: string | null;
  commonLocked: boolean;
}

/**
 * Everything an applicant can reach about their own application.
 *
 * **Every route here is scoped to the caller's own profile**, resolved from
 * their session rather than from anything they sent. There is deliberately no
 * applicant route that takes another person's id — not a filtered one, not an
 * anonymized one — and a row the caller does not own is 404 rather than 403, so
 * the platform never confirms that somebody else's application exists.
 */
@Route("me")
export class MeController extends Controller {
  @Get("profile")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async getProfile(@Request() req: ExpressRequest): Promise<ProfileView> {
    return await applicationService.getProfile(await callerId(req));
  }

  @Get("applications")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async listApplications(@Request() req: ExpressRequest): Promise<ApplicationSummary[]> {
    return await applicationService.listApplications(await callerId(req));
  }

  /**
   * Starts an application, or returns the one already in progress.
   *
   * 201 for a new one and 200 for an existing one, so a client can tell them
   * apart without a second request. Not an error on the second attempt:
   * somebody clicking Apply twice should land on the application they already
   * started.
   */
  @Post("applications")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(201)
  async createApplication(
    @Request() req: ExpressRequest,
    @Body() body: CreateApplicationBody,
  ): Promise<ApplicationSummary> {
    const result = await applicationService.createApplication(await callerId(req), body.openingId);
    this.setStatus(result.created ? 201 : 200);
    return result.summary;
  }

  @Get("applications/{applicationId}")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async getApplication(
    @Request() req: ExpressRequest,
    @Path() applicationId: string,
  ): Promise<ApplicationDetail> {
    return await applicationService.getApplication(await callerId(req), applicationId);
  }

  @Patch("applications/{applicationId}/draft")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async saveApplicationDraft(
    @Request() req: ExpressRequest,
    @Path() applicationId: string,
    @Body() body: DraftBody,
  ): Promise<DraftSaved> {
    return await applicationService.saveApplicationDraft(
      await callerId(req),
      applicationId,
      body.revision,
      body.answers,
    );
  }

  @Patch("common-response/draft")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async saveCommonDraft(
    @Request() req: ExpressRequest,
    @Body() body: DraftBody,
  ): Promise<DraftSaved> {
    return await applicationService.saveCommonDraft(
      await callerId(req),
      body.revision,
      body.answers,
    );
  }

  @Post("applications/{applicationId}/withdraw")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async withdrawApplication(
    @Request() req: ExpressRequest,
    @Path() applicationId: string,
  ): Promise<ApplicationSummary> {
    return await applicationService.withdrawApplication(await callerId(req), applicationId);
  }
}

/**
 * The Andrew ID of the caller.
 *
 * `getAcUserFromRequest` returns a guest with an empty id when the token
 * resolves to nobody — which is a real state, not an error: it is what a first
 * sign-in looks like before the auth callback has written the account row.
 * Treating it as unauthenticated is right, and letting an empty id through
 * would scope every query to a profile belonging to nobody.
 */
async function callerId(req: ExpressRequest): Promise<string> {
  const user = await getAcUserFromRequest(req);
  if (user.id === "") {
    throw new AuthenticationError();
  }
  return user.id;
}
