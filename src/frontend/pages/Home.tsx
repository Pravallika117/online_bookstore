import { useEffect, useState } from "react";
import { ArrowRight, RotateCcw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type {
  BooksResponse,
  CartView,
  CategoriesResponse,
  Order,
  OrdersResponse,
  RecommendationsResponse,
} from "@/lib/types";
import { BookCard } from "@/components/book-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link, useNavigate } from "@/lib/router";
import { useAuth } from "@/context/auth";
import { useCart } from "@/context/cart";

const LOGO_URL =
  "https://kiro.dev/images/community/events/thumbnails/meetup2.svg";

export function Home() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { setCart } = useCart();

  const [recommendations, setRecommendations] = useState<
    RecommendationsResponse | BooksResponse | null
  >(null);
  const [categories, setCategories] = useState<CategoriesResponse["items"]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyOrderId, setBusyOrderId] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    void (async () => {
      try {
        const catsPromise = api.get<CategoriesResponse>("/categories");

        // Recommended: personalized when logged in, popular fallback otherwise.
        const recsPromise = user
          ? api.get<RecommendationsResponse>("/recommendations")
          : api.get<BooksResponse>("/books", { sort: "newest", pageSize: 8 });

        const ordersPromise = user
          ? api.get<OrdersResponse>("/orders").catch(() => ({ orders: [] }))
          : Promise.resolve({ orders: [] as Order[] });

        const [cats, recs, ords] = await Promise.all([
          catsPromise,
          recsPromise,
          ordersPromise,
        ]);
        setCategories(cats.items);
        setRecommendations(recs);
        setOrders(ords.orders.slice(0, 3));
      } catch {
        /* non-fatal */
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  const buyAgain = async (orderId: number) => {
    setBusyOrderId(orderId);
    try {
      const cart = await api.post<CartView>(`/orders/${orderId}/buy-again`);
      setCart(cart);
      toast.success("Items added to your cart");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not add items");
    } finally {
      setBusyOrderId(null);
    }
  };

  const recItems = recommendations?.items ?? [];
  const recIsHistory =
    recommendations && "source" in recommendations
      ? recommendations.source === "history"
      : false;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-12 px-4 py-8">
      {/* Hero */}
      <section className="flex flex-col items-center gap-4 rounded-2xl border bg-muted/30 px-6 py-14 text-center">
        <img src={LOGO_URL} alt="BooksOnline" className="h-14 w-14" />
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Discover your next read
        </h1>
        <p className="max-w-prose text-muted-foreground">
          Browse a curated catalogue of popular books across fiction, fantasy,
          science, business, and more. Priced in ₹, delivered to your door.
        </p>
        <div className="flex gap-3">
          <Button onClick={() => navigate("/catalogue")}>
            Browse catalogue
            <ArrowRight className="size-4" />
          </Button>
          {!user ? (
            <Button variant="outline" onClick={() => navigate("/register")}>
              Create account
            </Button>
          ) : null}
        </div>
      </section>

      {/* Categories */}
      {categories.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Browse by category</h2>
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <Link
                key={c.category}
                to={`/catalogue?category=${encodeURIComponent(c.category)}`}
              >
                <Badge
                  variant="outline"
                  className="cursor-pointer px-3 py-1.5 text-sm hover:bg-accent"
                >
                  {c.category} ({c.count})
                </Badge>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* Buy It Again (logged-in, has orders) */}
      {user && orders.length > 0 ? (
        <section className="flex flex-col gap-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <RotateCcw className="size-5" />
            Buy It Again
          </h2>
          <div className="flex flex-col gap-3">
            {orders.map((order) => (
              <div
                key={order.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
              >
                <div className="text-sm">
                  <p className="font-medium">Order #{order.id}</p>
                  <p className="line-clamp-1 text-muted-foreground">
                    {order.items.map((i) => i.title).join(", ")}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busyOrderId === order.id}
                  onClick={() => buyAgain(order.id)}
                >
                  <RotateCcw className="size-4" />
                  Buy again
                </Button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Recommendations */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Sparkles className="size-5" />
            {user && recIsHistory ? "Recommended for you" : "Popular right now"}
          </h2>
          <Link
            to="/catalogue"
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            View all
          </Link>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[2/3] w-full rounded-xl" />
            ))}
          </div>
        ) : recItems.length > 0 ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {recItems.map((book) => (
              <BookCard key={book.id} book={book} />
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground">No recommendations yet.</p>
        )}
      </section>
    </div>
  );
}
