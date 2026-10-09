import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/lib/api";
import type { CartView } from "@/lib/types";
import { useAuth } from "@/context/auth";

interface CartContextValue {
  cart: CartView | null;
  itemCount: number;
  loading: boolean;
  /** Re-fetch the authenticated user's cart from the server. */
  refresh: () => Promise<void>;
  /** Replace the cached cart (callers that already hold a fresh CartView). */
  setCart: (cart: CartView) => void;
}

const EMPTY: CartView = { items: [], subtotal_cents: 0, item_count: 0 };

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [cart, setCartState] = useState<CartView | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!token) {
      setCartState(null);
      return;
    }
    setLoading(true);
    try {
      const res = await api.get<CartView>("/cart");
      setCartState(res);
    } catch {
      setCartState(EMPTY);
    } finally {
      setLoading(false);
    }
  }, [token]);

  const setCart = useCallback((next: CartView) => setCartState(next), []);

  // Load/clear the cart whenever auth changes.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<CartContextValue>(
    () => ({
      cart,
      itemCount: cart?.item_count ?? 0,
      loading,
      refresh,
      setCart,
    }),
    [cart, loading, refresh, setCart],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within a CartProvider");
  return ctx;
}
