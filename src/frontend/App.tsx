import { BookOpen } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";

const LOGO_URL =
  "https://kiro.dev/images/community/events/thumbnails/meetup2.svg";

export function App() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
          <img src={LOGO_URL} alt="BooksOnline" className="h-8 w-8" />
          <span className="text-lg font-semibold tracking-tight">
            BooksOnline
          </span>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 py-24 text-center">
        <BookOpen className="size-10 text-muted-foreground" />
        <h1 className="text-3xl font-semibold tracking-tight">
          Welcome to BooksOnline
        </h1>
        <p className="max-w-prose text-muted-foreground">
          Browse, discover, and purchase your next read. The storefront is on
          its way.
        </p>
      </main>

      <Toaster />
    </div>
  );
}
