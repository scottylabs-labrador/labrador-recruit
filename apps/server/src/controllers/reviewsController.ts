import type { RecommendationValue } from "@labrador/common/recruitment";
import type { Request as ExpressRequest } from "express";
import {
  Body,
  Controller,
  Get,
  Path,
  Post,
  Put,
  Query,
  Request,
  Route,
  Security,
  SuccessResponse,
} from "tsoa";

import { BEARER_AUTH, OIDC_AUTH } from "../lib/authentication.ts";
import {
  getCycleIdForAssignment,
  getCycleIdForCandidacy,
  getRecruitmentUser,
} from "../lib/recruitmentContext.ts";
import { HttpError } from "../middlewares/errorHandler.ts";
import { aggregateService } from "../services/aggregateService.ts";
import { assignmentService } from "../services/assignmentService.ts";
import { reviewService } from "../services/reviewService.ts";

export interface SaveReviewRequest {
  scores?: Record<string, number>;
  recommendation?: RecommendationValue;
  confidence?: "high" | "medium" | "low";
  rationale?: string;
  privateNotes?: string;
  discussionFlag?: boolean;
  underratedFlag?: boolean;
}

@Route("recruitment")
export class ReviewsController extends Controller {
  /** The caller's own review queue for a cycle. */
  @Get("cycles/{cycleId}/my-queue")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async listMyQueue(
    @Request() req: ExpressRequest,
    @Path() cycleId: string,
    @Query() status?: string,
    @Query() committeeId?: string,
  ) {
    const user = await getRecruitmentUser(req, cycleId);
    return assignmentService.listMyQueue(user, cycleId, {
      ...(status !== undefined && { status }),
      ...(committeeId !== undefined && { committeeId }),
    });
  }

  /**
   * Opens the caller's review for an assignment, creating a draft if none
   * exists so autosave has somewhere to write.
   */
  @Get("assignments/{assignmentId}/review")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async getReview(@Request() req: ExpressRequest, @Path() assignmentId: string) {
    const user = await getRecruitmentUser(req, await resolveCycle(assignmentId));
    return reviewService.getOrCreateDraft(user, assignmentId);
  }

  /** Autosaves a draft. Never scores; only submission does that. */
  @Put("assignments/{assignmentId}/review")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async saveDraft(
    @Request() req: ExpressRequest,
    @Path() assignmentId: string,
    @Body() body: SaveReviewRequest,
  ) {
    const user = await getRecruitmentUser(req, await resolveCycle(assignmentId));
    return reviewService.saveDraft(user, assignmentId, body);
  }

  @Post("assignments/{assignmentId}/review/submit")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async submitReview(
    @Request() req: ExpressRequest,
    @Path() assignmentId: string,
    @Body() body: SaveReviewRequest,
  ) {
    const user = await getRecruitmentUser(req, await resolveCycle(assignmentId));
    return reviewService.submitReview(user, assignmentId, body);
  }

  /** Reopens a submitted review. Recruitment admins only. */
  @Post("assignments/{assignmentId}/review/reopen")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(204)
  async reopenReview(@Request() req: ExpressRequest, @Path() assignmentId: string): Promise<void> {
    this.setStatus(204);
    const user = await getRecruitmentUser(req, await resolveCycle(assignmentId));
    await reviewService.reopenReview(user, assignmentId);
  }

  /**
   * Declares a conflict of interest. The reviewer is never asked to explain,
   * and the applicant is never penalised.
   */
  @Post("assignments/{assignmentId}/conflict")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(204)
  async declareConflict(
    @Request() req: ExpressRequest,
    @Path() assignmentId: string,
  ): Promise<void> {
    this.setStatus(204);
    const user = await getRecruitmentUser(req, await resolveCycle(assignmentId));
    await reviewService.declareConflict(user, assignmentId);
  }

  /**
   * The reviews behind a candidacy. A reviewer who has not yet submitted their
   * own review sees only their own, which is what keeps review independent.
   */
  @Get("candidacies/{candidacyId}/reviews")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async listCandidacyReviews(@Request() req: ExpressRequest, @Path() candidacyId: string) {
    const cycleId = await getCycleIdForCandidacy(candidacyId);
    if (!cycleId) {
      throw new HttpError(404, "Candidacy not found");
    }
    const user = await getRecruitmentUser(req, cycleId);
    return aggregateService.getCandidacyReviews(user, candidacyId);
  }
}

async function resolveCycle(assignmentId: string): Promise<string> {
  const cycleId = await getCycleIdForAssignment(assignmentId);
  if (!cycleId) {
    throw new HttpError(404, "Assignment not found");
  }
  return cycleId;
}
