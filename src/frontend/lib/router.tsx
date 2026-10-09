import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// A tiny hash-based client router. Hash routing keeps deep links working under
// Bun's SPA catch-all without any server-side route table, and avoids a
// Node/Vite dependency. Routes look like `#/book/3`.

interface RouterContextValue {
  path: string;
  navigate: (to: string) => void;
}

const RouterContext = createContext<RouterContextValue | null>(null);

function currentPath(): string {
  const hash = window.location.hash.replace(/^#/, "");
  return hash || "/";
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState<string>(currentPath());

  useEffect(() => {
    const onHashChange = () => setPath(currentPath());
    window.addEventListener("hashchange", onHashChange);
    // Ensure there is always a hash so refreshes land on a known route.
    if (!window.location.hash) window.location.hash = "#/";
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const value = useMemo<RouterContextValue>(
    () => ({
      path,
      navigate: (to: string) => {
        const target = to.startsWith("#") ? to : `#${to}`;
        if (window.location.hash === target) {
          // Same route — force a re-render by syncing state.
          setPath(currentPath());
        } else {
          window.location.hash = target;
        }
        window.scrollTo({ top: 0 });
      },
    }),
    [path],
  );

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterContextValue {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error("useRouter must be used within a RouterProvider");
  return ctx;
}

/** Convenience hook returning just the navigate function. */
export function useNavigate() {
  return useRouter().navigate;
}

// --- Route matching ----------------------------------------------------------

export interface RouteMatch {
  name: string;
  params: Record<string, string>;
}

interface RoutePattern {
  name: string;
  segments: string[];
}

const ROUTES: RoutePattern[] = [
  { name: "home", segments: [""] },
  { name: "catalogue", segments: ["catalogue"] },
  { name: "book", segments: ["book", ":id"] },
  { name: "cart", segments: ["cart"] },
  { name: "checkout", segments: ["checkout"] },
  { name: "confirmation", segments: ["confirmation", ":id"] },
  { name: "orders", segments: ["orders"] },
  { name: "login", segments: ["login"] },
  { name: "register", segments: ["register"] },
];

/** Resolve a pathname (and optional ?query) into a route match. */
export function matchRoute(path: string): RouteMatch {
  const [pathname] = path.split("?");
  const parts = pathname.replace(/^\/+/, "").replace(/\/+$/, "").split("/");
  const normalized = parts.length === 1 && parts[0] === "" ? [""] : parts;

  for (const route of ROUTES) {
    if (route.segments.length !== normalized.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < route.segments.length; i++) {
      const seg = route.segments[i]!;
      const value = normalized[i]!;
      if (seg.startsWith(":")) {
        params[seg.slice(1)] = decodeURIComponent(value);
      } else if (seg !== value) {
        ok = false;
        break;
      }
    }
    if (ok) return { name: route.name, params };
  }
  return { name: "home", params: {} };
}

/** Parse the query string portion of the current hash into a map. */
export function useQueryParams(): URLSearchParams {
  const { path } = useRouter();
  return useMemo(() => {
    const idx = path.indexOf("?");
    return new URLSearchParams(idx >= 0 ? path.slice(idx + 1) : "");
  }, [path]);
}

/** An anchor that navigates via the hash router. */
export function Link({
  to,
  children,
  className,
  onClick,
}: {
  to: string;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  const navigate = useNavigate();
  return (
    <a
      href={`#${to}`}
      className={className}
      onClick={(e) => {
        e.preventDefault();
        onClick?.();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
