import type { Request as ExpressRequest } from "express";
import { Body, Controller, Get, Path, Post, Request, Route, Security, SuccessResponse } from "tsoa";

import { getAcUserFromRequest } from "../lib/accessControl.ts";
import { BEARER_AUTH, OIDC_AUTH } from "../lib/authentication.ts";
import { AuthenticationError } from "../middlewares/errorHandler.ts";
import type { CommittedFile, DownloadTicket, UploadTicket } from "../services/fileService.ts";
import { fileService } from "../services/fileService.ts";

interface CreateUploadBody {
  /** Display text only. Never joined to a path, never part of the object key. */
  originalFilename: string;
  /**
   * What the browser says the file is.
   *
   * Checked here so an applicant is refused before spending their upload, and
   * **checked again at commit against the actual bytes** — this value came
   * from the browser, so it is a string an attacker sent.
   */
  mimeType: string;
  sizeBytes: number;
}

async function callerId(req: ExpressRequest): Promise<string> {
  const user = await getAcUserFromRequest(req);
  if (user.id === undefined || user.id === null || user.id === "") {
    throw new AuthenticationError();
  }
  return user.id;
}

/**
 * Applicant file uploads.
 *
 * Three steps, and the bytes never pass through this API in production:
 *
 * ```text
 * POST /v1/files            authorizes, returns a presigned PUT
 * PUT  <presigned url>      bytes straight to storage
 * POST /v1/files/:id/commit validates what arrived, marks it usable
 * ```
 *
 * Every route is scoped to the caller's own files, resolved from their
 * session. A file belonging to somebody else is **404, not 403**, identically
 * to one that never existed — a 403 would confirm it exists, which is the one
 * thing an id-guesser must not be able to learn.
 *
 * TODO(#10): staff download is deliberately absent. A reviewer reading an
 * applicant's resume needs a grant and an assignment checked, which belongs to
 * the authorization core.
 */
@Route("files")
export class FilesController extends Controller {
  @Post()
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(201)
  async createUpload(
    @Request() req: ExpressRequest,
    @Body() body: CreateUploadBody,
  ): Promise<UploadTicket> {
    const ticket = await fileService.createUpload(await callerId(req), body);
    this.setStatus(201);
    return ticket;
  }

  @Post("{fileId}/commit")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async commitUpload(
    @Request() req: ExpressRequest,
    @Path() fileId: string,
  ): Promise<CommittedFile> {
    return await fileService.commitUpload(await callerId(req), fileId);
  }

  @Get("{fileId}/download")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async download(@Request() req: ExpressRequest, @Path() fileId: string): Promise<DownloadTicket> {
    return await fileService.presignDownload(await callerId(req), fileId);
  }
}
