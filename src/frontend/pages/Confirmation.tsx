import { useEffect, useState } from "react";
import { CheckCircle2, MapPin, PackageCheck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError, formatINR } from "@/lib/api";
import type { Order, OrderResponse } from "@/lib/types";
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

// The exact wording required by the spec — do not alter.
const SUCCESS_MESSAGE =
  "The product has been purchased successfully and will be delivered soon";

export function Confirmation({ id }: { id: string }) {
  const navigate = useNavigate();
  const { refresh: refreshUser } = useAuth();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    setLoading(true);
    void (async () => {
      try {
        const res = await api.get<OrderResponse>(`/orders/${id}`);
        setOrder(res.order);
      } catch {
        toast.error("Could not load your order");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const cancel = async () => {
    setCancelling(true);
    try {
      const res = await api.post<OrderResponse>(`/orders/${id}/cancel`);
      setOrder(res.order);
      await refreshUser();
      toast.success("Order cancelled");
    } catch (err) {
      // Surface the server's rejection (e.g. window expired) verbatim.
      toast.error(err instanceof ApiError ? err.message : "Could not cancel order");
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center text-muted-foreground">
        Loading your order…
      </div>
    );
  }

  if (!order) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-muted-foreground">Order not found.</p>
        <Button className="mt-6" onClick={() => navigate("/orders")}>
          View your orders
        </Button>
      </div>
    );
  }

  const cancelled = order.status === "cancelled";
  const addr = order.address;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="flex flex-col items-center gap-3 text-center">
        {cancelled ? (
          <XCircle className="size-14 text-destructive" />
        ) : (
          <PackageCheck className="size-14 text-emerald-600" />
        )}
        <h1 className="text-2xl font-semibold tracking-tight">
          {cancelled ? "Order cancelled" : "Order confirmed"}
        </h1>
        {!cancelled ? (
          <p className="max-w-prose text-muted-foreground">{SUCCESS_MESSAGE}</p>
        ) : (
          <p className="text-muted-foreground">
            This order has been cancelled and any redeemed points were refunded.
          </p>
        )}
      </div>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span>Order #{order.id}</span>
            <Badge variant={cancelled ? "destructive" : "secondary"}>
              {order.status}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <div className="flex flex-col gap-2">
            {order.items.map((item) => (
              <div key={item.id} className="flex justify-between gap-2">
                <span className="text-muted-foreground">
                  {item.quantity} × {item.title}
                </span>
                <span>{formatINR(item.unit_price_cents * item.quantity)}</span>
              </div>
            ))}
          </div>

          <Separator />

          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{formatINR(order.subtotal_cents)}</span>
          </div>
          {order.points_redeemed > 0 ? (
            <div className="flex justify-between text-emerald-600">
              <span>Points redeemed ({order.points_redeemed})</span>
              <span>-{formatINR(order.points_redeemed * 100)}</span>
            </div>
          ) : null}
          <div className="flex justify-between text-base font-semibold">
            <span>Total paid</span>
            <span>{formatINR(order.total_cents)}</span>
          </div>
          {order.points_earned > 0 ? (
            <p className="text-xs text-muted-foreground">
              You earned {order.points_earned} gift point
              {order.points_earned === 1 ? "" : "s"} on this order.
            </p>
          ) : null}

          {addr ? (
            <>
              <Separator />
              <div className="flex items-start gap-2">
                <MapPin className="mt-0.5 size-4 text-muted-foreground" />
                <div className="text-muted-foreground">
                  <p className="font-medium text-foreground">
                    {addr.recipient}
                  </p>
                  <p>
                    {addr.line1}
                    {addr.line2 ? `, ${addr.line2}` : ""}, {addr.city},{" "}
                    {addr.state} {addr.postal_code}, {addr.country}
                  </p>
                </div>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Button variant="outline" onClick={() => navigate("/orders")}>
          View all orders
        </Button>
        <Button variant="ghost" onClick={() => navigate("/catalogue")}>
          Continue shopping
        </Button>
        {order.isCancellable ? (
          <Button variant="destructive" onClick={cancel} disabled={cancelling}>
            <XCircle className="size-4" />
            {cancelling ? "Cancelling…" : "Cancel order (within 48h)"}
          </Button>
        ) : null}
      </div>

      {!cancelled && !order.isCancellable ? (
        <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <CheckCircle2 className="size-3.5" />
          The 48-hour cancellation window has passed for this order.
        </p>
      ) : null}
    </div>
  );
}
