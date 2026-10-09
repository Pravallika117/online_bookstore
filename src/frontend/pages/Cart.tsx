import { useState } from "react";
import { Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError, formatINR } from "@/lib/api";
import type { CartView } from "@/lib/types";
import { BookCover } from "@/components/book-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Link, useNavigate } from "@/lib/router";
import { useCart } from "@/context/cart";

export function Cart() {
  const navigate = useNavigate();
  const { cart, loading, setCart } = useCart();
  const [busyId, setBusyId] = useState<number | null>(null);

  const updateQuantity = async (itemId: number, quantity: number) => {
    setBusyId(itemId);
    try {
      const next = await api.patch<CartView>(`/cart/items/${itemId}`, {
        quantity,
      });
      setCart(next);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update cart");
    } finally {
      setBusyId(null);
    }
  };

  const removeItem = async (itemId: number) => {
    setBusyId(itemId);
    try {
      const next = await api.delete<CartView>(`/cart/items/${itemId}`);
      setCart(next);
      toast.success("Removed from cart");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not remove item");
    } finally {
      setBusyId(null);
    }
  };

  if (loading && !cart) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 text-center text-muted-foreground">
        Loading your cart…
      </div>
    );
  }

  const items = cart?.items ?? [];
  const empty = items.length === 0;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-semibold tracking-tight">
        <ShoppingBag className="size-6" />
        Your cart
      </h1>

      {empty ? (
        <div className="rounded-lg border border-dashed py-16 text-center">
          <p className="text-muted-foreground">Your cart is empty.</p>
          <Button className="mt-6" onClick={() => navigate("/catalogue")}>
            Browse books
          </Button>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-[1fr_300px]">
          <div className="flex flex-col gap-4">
            {items.map((item) => (
              <Card key={item.id}>
                <CardContent className="flex gap-4">
                  <Link
                    to={`/book/${item.book_id}`}
                    className="h-28 w-20 shrink-0 overflow-hidden rounded-md border bg-muted"
                  >
                    <BookCover
                      src={item.cover_url}
                      alt={item.title}
                      className="h-full w-full object-cover"
                    />
                  </Link>
                  <div className="flex flex-1 flex-col gap-1">
                    <Link
                      to={`/book/${item.book_id}`}
                      className="font-medium leading-snug hover:underline"
                    >
                      {item.title}
                    </Link>
                    <p className="text-sm text-muted-foreground">{item.author}</p>
                    <p className="text-sm">{formatINR(item.unit_price_cents)} each</p>

                    <div className="mt-auto flex items-center justify-between">
                      <div className="flex items-center rounded-md border">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="rounded-r-none"
                          aria-label="Decrease quantity"
                          disabled={busyId === item.id}
                          onClick={() =>
                            updateQuantity(item.id, item.quantity - 1)
                          }
                        >
                          <Minus className="size-3.5" />
                        </Button>
                        <span className="w-9 text-center text-sm font-medium">
                          {item.quantity}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="rounded-l-none"
                          aria-label="Increase quantity"
                          disabled={
                            busyId === item.id || item.quantity >= item.stock
                          }
                          onClick={() =>
                            updateQuantity(item.id, item.quantity + 1)
                          }
                        >
                          <Plus className="size-3.5" />
                        </Button>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="font-semibold">
                          {formatINR(item.line_total_cents)}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Remove item"
                          disabled={busyId === item.id}
                          onClick={() => removeItem(item.id)}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div>
            <Card className="sticky top-20">
              <CardContent className="flex flex-col gap-4">
                <h2 className="font-semibold">Order summary</h2>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    Subtotal ({cart?.item_count ?? 0} item
                    {(cart?.item_count ?? 0) === 1 ? "" : "s"})
                  </span>
                  <span className="font-medium">
                    {formatINR(cart?.subtotal_cents ?? 0)}
                  </span>
                </div>
                <Separator />
                <Button
                  className="w-full"
                  disabled={empty}
                  onClick={() => navigate("/checkout")}
                >
                  Proceed to checkout
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
