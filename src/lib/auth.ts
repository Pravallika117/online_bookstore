import { Elysia } from "elysia";
import { db as sharedDb } from "../db";
import type { SQL } from "bun";

/**
 * Backend authentication primitives: password hashing, stateless JWT
 * sign/verify, and a reusable Elysia guard that resolves the authenticated
 * user from a Bearer token. Nothing security-relevant is ever trusted from
 * the client — the guard always re-loads the user from the database.
 */

/**
 * The HMAC secret used to sign JWTs. In production it MUST come from the
 * JWT_SECRET environment variable. The fallback below exists ONLY so the dev
 * server and tests can boot without extra setup; it is intentionally obvious
 * and must never be relied on for a real deployment.
 */
export const DEV_JWT_SECRET = "dev-only-insecure-secret-change-me";

function jwtSecret(): string {
  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return DEV_JWT_SECRET;
}

/** Token lifetime in seconds (7 days). */
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

/** The row shape persisted in the users table. */
export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  name: string;
  gift_points: number;
  created_at: string;
}

/** The user shape safe to return over the API (never includes password_hash). */
export interface PublicUser {
  id: number;
  email: string;
  name: string;
  gift_points: number;
  created_at: string;
}

/** Strip password_hash (and anything else sensitive) before serialising. */
export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    gift_points: row.gift_points,
    created_at: row.created_at,
  };
}

// --- Password hashing (Bun.password, argon2id default) ---------------------

/** Hash a plaintext password with Bun.password (argon2id). */
export function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password);
}

/** Verify a plaintext password against a stored hash. */
export function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return Bun.password.verify(password, hash);
}

// --- Stateless JWT (HS256) --------------------------------------------------

interface JwtHeader {
  alg: "HS256";
  typ: "JWT";
}

interface JwtPayload {
  /** Subject: the user id. */
  sub: number;
  /** Issued-at (seconds since epoch). */
  iat: number;
  /** Expiry (seconds since epoch). */
  exp: number;
}

function base64UrlEncode(input: string | Uint8Array): string {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : input;
  // btoa works on binary strings; build one from the byte array.
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(input: string): Uint8Array {
  const padded = input
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(input.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function sign(data: string): string {
  const hasher = new Bun.CryptoHasher("sha256", jwtSecret());
  hasher.update(data);
  return base64UrlEncode(hasher.digest());
}

/** Constant-time comparison of two signature strings. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Create a stateless HS256 JWT for the given user id (expires in 7 days). */
export function signToken(userId: number): string {
  const header: JwtHeader = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    sub: userId,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = sign(signingInput);
  return `${signingInput}.${signature}`;
}

/**
 * Verify a JWT and return the contained user id, or null when the token is
 * malformed, has a bad signature, or has expired.
 */
export function verifyToken(token: string): { userId: number } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, signature] = parts;
  if (!encodedHeader || !encodedPayload || !signature) return null;

  const expected = sign(`${encodedHeader}.${encodedPayload}`);
  if (!timingSafeEqual(signature, expected)) return null;

  let payload: JwtPayload;
  try {
    payload = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(encodedPayload)),
    ) as JwtPayload;
  } catch {
    return null;
  }

  if (typeof payload.sub !== "number" || typeof payload.exp !== "number") {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) return null;

  return { userId: payload.sub };
}

// --- Reusable Elysia auth guard --------------------------------------------

/** Error thrown by the guard when authentication fails. */
export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

function extractBearer(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match ? match[1]!.trim() : null;
}

/** Load a user row by id from the given database connection. */
export async function findUserById(
  id: number,
  database: SQL,
): Promise<UserRow | null> {
  const [row] = await database`SELECT * FROM users WHERE id = ${id}`;
  return (row as UserRow | undefined) ?? null;
}

/**
 * A reusable Elysia plugin that authenticates the request. It reads the
 * `Authorization: Bearer <jwt>` header, verifies the token, loads the user
 * from the database, and exposes `{ userId, user }` to downstream handlers.
 * On any failure it throws {@link UnauthorizedError}, which is mapped to a
 * 401 `{ error: 'Unauthorized' }` response (see onError below).
 *
 * Usage from a route module:
 *   new Elysia().use(authGuard).get('/me', ({ userId, user }) => ...)
 *
 * The `database` argument is injectable so tests can pass a temp DB; it
 * defaults to the shared singleton connection.
 */
export const authGuard = (database: SQL = sharedDb) =>
  new Elysia({ name: "auth-guard" })
    .error({ UNAUTHORIZED: UnauthorizedError })
    .onError({ as: "scoped" }, ({ code, error, set }) => {
      if (code === "UNAUTHORIZED") {
        set.status = 401;
        return { error: (error as UnauthorizedError).message };
      }
    })
    .resolve({ as: "scoped" }, async ({ headers }) => {
      const token = extractBearer(headers.authorization);
      if (!token) throw new UnauthorizedError();

      const decoded = verifyToken(token);
      if (!decoded) throw new UnauthorizedError();

      const user = await findUserById(decoded.userId, database);
      if (!user) throw new UnauthorizedError();

      return { userId: user.id, user };
    });
