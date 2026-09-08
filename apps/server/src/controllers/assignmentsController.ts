import type { Request as ExpressRequest } from "express";
import {
  Body,
  Controller,
  Delete,
  Get,
  Path,
  Post,
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
import { assignmentService } from "../services/assignmentService.ts";

export interface AssignReviewerRequest {
  reviewerUserId: string;
}

@Route("recruitment")
export class AssignmentsController extends Controller {
  /**
   * Claims the next applicant for the caller to review.
   *
   * A POST because it is not a question - it takes the work, so asking twice
   * takes two. Returns 204 when the cycle has nothing left for this reviewer,
   * which is the ordinary end state rather than an error: everything in their
   * committees either has enough reviews or is already theirs.
   */
  @Post("cycles/{cycleId}/next-review")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async claimNextReview(@Request() req: ExpressRequest, @Path() cycleId: string) {
    const user = await getRecruitmentUser(req, cycleId);
    const claimed = await assignmentService.claimNextReview(user, cycleId);
    if (claimed === null) {
      this.setStatus(204);
      return;
    }
    return claimed;
  }

  /** Reviewer workloads across a cycle, so coverage can be rebalanced. */
  @Get("cycles/{cycleId}/workloads")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async listWorkloads(@Request() req: ExpressRequest, @Path() cycleId: string) {
    const user = await getRecruitmentUser(req, cycleId);
    return assignmentService.listWorkloads(user, cycleId);
  }

  @Get("candidacies/{candidacyId}/assignments")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async listForCandidacy(@Request() req: ExpressRequest, @Path() candidacyId: string) {
    const cycleId = await getCycleIdForCandidacy(candidacyId);
    if (!cycleId) {
      throw new HttpError(404, "Candidacy not found");
    }
    const user = await getRecruitmentUser(req, cycleId);
    return assignmentService.listForCandidacy(user, candidacyId);
  }

  /**
   * Assigns a reviewer. Refuses a reviewer with no membership covering the
   * committee, so an assignment never silently widens someone's access.
   */
  @Post("candidacies/{candidacyId}/assignments")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(201)
  async assignReviewer(
    @Request() req: ExpressRequest,
    @Path() candidacyId: string,
    @Body() body: AssignReviewerRequest,
  ) {
    this.setStatus(201);
    const cycleId = await getCycleIdForCandidacy(candidacyId);
    if (!cycleId) {
      throw new HttpError(404, "Candidacy not found");
    }
    const user = await getRecruitmentUser(req, cycleId);
    return assignmentService.assignReviewer(user, candidacyId, body.reviewerUserId);
  }

  /** Cancels an assignment. A submitted review can never be unassigned. */
  @Delete("assignments/{assignmentId}")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(204)
  async cancelAssignment(
    @Request() req: ExpressRequest,
    @Path() assignmentId: string,
  ): Promise<void> {
    this.setStatus(204);
    const cycleId = await getCycleIdForAssignment(assignmentId);
    if (!cycleId) {
      throw new HttpError(404, "Assignment not found");
    }
    const user = await getRecruitmentUser(req, cycleId);
    await assignmentService.cancelAssignment(user, assignmentId);
  }
}
