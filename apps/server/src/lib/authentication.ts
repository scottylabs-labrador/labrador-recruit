// https://tsoa-community.github.io/docs/authentication.html#authentication
// https://medium.com/@alexandre.penombre/tsoa-the-library-that-will-supercharge-your-apis-c551c8989081

import { fromNodeHeaders } from "better-auth/node";
import type * as express from "express";
import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";

import { env } from "../env.ts";
import type { HttpError } from "../middlewares/errorHandler.ts";
import {
  AuthenticationError,
  AuthorizationError,
  captureUnexpectedError,
  InternalServerError,
} from "../middlewares/errorHandler.ts";
import { auth } from "./auth.ts";
import { getJwtPayloadFromHeaders } from "./authUtils.ts";

export const OIDC_AUTH = "oidc";
export const BEARER_AUTH = "bearerAuth";
export const ADMIN_SCOPE = "admins";
const SCOPE_TO_GROUP: Record<string, string> = {
  [ADMIN_SCOPE]: env.ADMIN_GROUP,
};

declare module "express" {
  interface Request {
    // Auth errors are stored on the request object across the two verification
    // passes, so the error handler can return the most relevant error.
    authErrors?: HttpError[];

    // Whether the request successfully authenticated.
    // Used in errorHandler to determine if we should show authErrors.
    authenticated?: boolean;
  }
}

export function expressAuthentication(
  request: express.Request,
  securityName: string,
  scopes?: string[],
) {
  // Store all authentication errors in the request object
  // so we can return the most relevant error to the client in errorHandler
  request.authErrors = request.authErrors ?? [];

  return new Promise((resolve, reject) => {
    if (securityName === OIDC_AUTH) {
      return verifyOidc(request).then((jwtPayload) =>
        verifyScope(request, jwtPayload, resolve, reject, scopes),
      );
    }

    if (securityName === BEARER_AUTH) {
      return verifyBearer(request).then((jwtPayload) =>
        verifyScope(request, jwtPayload, resolve, reject, scopes),
      );
    }

    const err = new InternalServerError("Invalid security name");
    request.authErrors?.push(err);
    return reject({});
  });
}

export async function verifyOidc(request: express.Request): Promise<jwt.JwtPayload | null> {
  try {
    // Check if the user is authenticated
    // Reference: https://www.better-auth.com/docs/integrations/express
    const headers = fromNodeHeaders(request.headers);
    const session = await auth.api.getSession({ headers });
    if (session?.user) {
      return await getJwtPayloadFromHeaders(headers);
    } else {
      const err = new AuthenticationError();
      request.authErrors?.push(err);
      return null;
    }
  } catch (error) {
    captureUnexpectedError(error);
    request.authErrors?.push(new AuthenticationError());
    return null;
  }
}

const client = jwksClient({ jwksUri: env.AUTH_JWKS_URI });
export function verifyBearer(request: express.Request): Promise<jwt.JwtPayload | null> {
  return new Promise((resolve) => {
    const token = request.headers.authorization?.split(" ")[1];
    if (!token) {
      const err = new AuthenticationError();
      request.authErrors?.push(err);
      return resolve(null);
    }

    jwt.verify(
      token,
      (header, callback) => {
        client.getSigningKey(header.kid, (err, key) => {
          if (err || !key) {
            const message: string = err
              ? String(err)
              : `No signing key found for kid: ${header.kid}`;
            captureUnexpectedError(message);
            request.authErrors?.push(new AuthenticationError());
            return callback(err ?? new Error(message));
          }
          return callback(null, key.getPublicKey());
        });
      },
      { issuer: env.AUTH_ISSUER, audience: env.AUTH_CLIENT_ID },
      (error, decoded) => {
        // Check if the token is valid
        if (error) {
          captureUnexpectedError(`Authentication error: ${JSON.stringify(error)}`);
          const err = new AuthenticationError();
          request.authErrors?.push(err);
          return resolve(null);
        }

        if (typeof decoded !== "object") {
          captureUnexpectedError(`Invalid decoded JWT payload: ${decoded}`);
          const err = new AuthenticationError();
          request.authErrors?.push(err);
          return resolve(null);
        }

        return resolve(decoded);
      },
    );
  });
}

const verifyScope = (
  request: express.Request,
  decoded: jwt.JwtPayload | null,
  resolve: (value: unknown) => void,
  reject: (value: unknown) => void,
  scopes?: string[],
) => {
  // If decoded is null, just reject.
  // Releveant error information should be stored in `authErrors` already.
  if (!decoded) {
    return reject({});
  }

  if (!hasAnyScope(decoded?.["groups"], scopes)) {
    request.authErrors?.push(
      new AuthorizationError("Insufficient permissions to access this resource."),
    );
    return reject({});
  }

  request.authenticated = true;
  return resolve({});
};

// Verify if the groups contain ANY of the required scopes
const hasAnyScope = (groups?: string[], scopes?: string[]) => {
  // If no scopes are required, return true
  if (!scopes || scopes.length === 0) {
    return true;
  }

  // If no groups are present, return false
  if (!groups || groups.length === 0) {
    return false;
  }

  // Check if any of the groups contain any of the required scopes
  return groups.some((group) =>
    // Default to the scope if it is not in the mapping to a group
    scopes.map((scope) => SCOPE_TO_GROUP[scope] ?? scope).includes(group),
  );
};
