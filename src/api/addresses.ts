import { Elysia, t } from "elysia";
import type { Database } from "bun:sqlite";
import { db as sharedDb } from "../db";
import { authGuard } from "../lib/auth";

/**
 * Authenticated saved-address routes mounted under /api/addresses. Every
 * route is guarded (FEAT-003) and strictly scoped to the authenticated
 * user_id; an id that belongs to another user resolves to 404, never leaks.
 *
 *   GET    /addresses       list the user's addresses (default first)
 *   POST   /addresses       create one (clears others' default if is_default)
 *   PATCH  /addresses/:id   update an owned address (404 if not owned)
 *   DELETE /addresses/:id   remove an owned address (404 if not owned)
 */

/** The row shape persisted in the addresses table. */
export interface AddressRow {
  id: number;
  user_id: number;
  label: string | null;
  recipient: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  is_default: number;
}

/** Clear the default flag on all of a user's addresses (used before setting one). */
function clearDefault(database: Database, userId: number): void {
  database.run("UPDATE addresses SET is_default = 0 WHERE user_id = ?", [
    userId,
  ]);
}

export const addressRoutes = (database: Database = sharedDb) =>
  new Elysia({ prefix: "/addresses" })
    .onError(({ code, set }) => {
      if (code === "VALIDATION") {
        set.status = 400;
        return { error: "Invalid request body" };
      }
    })
    .use(authGuard(database))
    // --- List the user's addresses ----------------------------------------
    .get("/", ({ userId }) => {
      const items = database
        .query<AddressRow, [number]>(
          `SELECT * FROM addresses
            WHERE user_id = ?
            ORDER BY is_default DESC, id ASC`,
        )
        .all(userId);
      return { items };
    })
    // --- Create a new address ---------------------------------------------
    .post(
      "/",
      ({ userId, body }) => {
        const makeDefault = body.is_default === true;
        if (makeDefault) clearDefault(database, userId);

        const created = database
          .query<
            AddressRow,
            [
              number,
              string,
              string,
              string,
              string | null,
              string,
              string,
              string,
              string,
              number,
            ]
          >(
            `INSERT INTO addresses
               (user_id, label, recipient, line1, line2, city, state, postal_code, country, is_default)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             RETURNING *`,
          )
          .get(
            userId,
            body.label,
            body.recipient,
            body.line1,
            body.line2 ?? null,
            body.city,
            body.state,
            body.postal_code,
            body.country,
            makeDefault ? 1 : 0,
          );

        return { address: created };
      },
      {
        body: t.Object({
          label: t.String({ minLength: 1 }),
          recipient: t.String({ minLength: 1 }),
          line1: t.String({ minLength: 1 }),
          line2: t.Optional(t.String()),
          city: t.String({ minLength: 1 }),
          state: t.String({ minLength: 1 }),
          postal_code: t.String({ minLength: 1 }),
          country: t.String({ minLength: 1 }),
          is_default: t.Optional(t.Boolean()),
        }),
      },
    )
    // --- Update an owned address ------------------------------------------
    .patch(
      "/:id",
      ({ userId, params, body, set }) => {
        const existing = database
          .query<AddressRow, [number, number]>(
            "SELECT * FROM addresses WHERE id = ? AND user_id = ?",
          )
          .get(params.id, userId);
        if (!existing) {
          set.status = 404;
          return { error: "Address not found" };
        }

        if (body.is_default === true) clearDefault(database, userId);

        const next = {
          label: body.label ?? existing.label,
          recipient: body.recipient ?? existing.recipient,
          line1: body.line1 ?? existing.line1,
          line2: body.line2 !== undefined ? body.line2 : existing.line2,
          city: body.city ?? existing.city,
          state: body.state ?? existing.state,
          postal_code: body.postal_code ?? existing.postal_code,
          country: body.country ?? existing.country,
          is_default:
            body.is_default !== undefined
              ? body.is_default
                ? 1
                : 0
              : existing.is_default,
        };

        const updated = database
          .query<
            AddressRow,
            [
              string | null,
              string | null,
              string | null,
              string | null,
              string | null,
              string | null,
              string | null,
              string | null,
              number,
              number,
            ]
          >(
            `UPDATE addresses
                SET label = ?, recipient = ?, line1 = ?, line2 = ?,
                    city = ?, state = ?, postal_code = ?, country = ?,
                    is_default = ?
              WHERE id = ?
              RETURNING *`,
          )
          .get(
            next.label,
            next.recipient,
            next.line1,
            next.line2,
            next.city,
            next.state,
            next.postal_code,
            next.country,
            next.is_default,
            existing.id,
          );

        return { address: updated };
      },
      {
        params: t.Object({ id: t.Numeric() }),
        body: t.Object({
          label: t.Optional(t.String({ minLength: 1 })),
          recipient: t.Optional(t.String({ minLength: 1 })),
          line1: t.Optional(t.String({ minLength: 1 })),
          line2: t.Optional(t.String()),
          city: t.Optional(t.String({ minLength: 1 })),
          state: t.Optional(t.String({ minLength: 1 })),
          postal_code: t.Optional(t.String({ minLength: 1 })),
          country: t.Optional(t.String({ minLength: 1 })),
          is_default: t.Optional(t.Boolean()),
        }),
      },
    )
    // --- Delete an owned address ------------------------------------------
    .delete(
      "/:id",
      ({ userId, params, set }) => {
        const existing = database
          .query<{ id: number }, [number, number]>(
            "SELECT id FROM addresses WHERE id = ? AND user_id = ?",
          )
          .get(params.id, userId);
        if (!existing) {
          set.status = 404;
          return { error: "Address not found" };
        }

        database.run("DELETE FROM addresses WHERE id = ?", [existing.id]);
        return { success: true };
      },
      {
        params: t.Object({ id: t.Numeric() }),
      },
    );
