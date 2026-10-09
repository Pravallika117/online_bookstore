import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, CreditCard, MapPin, Plus, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError, formatINR } from "@/lib/api";
import type {
  Address,
  AddressesResponse,
  AddressResponse,
  OrderResponse,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useNavigate } from "@/lib/router";
import { useAuth } from "@/context/auth";
import { useCart } from "@/context/cart";

// Mirror of the server redemption rule (1 point = ₹1 = 100 paise) for a
// client-side preview only; the server recomputes the authoritative total.
const PAISE_PER_POINT = 100;

const EMPTY_FORM = {
  label: "Home",
  recipient: "",
  line1: "",
  line2: "",
  city: "",
  state: "",
  postal_code: "",
  country: "India",
  is_default: false,
};

export function Checkout() {
  const navigate = useNavigate();
  const { user, refresh: refreshUser } = useAuth();
  const { cart, refresh: refreshCart } = useCart();

  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<number | null>(null);
  const [loadingAddresses, setLoadingAddresses] = useState(true);

  const [redeemPoints, setRedeemPoints] = useState(0);
  const [placing, setPlacing] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [savingAddress, setSavingAddress] = useState(false);

  const loadAddresses = async () => {
    setLoadingAddresses(true);
    try {
      const res = await api.get<AddressesResponse>("/addresses");
      setAddresses(res.items);
      const def = res.items.find((a) => a.is_default) ?? res.items[0];
      setSelectedAddressId((prev) => prev ?? def?.id ?? null);
    } catch {
      /* handled by empty state */
    } finally {
      setLoadingAddresses(false);
    }
  };

  useEffect(() => {
    void loadAddresses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const subtotal = cart?.subtotal_cents ?? 0;
  const balance = user?.gift_points ?? 0;
  // Preview redemption clamped to balance and to the subtotal in whole rupees.
  const maxRedeemable = Math.min(balance, Math.floor(subtotal / PAISE_PER_POINT));
  const effectiveRedeem = Math.max(0, Math.min(redeemPoints, maxRedeemable));
  const discount = effectiveRedeem * PAISE_PER_POINT;
  const totalDue = Math.max(0, subtotal - discount);

  const empty = !cart || cart.items.length === 0;

  const saveAddress = async (e: FormEvent) => {
    e.preventDefault();
    setSavingAddress(true);
    try {
      const res = await api.post<AddressResponse>("/addresses", {
        label: form.label.trim(),
        recipient: form.recipient.trim(),
        line1: form.line1.trim(),
        line2: form.line2.trim() || undefined,
        city: form.city.trim(),
        state: form.state.trim(),
        postal_code: form.postal_code.trim(),
        country: form.country.trim(),
        is_default: form.is_default,
      });
      toast.success("Address saved");
      setDialogOpen(false);
      setForm(EMPTY_FORM);
      await loadAddresses();
      setSelectedAddressId(res.address.id);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save address");
    } finally {
      setSavingAddress(false);
    }
  };

  const pay = async () => {
    if (selectedAddressId == null) {
      toast.error("Select a delivery address first");
      return;
    }
    setPlacing(true);
    try {
      const res = await api.post<OrderResponse>("/orders", {
        address_id: selectedAddressId,
        redeem_points: effectiveRedeem,
      });
      // Order placed: cart is cleared and points balance changed server-side.
      await Promise.all([refreshCart(), refreshUser()]);
      navigate(`/confirmation/${res.order.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Payment could not be completed");
    } finally {
      setPlacing(false);
    }
  };

  const cancelPayment = () => {
    // Abort checkout: no order is created, return to the cart.
    toast.info("Payment cancelled");
    navigate("/cart");
  };

  if (empty) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-muted-foreground">Your cart is empty.</p>
        <Button className="mt-6" onClick={() => navigate("/catalogue")}>
          Browse books
        </Button>
      </div>
    );
  }

  const addressReady = selectedAddressId != null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Checkout</h1>

      <div className="grid gap-6 md:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-6">
          {/* Step 1: Address */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <MapPin className="size-4" />
                Delivery address
              </CardTitle>
              <CardDescription>
                Choose where your order should ship.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {loadingAddresses ? (
                <p className="text-sm text-muted-foreground">Loading addresses…</p>
              ) : addresses.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No saved addresses yet. Add one to continue.
                </p>
              ) : (
                addresses.map((addr) => (
                  <label
                    key={addr.id}
                    className={
                      "flex cursor-pointer gap-3 rounded-lg border p-3 text-sm transition-colors " +
                      (selectedAddressId === addr.id
                        ? "border-primary bg-accent/50"
                        : "hover:bg-accent/30")
                    }
                  >
                    <input
                      type="radio"
                      name="address"
                      className="mt-1"
                      checked={selectedAddressId === addr.id}
                      onChange={() => setSelectedAddressId(addr.id)}
                    />
                    <span className="flex flex-col">
                      <span className="font-medium">
                        {addr.label} · {addr.recipient}
                      </span>
                      <span className="text-muted-foreground">
                        {addr.line1}
                        {addr.line2 ? `, ${addr.line2}` : ""}, {addr.city},{" "}
                        {addr.state} {addr.postal_code}, {addr.country}
                      </span>
                    </span>
                  </label>
                ))
              )}

              <Button
                variant="outline"
                className="w-fit"
                onClick={() => setDialogOpen(true)}
              >
                <Plus className="size-4" />
                Add new address
              </Button>
            </CardContent>
          </Card>

          {/* Step 2: Gift points */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="size-4" />
                Gift points
              </CardTitle>
              <CardDescription>
                You have {balance} point{balance === 1 ? "" : "s"} · 1 point = ₹1
                off.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {balance > 0 ? (
                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="redeem">Points to redeem</Label>
                    <Input
                      id="redeem"
                      type="number"
                      min={0}
                      max={maxRedeemable}
                      value={redeemPoints}
                      onChange={(e) =>
                        setRedeemPoints(Math.max(0, Number(e.target.value) || 0))
                      }
                      className="w-32"
                    />
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => setRedeemPoints(maxRedeemable)}
                  >
                    Redeem max ({maxRedeemable})
                  </Button>
                  {effectiveRedeem > 0 ? (
                    <Button variant="ghost" onClick={() => setRedeemPoints(0)}>
                      Clear
                    </Button>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No gift points yet. Earn points on every purchase.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Step 3: Mocked payment card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CreditCard className="size-4" />
                Payment required
              </CardTitle>
              <CardDescription>
                Amount due:{" "}
                <span className="font-semibold text-foreground">
                  {formatINR(totalDue)}
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {!addressReady ? (
                <p className="text-sm text-muted-foreground">
                  Select a delivery address to enable payment.
                </p>
              ) : null}
              <div className="flex flex-wrap gap-3">
                <Button onClick={pay} disabled={!addressReady || placing}>
                  <CheckCircle2 className="size-4" />
                  {placing ? "Processing…" : `Pay ${formatINR(totalDue)}`}
                </Button>
                <Button
                  variant="outline"
                  onClick={cancelPayment}
                  disabled={placing}
                >
                  <X className="size-4" />
                  Cancel Payment
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Order summary */}
        <div>
          <Card className="sticky top-20">
            <CardHeader>
              <CardTitle className="text-base">Order summary</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              {cart?.items.map((item) => (
                <div key={item.id} className="flex justify-between gap-2">
                  <span className="line-clamp-1 text-muted-foreground">
                    {item.quantity} × {item.title}
                  </span>
                  <span>{formatINR(item.line_total_cents)}</span>
                </div>
              ))}
              <Separator />
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatINR(subtotal)}</span>
              </div>
              {discount > 0 ? (
                <div className="flex justify-between text-emerald-600">
                  <span>Points discount ({effectiveRedeem})</span>
                  <span>-{formatINR(discount)}</span>
                </div>
              ) : null}
              <Separator />
              <div className="flex justify-between text-base font-semibold">
                <span>Total</span>
                <span>{formatINR(totalDue)}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Add-address dialog: conditionally mounted via `open` so it never
          intercepts clicks when closed. */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add delivery address</DialogTitle>
            <DialogDescription>
              Saved to your account for future orders.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveAddress} className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Label" value={form.label} onChange={(v) => setForm({ ...form, label: v })} required />
              <Field label="Recipient" value={form.recipient} onChange={(v) => setForm({ ...form, recipient: v })} required />
            </div>
            <Field label="Address line 1" value={form.line1} onChange={(v) => setForm({ ...form, line1: v })} required />
            <Field label="Address line 2" value={form.line2} onChange={(v) => setForm({ ...form, line2: v })} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="City" value={form.city} onChange={(v) => setForm({ ...form, city: v })} required />
              <Field label="State" value={form.state} onChange={(v) => setForm({ ...form, state: v })} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Postal code" value={form.postal_code} onChange={(v) => setForm({ ...form, postal_code: v })} required />
              <Field label="Country" value={form.country} onChange={(v) => setForm({ ...form, country: v })} required />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.is_default}
                onCheckedChange={(c) => setForm({ ...form, is_default: c === true })}
              />
              Set as default address
            </label>
            <DialogFooter className="mt-2">
              <Button type="submit" disabled={savingAddress}>
                {savingAddress ? "Saving…" : "Save address"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Input
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
