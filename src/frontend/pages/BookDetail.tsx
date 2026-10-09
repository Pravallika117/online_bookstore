import { useEffect, useState } from "react";
import { ChevronLeft, Minus, Plus, ShoppingCart, Truck } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError, formatINR } from "@/lib/api";
import type { BookDetailResponse, CartView } from "@/lib/types";
import { BookCard, BookCover, Rating } from "@/components/book-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Link, useNavigate } from "@/lib/router";
import { useAuth } from "@/context/auth";
import { useCart } from "@/context/cart";

export function BookDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { setCart } = useCart();

  const [data, setData] = useState<BookDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    setLoading(true);
    setNotFound(false);
    setQuantity(1);
    void (async () => {
      try {
        const res = await api.get<BookDetailResponse>(`/books/${id}`);
        setData(res);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
        else toast.error("Could not load this book");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const addToCart = async () => {
    if (!user) {
      toast.info("Please sign in to add items to your cart");
      navigate("/login");
      return;
    }
    if (!data) return;
    setAdding(true);
    try {
      const cart = await api.post<CartView>("/cart/items", {
        bookId: data.book.id,
        quantity,
      });
      setCart(cart);
      toast.success(`Added "${data.book.title}" to cart`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not add to cart");
    } finally {
      setAdding(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto grid max-w-5xl gap-8 px-4 py-8 md:grid-cols-[320px_1fr]">
        <Skeleton className="aspect-[2/3] w-full rounded-xl" />
        <div className="flex flex-col gap-4">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16 text-center">
        <p className="text-lg font-semibold">Book not found</p>
        <p className="mt-2 text-muted-foreground">
          This title may have been removed.
        </p>
        <Button className="mt-6" onClick={() => navigate("/catalogue")}>
          Back to catalogue
        </Button>
      </div>
    );
  }

  const { book, deliveryDateDisplay, relatedProducts } = data;
  const outOfStock = book.stock <= 0;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <Button variant="ghost" size="sm" onClick={() => navigate("/catalogue")}>
        <ChevronLeft className="size-4" />
        Back to catalogue
      </Button>

      <div className="mt-4 grid gap-8 md:grid-cols-[320px_1fr]">
        <div className="aspect-[2/3] w-full overflow-hidden rounded-xl border bg-muted">
          <BookCover
            src={book.cover_url}
            alt={book.title}
            className="h-full w-full object-cover"
          />
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {book.title}
            </h1>
            <p className="text-muted-foreground">by {book.author}</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {book.category ? <Badge variant="secondary">{book.category}</Badge> : null}
            {book.publisher ? (
              <span className="text-sm text-muted-foreground">
                {book.publisher}
              </span>
            ) : null}
            <Rating value={book.rating} />
          </div>

          <p className="text-3xl font-semibold">{formatINR(book.price_cents)}</p>

          <div className="flex items-center gap-2 text-sm">
            {outOfStock ? (
              <Badge variant="destructive">Out of stock</Badge>
            ) : (
              <Badge variant="outline" className="text-emerald-600">
                In stock ({book.stock})
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
            <Truck className="size-4 text-muted-foreground" />
            Tentative delivery by{" "}
            <span className="font-medium">{deliveryDateDisplay}</span>
          </div>

          {book.description ? (
            <p className="text-sm leading-relaxed text-muted-foreground">
              {book.description}
            </p>
          ) : null}

          <div className="mt-2 flex items-center gap-4">
            <div className="flex items-center rounded-md border">
              <Button
                variant="ghost"
                size="icon"
                className="rounded-r-none"
                aria-label="Decrease quantity"
                disabled={outOfStock || quantity <= 1}
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              >
                <Minus className="size-4" />
              </Button>
              <span className="w-10 text-center text-sm font-medium">
                {quantity}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-l-none"
                aria-label="Increase quantity"
                disabled={outOfStock || quantity >= book.stock}
                onClick={() => setQuantity((q) => Math.min(book.stock, q + 1))}
              >
                <Plus className="size-4" />
              </Button>
            </div>

            <Button onClick={addToCart} disabled={outOfStock || adding}>
              <ShoppingCart className="size-4" />
              {outOfStock ? "Out of stock" : adding ? "Adding…" : "Add to cart"}
            </Button>
          </div>
        </div>
      </div>

      {relatedProducts.length > 0 ? (
        <div className="mt-12">
          <Separator className="mb-6" />
          <h2 className="mb-4 text-lg font-semibold">Related products</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {relatedProducts.map((related) => (
              <BookCard key={related.id} book={related} />
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-10 text-center">
        <Link
          to="/catalogue"
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          Browse more books
        </Link>
      </div>
    </div>
  );
}
