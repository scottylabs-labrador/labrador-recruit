import type { Request as ExpressRequest } from "express";
import { Body, Controller, Get, Path, Post, Request, Route, Security, SuccessResponse } from "tsoa";

import { BEARER_AUTH, OIDC_AUTH } from "../lib/authentication.ts";
import { getRecruitmentUser } from "../lib/recruitmentContext.ts";
import { HttpError } from "../middlewares/errorHandler.ts";
import { importService } from "../services/importService.ts";

export interface CreateImportRequest {
  /** Used to pick the parser and shown in the import history. */
  filename: string;
  /**
   * The file, base64 encoded. A form export of a few hundred rows sits well
   * inside the JSON body limit, which avoids multipart handling entirely.
   */
  contentBase64: string;
}

@Route("recruitment")
export class ImportsController extends Controller {
  @Get("cycles/{cycleId}/imports")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async listImports(@Request() req: ExpressRequest, @Path() cycleId: string) {
    const user = await getRecruitmentUser(req, cycleId);
    return importService.listImports(user, cycleId);
  }

  /**
   * Parses an upload and returns the mapping preview. Nothing is written to the
   * application tables until the admin confirms with a commit.
   */
  @Post("cycles/{cycleId}/imports")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(201)
  async createImport(
    @Request() req: ExpressRequest,
    @Path() cycleId: string,
    @Body() body: CreateImportRequest,
  ) {
    this.setStatus(201);
    const user = await getRecruitmentUser(req, cycleId);
    return importService.createImport(user, cycleId, body.filename, body.contentBase64);
  }

  /**
   * Pulls the cycle's Google Sheet and stages a preview.
   *
   * Never commits, whether a person pressed the button or the schedule did.
   * Applicant records change when a named admin confirms, and not before.
   */
  @Post("cycles/{cycleId}/sync")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(201)
  async syncFromSheet(@Request() req: ExpressRequest, @Path() cycleId: string) {
    this.setStatus(201);
    const user = await getRecruitmentUser(req, cycleId);
    return importService.syncFromSheet(user, cycleId);
  }

  @Get("imports/{importId}/rows")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async listImportRows(@Request() req: ExpressRequest, @Path() importId: string) {
    const cycleId = await importService.getCycleIdForImport(importId);
    if (!cycleId) {
      throw new HttpError(404, "Import not found");
    }
    const user = await getRecruitmentUser(req, cycleId);
    return importService.listImportRows(user, importId);
  }

  /** Commits a previewed import. Idempotent on cycle plus applicant email. */
  @Post("imports/{importId}/commit")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async commitImport(@Request() req: ExpressRequest, @Path() importId: string) {
    const cycleId = await importService.getCycleIdForImport(importId);
    if (!cycleId) {
      throw new HttpError(404, "Import not found");
    }
    const user = await getRecruitmentUser(req, cycleId);
    return importService.commitImport(user, importId);
  }
}
