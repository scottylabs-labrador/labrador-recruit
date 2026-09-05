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

export interface DistributeAssignmentsRequest {
  /** How many reviewers each candidacy should end up with. 1-10. */
  reviewersPerCandidacy: number;
  /** Restrict to these reviewers. Omitted means everyone eligible. */
  reviewerUserIds?: string[];
  /** Return the plan without writing it. */
  dryRun?: boolean;
}

@Route("recruitment")
export class AssignmentsController extends Controller {
  /** Reviewer workloads across a cycle, so coverage can be rebalanced. */
  @Get("cycles/{cycleId}/workloads")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async listWorkloads(@Request() req: ExpressRequest, @Path() cycleId: string) {
    const user = await getRecruitmentUser(req, cycleId);
    return assignmentService.listWorkloads(user, cycleId);
  }

  /**
   * Tops every candidacy in a committee up to a target number of reviewers.
   *
   * `dryRun` returns the plan without writing it, which is what the screen
   * shows before anyone commits. Assigning reviewers is explicitly permitted by
   * product rule 1: it decides who reads what, never what they conclude.
   */
  @Post("cycles/{cycleId}/committees/{committeeId}/assignments/distribute")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async distribute(
    @Request() req: ExpressRequest,
    @Path() cycleId: string,
    @Path() committeeId: string,
    @Body() body: DistributeAssignmentsRequest,
  ) {
    const user = await getRecruitmentUser(req, cycleId);
    return assignmentService.distributeCommittee(user, cycleId, committeeId, body);
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
