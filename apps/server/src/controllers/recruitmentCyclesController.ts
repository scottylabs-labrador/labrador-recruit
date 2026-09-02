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

import { BEARER_AUTH, OIDC_AUTH } from "../lib/authentication.ts";
import { getRecruitmentUser } from "../lib/recruitmentContext.ts";
import { auditService } from "../services/auditService.ts";
import { recruitmentCycleService } from "../services/recruitmentCycleService.ts";

export interface CreateCycleRequest {
  slug: string;
  name: string;
  minimumReviews?: number;
  candidacyTopN?: number;
  blindReviewEnabled?: boolean;
}

export interface UpdateCycleRequest {
  name?: string;
  status?: "draft" | "open" | "reviewing" | "deciding" | "archived";
  minimumReviews?: number;
  candidacyTopN?: number;
  blindReviewEnabled?: boolean;
  disagreementSpreadThreshold?: number;
  disagreementOnExtremeConflict?: boolean;
}

@Route("recruitment/cycles")
export class RecruitmentCyclesController extends Controller {
  /** Cycles the caller holds a recruitment membership in. */
  @Get("/")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async listCycles(@Request() req: ExpressRequest) {
    const user = await getRecruitmentUser(req, null);
    return recruitmentCycleService.listCycles(user);
  }

  @Post("/")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(201)
  async createCycle(@Request() req: ExpressRequest, @Body() body: CreateCycleRequest) {
    this.setStatus(201);
    const user = await getRecruitmentUser(req, null);
    return recruitmentCycleService.createCycle(user, body);
  }

  @Get("{cycleId}")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async getCycle(@Request() req: ExpressRequest, @Path() cycleId: string) {
    const user = await getRecruitmentUser(req, cycleId);
    return recruitmentCycleService.getCycle(user, cycleId);
  }

  @Patch("{cycleId}")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async updateCycle(
    @Request() req: ExpressRequest,
    @Path() cycleId: string,
    @Body() body: UpdateCycleRequest,
  ) {
    const user = await getRecruitmentUser(req, cycleId);
    return recruitmentCycleService.updateCycleSettings(user, cycleId, body);
  }

  /**
   * The caller's own recruitment standing, so the browser can evaluate the same
   * permission predicates the server uses instead of assuming least privilege.
   */
  @Get("{cycleId}/me")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async getMyStanding(@Request() req: ExpressRequest, @Path() cycleId: string) {
    const user = await getRecruitmentUser(req, cycleId);
    return recruitmentCycleService.getMyStanding(user, cycleId);
  }

  @Get("{cycleId}/committees")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async listCommittees(@Request() req: ExpressRequest, @Path() cycleId: string) {
    const user = await getRecruitmentUser(req, cycleId);
    return recruitmentCycleService.listCommittees(user, cycleId);
  }

  /**
   * Creates a committee and attaches it to this cycle, or updates it if the
   * slug already exists. Safe to call repeatedly while configuring a cycle.
   */
  @Post("{cycleId}/committees")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(201)
  async attachCommittee(
    @Request() req: ExpressRequest,
    @Path() cycleId: string,
    @Body()
    body: {
      slug: string;
      name: string;
      description?: string | null;
      capacity?: number | null;
      minimumReviews?: number | null;
      displayOrder?: number;
    },
  ) {
    const user = await getRecruitmentUser(req, cycleId);
    this.setStatus(201);
    return recruitmentCycleService.attachCommittee(user, cycleId, body);
  }

  /** The rubric a reviewer will be asked to score against. */
  @Get("{cycleId}/committees/{committeeId}/rubric")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async getRubric(
    @Request() req: ExpressRequest,
    @Path() cycleId: string,
    @Path() committeeId: string,
  ) {
    const user = await getRecruitmentUser(req, cycleId);
    return recruitmentCycleService.getActiveRubric(user, cycleId, committeeId);
  }

  @Get("{cycleId}/audit")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async listAuditEvents(@Request() req: ExpressRequest, @Path() cycleId: string) {
    const user = await getRecruitmentUser(req, cycleId);
    // Reuse the cycle read check: an audit log is only visible to a caller who
    // can already see the cycle it belongs to.
    await recruitmentCycleService.getCycle(user, cycleId);
    return auditService.listEvents(cycleId);
  }
}
