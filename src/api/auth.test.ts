import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import type { SQL } from "bun";
import { openDb } from "../db";
import { initSchema } from "../db/schema";
import { authRoutes } from "./auth";

type App = ReturnType<typeof buildApp>;

function buildApp(database: SQL) {
  return new Elysia({ prefix: "/api" }).use(authRoutes(database));
}

/**
 * Auth endpoint tests against PostgreSQL via Bun.sql. The target is
 * TEST_DATABASE_URL when set, otherwise the primary booksonline database. The
 * suite TRUNCATEs every table (RESTART IDENTITY CASCADE) before and after so
 * it is isolated from, and leaves nothing for, the other suites.
 */

const ALL_TABLES =
  "order_items, orders, cart_items, carts, addresses, users, books";

let app: App;
let db: SQL;

beforeAll(async () => {
  db = openDb(process.env.TEST_DATABASE_URL ?? undefined);
  await initSchema(db);
  await db.unsafe(`TRUNCATE ${ALL_TABLES} RESTART IDENTITY CASCADE`);
  app = buildApp(db);
});

afterAll(async () => {
  await db.unsafe(`TRUNCATE ${ALL_TABLES} RESTART IDENTITY CASCADE`);
  await db.end();
});

function post(path: string, body: unknown, token?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return app.handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

function get(path: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return app.handle(new Request(`http://localhost${path}`, { headers }));
}

describe("auth", () => {
  it("registers a user and returns a token without password_hash", async () => {
    const res = await post("/api/auth/register", {
      email: "alice@example.com",
      password: "supersecret",
      name: "Alice",
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as {
      token: string;
      user: Record<string, unknown>;
    };
    expect(typeof data.token).toBe("string");
    expect(data.token.length).toBeGreaterThan(0);
    expect(data.user.email).toBe("alice@example.com");
    expect(data.user.name).toBe("Alice");
    expect(data.user.gift_points).toBe(0);
    expect(data.user).not.toHaveProperty("password_hash");
  });

  it("provisions a cart row for the new user", async () => {
    const [row] = await db`SELECT COUNT(*)::int AS count FROM carts`;
    expect(Number(row?.count)).toBe(1);
  });

  it("rejects a duplicate email with 409", async () => {
    const res = await post("/api/auth/register", {
      email: "alice@example.com",
      password: "anotherpassword",
      name: "Alice Two",
    });
    expect(res.status).toBe(409);
    const data = (await res.json()) as { error: string };
    expect(typeof data.error).toBe("string");
  });

  it("rejects registration with a short password (400)", async () => {
    const res = await post("/api/auth/register", {
      email: "bob@example.com",
      password: "short",
      name: "Bob",
    });
    expect(res.status).toBe(400);
  });

  it("logs in with correct credentials and returns a token", async () => {
    const res = await post("/api/auth/login", {
      email: "alice@example.com",
      password: "supersecret",
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { token: string };
    expect(typeof data.token).toBe("string");
    expect(data.token.length).toBeGreaterThan(0);
  });

  it("rejects login with a wrong password (401)", async () => {
    const res = await post("/api/auth/login", {
      email: "alice@example.com",
      password: "wrongpassword",
    });
    expect(res.status).toBe(401);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe("Invalid credentials");
  });

  it("rejects login for an unknown email (401)", async () => {
    const res = await post("/api/auth/login", {
      email: "nobody@example.com",
      password: "supersecret",
    });
    expect(res.status).toBe(401);
  });

  it("rejects /me without a token (401)", async () => {
    const res = await get("/api/auth/me");
    expect(res.status).toBe(401);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe("Unauthorized");
  });

  it("returns the current user for /me with a valid token", async () => {
    const login = await post("/api/auth/login", {
      email: "alice@example.com",
      password: "supersecret",
    });
    const { token } = (await login.json()) as { token: string };

    const res = await get("/api/auth/me", token);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { user: Record<string, unknown> };
    expect(data.user.email).toBe("alice@example.com");
    expect(data.user).not.toHaveProperty("password_hash");
  });

  it("exposes the gift_points balance via /points", async () => {
    const login = await post("/api/auth/login", {
      email: "alice@example.com",
      password: "supersecret",
    });
    const { token } = (await login.json()) as { token: string };

    const res = await get("/api/auth/points", token);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { gift_points: number };
    expect(data.gift_points).toBe(0);
  });

  it("rejects a tampered/garbage token (401)", async () => {
    const res = await get("/api/auth/me", "not.a.realtoken");
    expect(res.status).toBe(401);
  });

  it("rejects a token with a valid structure but bad signature (401)", async () => {
    const login = await post("/api/auth/login", {
      email: "alice@example.com",
      password: "supersecret",
    });
    const { token } = (await login.json()) as { token: string };
    const parts = token.split(".");
    const tampered = `${parts[0]}.${parts[1]}.deadbeef`;

    const res = await get("/api/auth/me", tampered);
    expect(res.status).toBe(401);
  });
});
