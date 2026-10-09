// Response shapes mirrored from the backend (FEAT-003/004/005 findings). These
// are the contract the UI binds to; keep them in sync with the Elysia routes.

export interface PublicUser {
  id: number;
  email: string;
  name: string;
  gift_points: number;
  created_at: string;
}

export interface AuthResponse {
  token: string;
  user: PublicUser;
}

export interface MeResponse {
  user: PublicUser;
}

export interface Book {
  id: number;
  title: string;
  author: string;
  publisher: string | null;
  description: string | null;
  price_cents: number;
  category: string | null;
  cover_url: string | null;
  stock: number;
  rating: number;
  delivery_lead_days: number;
  created_at: string;
}

export interface BooksResponse {
  items: Book[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CategoryCount {
  category: string;
  count: number;
}

export interface PublisherCount {
  publisher: string;
  count: number;
}

export interface CategoriesResponse {
  items: CategoryCount[];
}

export interface PublishersResponse {
  items: PublisherCount[];
}

export interface BookDetailResponse {
  book: Book;
  deliveryDate: string;
  deliveryDateDisplay: string;
  relatedProducts: Book[];
}

export interface RecommendationsResponse {
  items: Book[];
  source: "history" | "popular";
}

export interface CartItem {
  id: number;
  book_id: number;
  title: string;
  author: string;
  cover_url: string | null;
  unit_price_cents: number;
  quantity: number;
  line_total_cents: number;
  stock: number;
}

export interface CartView {
  items: CartItem[];
  subtotal_cents: number;
  item_count: number;
}

export interface Address {
  id: number;
  user_id: number;
  label: string;
  recipient: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  is_default: 0 | 1;
}

export interface AddressesResponse {
  items: Address[];
}

export interface AddressResponse {
  address: Address;
}

export interface OrderItem {
  id: number;
  order_id: number;
  book_id: number;
  title: string;
  author: string;
  unit_price_cents: number;
  quantity: number;
}

export interface AddressSnapshot {
  label?: string;
  recipient?: string;
  line1?: string;
  line2?: string | null;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
}

export interface Order {
  id: number;
  user_id: number;
  status: "pending" | "paid" | "cancelled";
  payment_method: string;
  subtotal_cents: number;
  points_redeemed: number;
  points_earned: number;
  total_cents: number;
  placed_at: string;
  cancellable_until: string;
  address: AddressSnapshot | null;
  items: OrderItem[];
  isCancellable: boolean;
}

export interface OrderResponse {
  order: Order;
}

export interface OrdersResponse {
  orders: Order[];
}
