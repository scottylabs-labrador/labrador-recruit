import type { Request as ExpressRequest } from "express";
import {
  Body,
  Controller,
  Delete,
  Get,
  Path,
  Post,
  Put,
  Request,
  Route,
  Security,
  SuccessResponse,
} from "tsoa";

import { BEARER_AUTH, OIDC_AUTH } from "../lib/authentication.ts";
import {
  getCycleIdForApplication,
  getCycleIdForCandidacy,
  getRecruitmentUser,
} from "../lib/recruitmentContext.ts";
import { HttpError } from "../middlewares/errorHandler.ts";
import type { DecisionStatusValue, PlacementStatusValue } from "../services/decisionService.ts";
import { decisionService } from "../services/decisionService.ts";
import { membershipService } from "../services/membershipService.ts";

export interface CommitteeDecisionRequest {
  status: DecisionStatusValue;
  notes?: string;
  /** Required when status is "redirect". */
  redirectCommitteeId?: string | null;
}

export interface FinalPlacementRequest {
  status: PlacementStatusValue;
  /** Required when status is "placed". */
  committeeId?: string | null;
  notes?: string;
}

export interface GrantMembershipRequest {
  userId: string;
  role: "reviewer" | "committee_lead" | "recruitment_admin";
  committeeId?: string | null;
}

@Route("recruitment")
export class DecisionsController extends Controller {
  @Get("cycles/{cycleId}/progress")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async getProgress(@Request() req: ExpressRequest, @Path() cycleId: string) {
    const user = await getRecruitmentUser(req, cycleId);
    return decisionService.getCycleProgress(user, cycleId);
  }

  @Get("cycles/{cycleId}/committees/{committeeId}/decisions")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async listDecisions(
    @Request() req: ExpressRequest,
    @Path() cycleId: string,
    @Path() committeeId: string,
  ) {
    const user = await getRecruitmentUser(req, cycleId);
    return decisionService.listCommitteeDecisions(user, cycleId, committeeId);
  }

  /** Records a committee's proposal. Never becomes a placement on its own. */
  @Put("candidacies/{candidacyId}/decision")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async setDecision(
    @Request() req: ExpressRequest,
    @Path() candidacyId: string,
    @Body() body: CommitteeDecisionRequest,
  ) {
    const cycleId = await getCycleIdForCandidacy(candidacyId);
    if (!cycleId) {
      throw new HttpError(404, "Candidacy not found");
    }
    const user = await getRecruitmentUser(req, cycleId);
    return decisionService.setCommitteeDecision(user, candidacyId, body);
  }

  /** Applicants wanted by at least one committee, with their own preference. */
  @Get("cycles/{cycleId}/placements")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async listPlacementQueue(@Request() req: ExpressRequest, @Path() cycleId: string) {
    const user = await getRecruitmentUser(req, cycleId);
    return decisionService.listPlacementQueue(user, cycleId);
  }

  @Put("applications/{applicationId}/placement")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async setPlacement(
    @Request() req: ExpressRequest,
    @Path() applicationId: string,
    @Body() body: FinalPlacementRequest,
  ) {
    const cycleId = await getCycleIdForApplication(applicationId);
    if (!cycleId) {
      throw new HttpError(404, "Application not found");
    }
    const user = await getRecruitmentUser(req, cycleId);
    return decisionService.setFinalPlacement(user, applicationId, body);
  }

  @Get("cycles/{cycleId}/memberships")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async listMemberships(@Request() req: ExpressRequest, @Path() cycleId: string) {
    const user = await getRecruitmentUser(req, cycleId);
    return membershipService.listMemberships(user, cycleId);
  }

  /** Grants a recruitment role to a user who has already signed in once. */
  @Post("cycles/{cycleId}/memberships")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(201)
  async grantMembership(
    @Request() req: ExpressRequest,
    @Path() cycleId: string,
    @Body() body: GrantMembershipRequest,
  ) {
    this.setStatus(201);
    const user = await getRecruitmentUser(req, cycleId);
    return membershipService.grantMembership(user, cycleId, body);
  }

  /**
   * Removes a recruitment role. Deactivates rather than deletes, so reviews the
   * person already submitted keep a resolvable author.
   */
  @Delete("memberships/{membershipId}")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(204)
  async revokeMembership(@Request() req: ExpressRequest, @Path() membershipId: string) {
    const cycleId = await membershipService.getCycleIdForMembership(membershipId);
    if (!cycleId) {
      throw new HttpError(404, "Membership not found");
    }
    const user = await getRecruitmentUser(req, cycleId);
    await membershipService.revokeMembership(user, membershipId);
    this.setStatus(204);
  }

  @Get("cycles/{cycleId}/committees/{committeeId}/eligible-reviewers")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async listEligibleReviewers(
    @Request() req: ExpressRequest,
    @Path() cycleId: string,
    @Path() committeeId: string,
  ) {
    const user = await getRecruitmentUser(req, cycleId);
    return membershipService.listEligibleReviewers(user, cycleId, committeeId);
  }
}
