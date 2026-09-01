export const WEB_PORT = 4010;
export const API_PORT = 4011;
export const PG_PORT = 55432;

export const WEB_URL = `http://localhost:${WEB_PORT}`;
export const API_URL = `http://localhost:${API_PORT}`;
export const DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${PG_PORT}/postgres`;

export const BETTER_AUTH_SECRET = "e2e-auth-secret-A7f3kQ9mN2pL8xR4wY6vC1bH5tJ0sU3";
export const ADMIN_GROUP = "e2e-admins";

export const stackEnv = {
  DATABASE_URL,
  SERVER_PORT: String(API_PORT),
  SERVER_URL: API_URL,
  BETTER_AUTH_URL: WEB_URL,
  BETTER_AUTH_SECRET,
  ADMIN_GROUP,
  ALLOWED_ORIGINS_REGEX: `^https?://localhost:${WEB_PORT}$`,
  AUTH_ISSUER: "https://auth.example.com",
  AUTH_CLIENT_ID: "e2e-client",
  AUTH_CLIENT_SECRET: "e2e-secret",
  AUTH_JWKS_URI: "https://auth.example.com/.well-known/jwks.json",
  VITE_SERVER_URL: API_URL,
};
