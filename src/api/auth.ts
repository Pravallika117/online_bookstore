import { Elysia, t } from "elysia";
import type { SQL } from "bun";
import { db as sharedDb } from "../db";
import {
  authGuard,
  hashPassword,
  signToken,
  toPublicUser,
  verifyPassword,
  type PublicUser,
  type UserRow,
} from "../lib/auth";

/**
 * Authentication routes mounted under /api/auth:
 *   POST /register  create an account (hashed password) -> { token, user }
 *   POST /login     exchange credentials for a JWT       -> { token, user }
 *   GET  /me        current user (protected by authGuard) -> { user }
 *   GET  /points    current user's gift_points balance    -> { gift_points }
 *
 * The password hash is never returned. The `database` argument is injectable
 * so tests can supply a temp DB; it defaults to the shared singleton.
 */
export const authRoutes = (database: SQL = sharedDb) =>
  new Elysia({ prefix: "/auth" })
    // Shape validation failures as a consistent { error } with status 400.
    .onError(({ code, error, set }) => {
      if (code === "VALIDATION") {
        set.status = 400;
        return { error: "Invalid request body" };
      }
      // Let other errors (e.g. UNAUTHORIZED from the guard) propagate.
      return error instanceof Error ? undefined : undefined;
    })
    .post(
      "/register",
      async ({ body, set }) => {
        const email = body.email.trim().toLowerCase();

        const [existing] = await database`SELECT id FROM users WHERE email = ${email}`;
        if (existing) {
          set.status = 409;
          return { error: "Email already registered" };
        }

        const password_hash = await hashPassword(body.password);

        const [inserted] = (await database`
          INSERT INTO users (email, password_hash, name, gift_points)
          VALUES (${email}, ${password_hash}, ${body.name.trim()}, 0)
          RETURNING *
        `) as [UserRow?];

        // RETURNING guarantees a row here; guard defensively for the types.
        if (!inserted) {
          set.status = 500;
          return { error: "Failed to create account" };
        }

        // Provision the user's cart row so later cart operations have a home.
        await database`INSERT INTO carts (user_id) VALUES (${inserted.id})`;

        const user: PublicUser = toPublicUser(inserted);
        set.status = 201;
        return { token: signToken(user.id), user };
      },
      {
        body: t.Object({
          email: t.String({ format: "email", minLength: 3 }),
          password: t.String({ minLength: 8 }),
          name: t.String({ minLength: 1 }),
        }),
      },
    )
    .post(
      "/login",
      async ({ body, set }) => {
        const email = body.email.trim().toLowerCase();

        const [row] = (await database`SELECT * FROM users WHERE email = ${email}`) as [
          UserRow?,
        ];

        if (!row || !(await verifyPassword(body.password, row.password_hash))) {
          set.status = 401;
          return { error: "Invalid credentials" };
        }

        const user: PublicUser = toPublicUser(row);
        return { token: signToken(user.id), user };
      },
      {
        body: t.Object({
          email: t.String({ minLength: 1 }),
          password: t.String({ minLength: 1 }),
        }),
      },
    )
    .use(authGuard(database))
    .get("/me", ({ user }) => ({ user: toPublicUser(user) }))
    .get("/points", ({ user }) => ({ gift_points: user.gift_points }));
