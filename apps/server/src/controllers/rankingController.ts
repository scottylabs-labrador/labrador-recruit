import type { Request as ExpressRequest } from "express";
import { Controller, Get, Path, Request, Route, Security, SuccessResponse } from "tsoa";

import { BEARER_AUTH, OIDC_AUTH } from "../lib/authentication.ts";
import { getRecruitmentUser } from "../lib/recruitmentContext.ts";
import { aggregateService } from "../services/aggregateService.ts";

@Route("recruitment/cycles/{cycleId}/committees/{committeeId}")
export class RankingController extends Controller {
  /**
   * Per-candidacy aggregates: completion, descriptive statistics, per-criterion
   * averages, and the disagreement verdict with its stated reasons.
   */
  @Get("aggregates")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async listAggregates(
    @Request() req: ExpressRequest,
    @Path() cycleId: string,
    @Path() committeeId: string,
  ) {
    const user = await getRecruitmentUser(req, cycleId);
    return aggregateService.listCommitteeAggregates(user, cycleId, committeeId);
  }

  /** The committee ranking, ordered deterministically with stable ties. */
  @Get("ranking")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async getRanking(
    @Request() req: ExpressRequest,
    @Path() cycleId: string,
    @Path() committeeId: string,
  ) {
    const user = await getRecruitmentUser(req, cycleId);
    return aggregateService.getCommitteeRanking(user, cycleId, committeeId);
  }

  /** Candidacies needing another human review, each with the reason shown. */
  @Get("disagreements")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async getDisagreements(
    @Request() req: ExpressRequest,
    @Path() cycleId: string,
    @Path() committeeId: string,
  ) {
    const user = await getRecruitmentUser(req, cycleId);
    return aggregateService.getDisagreementQueue(user, cycleId, committeeId);
  }
}
