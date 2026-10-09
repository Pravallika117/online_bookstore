import { useEffect, useState } from "react";
import { PackageSearch, RotateCcw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError, formatINR } from "@/lib/api";
import type { CartView, Order, OrdersResponse, OrderResponse } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useNavigate } from "@/lib/router";
import { useAuth } from "@/context/auth";
import { useCart } from "@/context/cart";

function statusVariant(status: Order["status"]) {
  if (status === "cancelled") return "destructive" as const;
  if (status === "paid") return "secondary" as const;
  return "outline" as const;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function Orders() {
  const navigate = useNavigate();
  const { refresh: refreshUser } = useAuth();
  const { setCart } = useCart();

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get<OrdersResponse>("/orders");
      setOrders(res.orders);
    } catch {
      toast.error("Could not load your orders");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const buyAgain = async (orderId: number) => {
    setBusyId(orderId);
    try {
      const cart = await api.post<CartView>(`/orders/${orderId}/buy-again`);
      setCart(cart);
      toast.success("Items added to your cart");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not add items");
    } finally {
      setBusyId(null);
    }
  };

  const cancel = async (orderId: number) => {
    setBusyId(orderId);
    try {
      const res = await api.post<OrderResponse>(`/orders/${orderId}/cancel`);
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? res.order : o)),
      );
      await refreshUser();
      toast.success("Order cancelled");
    } catch (err) {
      // Server-enforced rejection (e.g. window expired) is shown verbatim.
      toast.error(err instanceof ApiError ? err.message : "Could not cancel order");
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center text-muted-foreground">
        Loading your orders…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-semibold tracking-tight">
        <PackageSearch className="size-6" />
        Your orders
      </h1>

      {orders.length === 0 ? (
        <div className="rounded-lg border border-dashed py-16 text-center">
          <p className="text-muted-foreground">You have no orders yet.</p>
          <Button className="mt-6" onClick={() => navigate("/catalogue")}>
            Start shopping
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {orders.map((order) => (
            <Card key={order.id}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                  <span>Order #{order.id}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs font-normal text-muted-foreground">
                      {formatDate(order.placed_at)}
                    </span>
                    <Badge variant={statusVariant(order.status)}>
                      {order.status}
                    </Badge>
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                <div className="flex flex-col gap-1">
                  {order.items.map((item) => (
                    <div key={item.id} className="flex justify-between gap-2">
                      <span className="line-clamp-1 text-muted-foreground">
                        {item.quantity} × {item.title}
                      </span>
                      <span>
                        {formatINR(item.unit_price_cents * item.quantity)}
                      </span>
                    </div>
                  ))}
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Total paid</span>
                  <span className="font-semibold">
                    {formatINR(order.total_cents)}
                  </span>
                </div>

                <div className="mt-1 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busyId === order.id}
                    onClick={() => buyAgain(order.id)}
                  >
                    <RotateCcw className="size-4" />
                    Buy It Again
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate(`/confirmation/${order.id}`)}
                  >
                    View details
                  </Button>
                  {order.isCancellable ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={busyId === order.id}
                      onClick={() => cancel(order.id)}
                    >
                      <XCircle className="size-4" />
                      Cancel (within 48h)
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
