import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ChevronLeft, ChevronRight, Search, SlidersHorizontal } from "lucide-react";
import { api } from "@/lib/api";
import type {
  BooksResponse,
  CategoriesResponse,
  PublishersResponse,
} from "@/lib/types";
import { BookCard } from "@/components/book-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryParams, useRouter } from "@/lib/router";

const PAGE_SIZE = 12;
const SORTS = [
  { value: "newest", label: "Newest" },
  { value: "price_asc", label: "Price: Low to High" },
  { value: "price_desc", label: "Price: High to Low" },
  { value: "title", label: "Title A–Z" },
] as const;

const ALL = "__all__";

export function Catalogue() {
  const params = useQueryParams();
  const { navigate } = useRouter();

  const [search, setSearch] = useState(params.get("search") ?? "");
  const [category, setCategory] = useState(params.get("category") ?? ALL);
  const [publisher, setPublisher] = useState(params.get("publisher") ?? ALL);
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [sort, setSort] = useState(params.get("sort") ?? "newest");
  const [page, setPage] = useState(Number(params.get("page")) || 1);

  const [data, setData] = useState<BooksResponse | null>(null);
  const [categories, setCategories] = useState<CategoriesResponse["items"]>([]);
  const [publishers, setPublishers] = useState<PublishersResponse["items"]>([]);
  const [loading, setLoading] = useState(true);

  // Sync local state when the URL query changes (e.g. clicking a category link
  // from Home or searching from the nav).
  useEffect(() => {
    setSearch(params.get("search") ?? "");
    setCategory(params.get("category") ?? ALL);
    setPublisher(params.get("publisher") ?? ALL);
    setSort(params.get("sort") ?? "newest");
    setPage(Number(params.get("page")) || 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.toString()]);

  useEffect(() => {
    void (async () => {
      try {
        const [cats, pubs] = await Promise.all([
          api.get<CategoriesResponse>("/categories"),
          api.get<PublishersResponse>("/publishers"),
        ]);
        setCategories(cats.items);
        setPublishers(pubs.items);
      } catch {
        /* non-fatal: filters just won't populate */
      }
    })();
  }, []);

  const query = useMemo(
    () => ({
      search: params.get("search") ?? undefined,
      category: params.get("category") ?? undefined,
      publisher: params.get("publisher") ?? undefined,
      minPrice: params.get("minPrice") ?? undefined,
      maxPrice: params.get("maxPrice") ?? undefined,
      sort: params.get("sort") ?? "newest",
      page: Number(params.get("page")) || 1,
      pageSize: PAGE_SIZE,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params.toString()],
  );

  useEffect(() => {
    setLoading(true);
    void (async () => {
      try {
        const res = await api.get<BooksResponse>("/books", query);
        setData(res);
      } catch {
        setData({ items: [], total: 0, page: 1, pageSize: PAGE_SIZE });
      } finally {
        setLoading(false);
      }
    })();
  }, [query]);

  const applyFilters = (overrides?: { page?: number }) => {
    const q = new URLSearchParams();
    if (search.trim()) q.set("search", search.trim());
    if (category !== ALL) q.set("category", category);
    if (publisher !== ALL) q.set("publisher", publisher);
    if (minPrice) q.set("minPrice", minPrice);
    if (maxPrice) q.set("maxPrice", maxPrice);
    if (sort) q.set("sort", sort);
    const p = overrides?.page ?? 1;
    if (p > 1) q.set("page", String(p));
    const qs = q.toString();
    navigate(qs ? `/catalogue?${qs}` : "/catalogue");
  };

  const onSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    applyFilters();
  };

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = data?.page ?? page;

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 md:grid-cols-[260px_1fr]">
      {/* Filters sidebar */}
      <aside className="flex flex-col gap-5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <SlidersHorizontal className="size-4" />
          Filters
        </div>

        <form onSubmit={onSearchSubmit} className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Title or author"
            className="pl-9"
            aria-label="Search catalogue"
          />
        </form>

        <div className="flex flex-col gap-2">
          <Label>Category</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.category} value={c.category}>
                  {c.category} ({c.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Publisher</Label>
          <Select value={publisher} onValueChange={setPublisher}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All publishers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All publishers</SelectItem>
              {publishers.map((p) => (
                <SelectItem key={p.publisher} value={p.publisher}>
                  {p.publisher} ({p.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Price range (₹)</Label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              inputMode="numeric"
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
              placeholder="Min"
              aria-label="Minimum price in rupees"
            />
            <span className="text-muted-foreground">–</span>
            <Input
              type="number"
              min={0}
              inputMode="numeric"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              placeholder="Max"
              aria-label="Maximum price in rupees"
            />
          </div>
        </div>

        <Button onClick={() => applyFilters()}>Apply filters</Button>
      </aside>

      {/* Results */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {loading ? "Loading…" : `${total} book${total === 1 ? "" : "s"}`}
          </p>
          <div className="flex items-center gap-2">
            <Label className="text-sm">Sort</Label>
            <Select
              value={sort}
              onValueChange={(value) => {
                setSort(value);
                const q = new URLSearchParams(params.toString());
                q.set("sort", value);
                q.delete("page");
                navigate(`/catalogue?${q.toString()}`);
              }}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORTS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[2/3] w-full rounded-xl" />
            ))}
          </div>
        ) : data && data.items.length > 0 ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {data.items.map((book) => (
              <BookCard key={book.id} book={book} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed py-16 text-center text-muted-foreground">
            No books match your filters.
          </div>
        )}

        {totalPages > 1 ? (
          <div className="mt-2 flex items-center justify-center gap-3">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage <= 1}
              onClick={() => applyFilters({ page: currentPage - 1 })}
            >
              <ChevronLeft className="size-4" />
              Prev
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= totalPages}
              onClick={() => applyFilters({ page: currentPage + 1 })}
            >
              Next
              <ChevronRight className="size-4" />
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
