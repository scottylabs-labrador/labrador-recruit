import type { Request as ExpressRequest } from "express";
import { Body, Controller, Get, Path, Post, Request, Route, Security, SuccessResponse } from "tsoa";

import { BEARER_AUTH, OIDC_AUTH } from "../lib/authentication.ts";
import { getRecruitmentUser } from "../lib/recruitmentContext.ts";
import { exportService } from "../services/exportService.ts";
import type { CriterionInput } from "../services/rubricService.ts";
import { rubricService } from "../services/rubricService.ts";

export interface PublishRubricRequest {
  name: string;
  /** Null publishes the cycle default; a committee id overrides it for one committee. */
  committeeId?: string | null;
  criteria: CriterionInput[];
}

export interface ValidateRubricRequest {
  criteria: CriterionInput[];
}

@Route("recruitment/cycles/{cycleId}")
export class AdminToolsController extends Controller {
  /** Every rubric version, with how many submitted reviews depend on each. */
  @Get("rubrics")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async listRubrics(@Request() req: ExpressRequest, @Path() cycleId: string) {
    const user = await getRecruitmentUser(req, cycleId);
    return rubricService.listRubrics(user, cycleId);
  }

  /**
   * Publishes a new rubric version. Editing never mutates an existing one: a
   * submitted review pins the version it was scored under.
   */
  @Post("rubrics")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(201)
  async publishRubric(
    @Request() req: ExpressRequest,
    @Path() cycleId: string,
    @Body() body: PublishRubricRequest,
  ) {
    this.setStatus(201);
    const user = await getRecruitmentUser(req, cycleId);
    return rubricService.publishRubric(user, cycleId, body);
  }

  /** Checks a draft's weights without saving, for the editor. */
  @Post("rubrics/validate")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async validateRubricDraft(
    @Request() req: ExpressRequest,
    @Path() cycleId: string,
    @Body() body: ValidateRubricRequest,
  ) {
    const user = await getRecruitmentUser(req, cycleId);
    return rubricService.validateDraft(user, body.criteria);
  }

  /**
   * Exports are typed rows rather than a rendered file, so the interface can
   * show them before anyone downloads a spreadsheet. Every column is submitted
   * application data or arithmetic over human-entered scores.
   */
  @Get("exports/committees/{committeeId}/ranking")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async exportRanking(
    @Request() req: ExpressRequest,
    @Path() cycleId: string,
    @Path() committeeId: string,
  ) {
    const user = await getRecruitmentUser(req, cycleId);
    return exportService.exportCommitteeRanking(user, cycleId, committeeId);
  }

  @Get("exports/decisions")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async exportDecisions(@Request() req: ExpressRequest, @Path() cycleId: string) {
    const user = await getRecruitmentUser(req, cycleId);
    return exportService.exportDecisions(user, cycleId);
  }

  /** Reviewer coverage. Contains no applicant data, so it is safe to circulate. */
  @Get("exports/reviewer-load")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async exportReviewerLoad(@Request() req: ExpressRequest, @Path() cycleId: string) {
    const user = await getRecruitmentUser(req, cycleId);
    return exportService.exportReviewerLoad(user, cycleId);
  }
}
