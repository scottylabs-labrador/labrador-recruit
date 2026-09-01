import * as Sentry from "@sentry/bun";
import type { NextFunction, Request, Response } from "express";
import { ValidateError } from "tsoa";

import { env } from "../env";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message?: string) {
    super(message);
    this.status = status;
    this.name = "HttpError";
  }
}

export class AuthenticationError extends HttpError {
  constructor() {
    super(401);
    this.name = "Unauthenticated";
  }
}

export class AuthorizationError extends HttpError {
  constructor(message: string) {
    super(403, message);
    this.name = "Forbidden";
  }
}

export class InternalServerError extends HttpError {
  constructor(message: string) {
    super(500, message);
    this.name = "InternalServerError";
  }
}

// From https://tsoa-community.github.io/docs/error-handling.html
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  // The authentication errors takes the highest priority
  //
  // Since we authenticated with both OIDC and Bearer, even if the request was
  // authenticated successfully in one of the methods, there will still be auth
  // errors in the authErrors array due to the other method. Therefore, we only
  // want to return the auth errors if the request was not authenticated.
  const firstAuthError = req.authErrors?.[0];
  if (!req.authenticated && req.authErrors && firstAuthError) {
    // the most relevant error is the one with the highest status code
    // 500 (corresponds to Invalid Security Name) > 403 Forbidden > 401 Unauthorized
    const errorToReturn = req.authErrors.reduce((max, currentError) => {
      return currentError.status > max.status ? currentError : max;
    }, firstAuthError);
    return res
      .status(errorToReturn.status)
      .json({ name: errorToReturn.name, message: errorToReturn.message });
  }

  // The validation errors take the second highest priority
  if (err instanceof ValidateError) {
    return res.status(422).json({
      message: `Validation Failed: ${JSON.stringify(err?.fields)}`,
    });
  }

  // The HTTP errors take priority over unknown errors
  if (err instanceof HttpError) {
    return res.status(err.status).json({ name: err.name, message: err.message });
  }

  if (err instanceof Error) {
    captureUnexpectedError(`Unexpected error in ${req.path}: ${err}`);
    return res.status(500).json({ message: `Internal Server Error: ${err.message}` });
  }

  return next();
}

/**
 * For an unexpected error, we either capture the error to Sentry or log it to the console.
 */
export function captureUnexpectedError(err: unknown) {
  if (env.SENTRY_DSN) {
    Sentry.captureException(err);
  } else {
    console.error(`Unexpected error`, err);
  }
}
