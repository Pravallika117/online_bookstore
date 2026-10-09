import { ImageOff, Star } from "lucide-react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatINR } from "@/lib/api";
import { Link } from "@/lib/router";
import type { Book } from "@/lib/types";
import { useState } from "react";

export function Rating({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
      <Star className="size-3.5 fill-amber-400 text-amber-400" />
      {value.toFixed(1)}
    </span>
  );
}

export function BookCover({
  src,
  alt,
  className,
}: {
  src: string | null;
  alt: string;
  className?: string;
}) {
  const [errored, setErrored] = useState(false);
  if (!src || errored) {
    return (
      <div
        className={
          "flex items-center justify-center bg-muted text-muted-foreground " +
          (className ?? "")
        }
      >
        <ImageOff className="size-8" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setErrored(true)}
      className={className}
    />
  );
}

export function BookCard({ book }: { book: Book }) {
  return (
    <Link
      to={`/book/${book.id}`}
      className="group block focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
    >
      <Card className="h-full overflow-hidden pt-0 transition-shadow group-hover:shadow-md">
        <div className="aspect-[2/3] w-full overflow-hidden bg-muted">
          <BookCover
            src={book.cover_url}
            alt={book.title}
            className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]"
          />
        </div>
        <CardContent className="flex flex-col gap-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="line-clamp-2 text-sm font-semibold leading-snug">
              {book.title}
            </h3>
          </div>
          <p className="line-clamp-1 text-xs text-muted-foreground">
            {book.author}
          </p>
          {book.category ? (
            <Badge variant="secondary" className="mt-1 w-fit text-[10px]">
              {book.category}
            </Badge>
          ) : null}
        </CardContent>
        <CardFooter className="mt-auto flex items-center justify-between">
          <span className="text-base font-semibold">
            {formatINR(book.price_cents)}
          </span>
          <Rating value={book.rating} />
        </CardFooter>
      </Card>
    </Link>
  );
}
