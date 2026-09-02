import type { Request as ExpressRequest } from "express";
import { Body, Get, Path, Post, Query, Request, Route, Security, SuccessResponse } from "tsoa";

import { ADMIN_SCOPE, BEARER_AUTH, OIDC_AUTH } from "../lib/authentication.ts";
import { accountService } from "../services/accountService.ts";
import { userService } from "../services/userService.ts";

export interface CreateAccountRequest {
  /** The Andrew ID. Becomes the primary key everything else points at. */
  andrewId: string;
  name: string;
  role?: "user" | "admin";
}

@Route("admin")
export class AdminController {
  @Get("users")
  @Security(OIDC_AUTH, [ADMIN_SCOPE])
  @Security(BEARER_AUTH, [ADMIN_SCOPE])
  @SuccessResponse(200)
  async listUsers(@Query() page?: number, @Query() limit?: number) {
    return userService.listUsers({
      ...(page !== undefined && { page }),
      ...(limit !== undefined && { limit }),
    });
  }

  /**
   * Creates a sign-in account and returns its temporary password once.
   *
   * Registration is closed on the auth instance, so this is the only way an
   * account comes into being: the Andrew ID is granted by an administrator
   * rather than asserted by whoever filled in a form.
   */
  @Post("users")
  @Security(OIDC_AUTH, [ADMIN_SCOPE])
  @Security(BEARER_AUTH, [ADMIN_SCOPE])
  @SuccessResponse(201)
  async createAccount(@Body() body: CreateAccountRequest) {
    return accountService.createAccount(body);
  }

  /** Issues a fresh temporary password for someone who has lost theirs. */
  @Post("users/{andrewId}/reset-password")
  @Security(OIDC_AUTH, [ADMIN_SCOPE])
  @Security(BEARER_AUTH, [ADMIN_SCOPE])
  @SuccessResponse(200)
  async resetPassword(@Request() _req: ExpressRequest, @Path() andrewId: string) {
    return accountService.resetPassword(andrewId);
  }
}
