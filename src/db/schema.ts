import type { SQL } from "bun";

/**
 * Create every table and index the application relies on, using
 * CREATE TABLE IF NOT EXISTS (and CREATE INDEX IF NOT EXISTS) so it is safe to
 * run on every boot. The DDL is issued as one multi-statement script via
 * Bun.sql's `.unsafe(...).simple()` (a static, hardcoded string — no bound
 * parameters are needed for DDL, and no user input is interpolated).
 *
 * Money convention: every *_cents column stores an INTEGER number of paise
 * (1 INR = 100 paise). Nothing is ever stored as a float; the UI divides by
 * 100 and formats with the ₹ symbol.
 *
 * created_at / newest-sort invariant: `created_at` is TEXT defaulting to
 * now()::text (an ISO-8601 string). The `newest` sort orders by
 * `created_at DESC, id DESC`; ISO strings sort lexically in chronological
 * order and `id` is the deterministic tiebreaker, so the pagination test
 * (non-overlapping pages) stays valid.
 *
 * placed_at / cancellable_until are kept as TEXT ISO strings — the exact
 * representation the order logic already inserts (new Date().toISOString())
 * and parses (parseSqlTime) — so the 48h cancel math is unchanged.
 */
export async function initSchema(db: SQL): Promise<void> {
  await db
    .unsafe(
      `
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      email         TEXT    UNIQUE NOT NULL,
      password_hash TEXT    NOT NULL,
      name          TEXT    NOT NULL,
      gift_points   INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT    NOT NULL DEFAULT (now()::text)
    );

    CREATE TABLE IF NOT EXISTS books (
      id                 INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      title              TEXT    NOT NULL,
      author             TEXT    NOT NULL,
      publisher          TEXT,
      description        TEXT,
      price_cents        INTEGER NOT NULL,              -- paise
      category           TEXT,
      cover_url          TEXT,
      stock              INTEGER NOT NULL DEFAULT 0,
      rating             REAL    NOT NULL DEFAULT 0,
      delivery_lead_days INTEGER NOT NULL DEFAULT 5,
      created_at         TEXT    NOT NULL DEFAULT (now()::text)
    );

    CREATE TABLE IF NOT EXISTS addresses (
      id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      label       TEXT,
      recipient   TEXT,
      line1       TEXT,
      line2       TEXT,
      city        TEXT,
      state       TEXT,
      postal_code TEXT,
      country     TEXT,
      is_default  BOOLEAN NOT NULL DEFAULT false
    );

    CREATE TABLE IF NOT EXISTS carts (
      id      INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id INTEGER UNIQUE NOT NULL REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS cart_items (
      id       INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      cart_id  INTEGER NOT NULL REFERENCES carts(id),
      book_id  INTEGER NOT NULL REFERENCES books(id),
      quantity INTEGER NOT NULL,
      UNIQUE(cart_id, book_id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id                INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id           INTEGER NOT NULL REFERENCES users(id),
      address_snapshot  TEXT    NOT NULL,               -- JSON of chosen address
      status            TEXT    NOT NULL CHECK(status IN ('pending','paid','cancelled')),
      payment_method    TEXT    NOT NULL DEFAULT 'MOCK',
      subtotal_cents    INTEGER NOT NULL,
      points_redeemed   INTEGER NOT NULL DEFAULT 0,
      points_earned     INTEGER NOT NULL DEFAULT 0,
      total_cents       INTEGER NOT NULL,
      placed_at         TEXT    NOT NULL DEFAULT (now()::text),
      cancellable_until TEXT    NOT NULL                -- placed_at + 48h, computed at insert
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id               INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      order_id         INTEGER NOT NULL REFERENCES orders(id),
      book_id          INTEGER NOT NULL REFERENCES books(id),
      title            TEXT    NOT NULL,
      author           TEXT    NOT NULL,
      unit_price_cents INTEGER NOT NULL,
      quantity         INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_books_category    ON books(category);
    CREATE INDEX IF NOT EXISTS idx_books_publisher   ON books(publisher);
    CREATE INDEX IF NOT EXISTS idx_addresses_user    ON addresses(user_id);
    CREATE INDEX IF NOT EXISTS idx_orders_user       ON orders(user_id);
    CREATE INDEX IF NOT EXISTS idx_cart_items_cart   ON cart_items(cart_id);
  `,
    )
    .simple();
}
