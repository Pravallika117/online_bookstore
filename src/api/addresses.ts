import { Elysia, t } from "elysia";
import type { SQL } from "bun";
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

/**
 * The explicit column list for address SELECT/RETURNING. The is_default
 * column is a Postgres BOOLEAN, but the API contract (and the frontend) treat
 * is_default as a numeric 0|1 field, so it is coerced back with (is_default)::int.
 */
const ADDRESS_COLUMNS = `id, user_id, label, recipient, line1, line2, city,
  state, postal_code, country, (is_default)::int AS is_default`;

/** Clear the default flag on all of a user's addresses (used before setting one). */
async function clearDefault(database: SQL, userId: number): Promise<void> {
  await database`UPDATE addresses SET is_default = false WHERE user_id = ${userId}`;
}

export const addressRoutes = (database: SQL = sharedDb) =>
  new Elysia({ prefix: "/addresses" })
    .onError(({ code, set }) => {
      if (code === "VALIDATION") {
        set.status = 400;
        return { error: "Invalid request body" };
      }
    })
    .use(authGuard(database))
    // --- List the user's addresses ----------------------------------------
    .get("/", async ({ userId }) => {
      const items = (await database`
        SELECT ${database.unsafe(ADDRESS_COLUMNS)} FROM addresses
         WHERE user_id = ${userId}
         ORDER BY is_default DESC, id ASC
      `) as AddressRow[];
      return { items };
    })
    // --- Create a new address ---------------------------------------------
    .post(
      "/",
      async ({ userId, body }) => {
        const makeDefault = body.is_default === true;
        if (makeDefault) await clearDefault(database, userId);

        const [created] = (await database`
          INSERT INTO addresses
            (user_id, label, recipient, line1, line2, city, state, postal_code, country, is_default)
          VALUES (${userId}, ${body.label}, ${body.recipient}, ${body.line1},
                  ${body.line2 ?? null}, ${body.city}, ${body.state},
                  ${body.postal_code}, ${body.country}, ${makeDefault})
          RETURNING ${database.unsafe(ADDRESS_COLUMNS)}
        `) as [AddressRow?];

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
      async ({ userId, params, body, set }) => {
        const [existing] = (await database`
          SELECT ${database.unsafe(ADDRESS_COLUMNS)} FROM addresses
           WHERE id = ${params.id} AND user_id = ${userId}
        `) as [AddressRow?];
        if (!existing) {
          set.status = 404;
          return { error: "Address not found" };
        }

        if (body.is_default === true) await clearDefault(database, userId);

        const next = {
          label: body.label ?? existing.label,
          recipient: body.recipient ?? existing.recipient,
          line1: body.line1 ?? existing.line1,
          line2: body.line2 !== undefined ? body.line2 : existing.line2,
          city: body.city ?? existing.city,
          state: body.state ?? existing.state,
          postal_code: body.postal_code ?? existing.postal_code,
          country: body.country ?? existing.country,
          // existing.is_default is the numeric 0|1 contract value; bind a JS
          // boolean to the BOOLEAN column.
          is_default:
            body.is_default !== undefined
              ? body.is_default
              : existing.is_default === 1,
        };

        const [updated] = (await database`
          UPDATE addresses
             SET label = ${next.label}, recipient = ${next.recipient},
                 line1 = ${next.line1}, line2 = ${next.line2},
                 city = ${next.city}, state = ${next.state},
                 postal_code = ${next.postal_code}, country = ${next.country},
                 is_default = ${next.is_default}
           WHERE id = ${existing.id}
           RETURNING ${database.unsafe(ADDRESS_COLUMNS)}
        `) as [AddressRow?];

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
      async ({ userId, params, set }) => {
        const [existing] = (await database`
          SELECT id FROM addresses WHERE id = ${params.id} AND user_id = ${userId}
        `) as [{ id: number }?];
        if (!existing) {
          set.status = 404;
          return { error: "Address not found" };
        }

        await database`DELETE FROM addresses WHERE id = ${existing.id}`;
        return { success: true };
      },
      {
        params: t.Object({ id: t.Numeric() }),
      },
    );
