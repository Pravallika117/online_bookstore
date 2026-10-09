// Typed fetch client for the BooksOnline REST API.
//
// All requests are relative to `/api` (the Elysia app is mounted there by the
// single Bun.serve() process). When a bearer token is present it is attached as
// `Authorization: Bearer <token>`. Responses are parsed as JSON; non-2xx
// responses throw an `ApiError` carrying the server's `{ error }` message and
// the HTTP status so callers can branch (e.g. 401 -> redirect to login, 403 ->
// surface the cancellation-window message).

const BASE_URL = "/api";

/** Error thrown for any non-2xx API response. */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// --- Token storage -----------------------------------------------------------
// The token is persisted in localStorage for convenience ONLY; the server never
// trusts it for authorization (it re-verifies the JWT on every protected call).

const TOKEN_KEY = "booksonline.token";

let inMemoryToken: string | null =
  typeof localStorage !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;

export function getToken(): string | null {
  return inMemoryToken;
}

export function setToken(token: string | null): void {
  inMemoryToken = token;
  if (typeof localStorage === "undefined") return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

// --- Core request helper -----------------------------------------------------

type Query = Record<string, string | number | boolean | undefined | null>;

interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Query;
}

function buildUrl(path: string, query?: Query): string {
  const url = `${BASE_URL}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, query } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (inMemoryToken) headers["Authorization"] = `Bearer ${inMemoryToken}`;

  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Network error. Please check your connection.");
  }

  // 204 / empty body -> resolve as undefined.
  const text = await res.text();
  const data = text ? safeParse(text) : undefined;

  if (!res.ok) {
    const message =
      (data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : undefined) ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, message);
  }

  return data as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>(path, { query }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

// --- Money helper ------------------------------------------------------------

/**
 * Format integer paise as an INR string, e.g. 123400 -> "₹1,234".
 * Money is stored server-side as integer paise (₹1 = 100 paise); the UI divides
 * by 100 and renders with the ₹ symbol consistently across every screen.
 */
export function formatINR(paise: number): string {
  const rupees = Math.round(paise) / 100;
  const hasFraction = Math.round(paise) % 100 !== 0;
  return `₹${rupees.toLocaleString("en-IN", {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}
