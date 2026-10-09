import { useEffect, type ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { Nav } from "@/components/nav";
import { AuthProvider, useAuth } from "@/context/auth";
import { CartProvider } from "@/context/cart";
import {
  RouterProvider,
  matchRoute,
  useNavigate,
  useRouter,
} from "@/lib/router";
import { Home } from "@/pages/Home";
import { Catalogue } from "@/pages/Catalogue";
import { BookDetail } from "@/pages/BookDetail";
import { Cart } from "@/pages/Cart";
import { Checkout } from "@/pages/Checkout";
import { Confirmation } from "@/pages/Confirmation";
import { Orders } from "@/pages/Orders";
import { Login } from "@/pages/Login";
import { Register } from "@/pages/Register";

// Routes that require an authenticated user. Unauthenticated access redirects
// to /login once the auth state has finished loading.
const PROTECTED = new Set(["cart", "checkout", "confirmation", "orders"]);

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate("/login");
  }, [loading, user, navigate]);

  if (loading) {
    return (
      <div className="px-4 py-24 text-center text-muted-foreground">Loading…</div>
    );
  }
  if (!user) return null;
  return <>{children}</>;
}

function Routes() {
  const { path } = useRouter();
  const { name, params } = matchRoute(path);

  let page: ReactNode;
  switch (name) {
    case "catalogue":
      page = <Catalogue />;
      break;
    case "book":
      page = <BookDetail id={params.id ?? ""} />;
      break;
    case "cart":
      page = (
        <RequireAuth>
          <Cart />
        </RequireAuth>
      );
      break;
    case "checkout":
      page = (
        <RequireAuth>
          <Checkout />
        </RequireAuth>
      );
      break;
    case "confirmation":
      page = (
        <RequireAuth>
          <Confirmation id={params.id ?? ""} />
        </RequireAuth>
      );
      break;
    case "orders":
      page = (
        <RequireAuth>
          <Orders />
        </RequireAuth>
      );
      break;
    case "login":
      page = <Login />;
      break;
    case "register":
      page = <Register />;
      break;
    case "home":
    default:
      page = <Home />;
      break;
  }

  return <main className="flex-1">{page}</main>;
}

export function App() {
  return (
    <RouterProvider>
      <AuthProvider>
        <CartProvider>
          <div className="flex min-h-screen flex-col bg-background text-foreground">
            <Nav />
            <Routes />
            <footer className="border-t py-8 text-center text-sm text-muted-foreground">
              BooksOnline · Prices in INR (₹)
            </footer>
          </div>
          {/* Single app-wide Toaster. Sonner mounts toasts in a portal and
              removes them when dismissed, so nothing lingers over the UI. */}
          <Toaster richColors position="top-center" />
        </CartProvider>
      </AuthProvider>
    </RouterProvider>
  );
}
