import type { SQL } from "bun";

/**
 * A real, popular book for the storefront catalogue.
 *
 * price_cents is INR expressed in integer paise (₹1 = 100 paise), so a book
 * priced at ₹499 is stored as 49900. cover_url is a stable, public hotlink to
 * the real cover art hosted by the Open Library Covers API, addressed by the
 * book's ISBN (…/b/isbn/<isbn>-L.jpg), which is CDN-backed and permanent.
 */
interface SeedBook {
  title: string;
  author: string;
  publisher: string;
  description: string;
  price_cents: number;
  category: string;
  cover_url: string;
  stock: number;
  rating: number;
  delivery_lead_days: number;
}

const COVER = (isbn: string) =>
  `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`;

const SEED_BOOKS: SeedBook[] = [
  // --- Fiction ---
  {
    title: "To Kill a Mockingbird",
    author: "Harper Lee",
    publisher: "Harper Perennial",
    description:
      "A young girl confronts prejudice and injustice in the American South through the eyes of her lawyer father.",
    price_cents: 39900,
    category: "Fiction",
    cover_url: COVER("9780061120084"),
    stock: 42,
    rating: 4.8,
    delivery_lead_days: 4,
  },
  {
    title: "The Great Gatsby",
    author: "F. Scott Fitzgerald",
    publisher: "Scribner",
    description:
      "Jay Gatsby's obsessive pursuit of a lost love exposes the glittering emptiness of the Jazz Age.",
    price_cents: 29900,
    category: "Fiction",
    cover_url: COVER("9780743273565"),
    stock: 7,
    rating: 4.5,
    delivery_lead_days: 5,
  },
  {
    title: "1984",
    author: "George Orwell",
    publisher: "Penguin",
    description:
      "In a totalitarian future ruled by Big Brother, one man dares to think for himself.",
    price_cents: 34900,
    category: "Fiction",
    cover_url: COVER("9780451524935"),
    stock: 30,
    rating: 4.7,
    delivery_lead_days: 3,
  },
  {
    title: "The Catcher in the Rye",
    author: "J. D. Salinger",
    publisher: "Little, Brown and Company",
    description:
      "Holden Caulfield wanders New York City over a few disillusioned days after being expelled from school.",
    price_cents: 32500,
    category: "Fiction",
    cover_url: COVER("9780316769488"),
    stock: 18,
    rating: 4.2,
    delivery_lead_days: 5,
  },

  // --- Fantasy ---
  {
    title: "The Hobbit",
    author: "J. R. R. Tolkien",
    publisher: "HarperCollins",
    description:
      "Bilbo Baggins is swept into an epic quest to reclaim a treasure guarded by the dragon Smaug.",
    price_cents: 49900,
    category: "Fantasy",
    cover_url: COVER("9780547928227"),
    stock: 25,
    rating: 4.9,
    delivery_lead_days: 4,
  },
  {
    title: "Harry Potter and the Philosopher's Stone",
    author: "J. K. Rowling",
    publisher: "Bloomsbury",
    description:
      "An orphaned boy discovers he is a wizard and begins his first year at Hogwarts School of Witchcraft and Wizardry.",
    price_cents: 59900,
    category: "Fantasy",
    cover_url: COVER("9780747532699"),
    stock: 60,
    rating: 4.9,
    delivery_lead_days: 3,
  },
  {
    title: "A Game of Thrones",
    author: "George R. R. Martin",
    publisher: "Bantam",
    description:
      "Noble houses wage a ruthless struggle for the Iron Throne as an ancient winter stirs beyond the Wall.",
    price_cents: 69900,
    category: "Fantasy",
    cover_url: COVER("9780553593716"),
    stock: 9,
    rating: 4.7,
    delivery_lead_days: 6,
  },
  {
    title: "The Name of the Wind",
    author: "Patrick Rothfuss",
    publisher: "DAW Books",
    description:
      "A gifted young man recounts his rise from orphan to legendary arcanist in his own words.",
    price_cents: 64900,
    category: "Fantasy",
    cover_url: COVER("9780756404741"),
    stock: 14,
    rating: 4.6,
    delivery_lead_days: 5,
  },

  // --- Science Fiction ---
  {
    title: "Dune",
    author: "Frank Herbert",
    publisher: "Ace Books",
    description:
      "On the desert planet Arrakis, young Paul Atreides becomes the fulcrum of a galactic power struggle over the spice.",
    price_cents: 79900,
    category: "Science Fiction",
    cover_url: COVER("9780441013593"),
    stock: 22,
    rating: 4.7,
    delivery_lead_days: 4,
  },
  {
    title: "The Martian",
    author: "Andy Weir",
    publisher: "Crown Publishing",
    description:
      "Stranded alone on Mars, an astronaut must science his way to survival until rescue can reach him.",
    price_cents: 54900,
    category: "Science Fiction",
    cover_url: COVER("9780553418026"),
    stock: 31,
    rating: 4.6,
    delivery_lead_days: 5,
  },
  {
    title: "Fahrenheit 451",
    author: "Ray Bradbury",
    publisher: "Simon & Schuster",
    description:
      "In a future where books are outlawed and burned, a fireman begins to question everything he has been told.",
    price_cents: 36900,
    category: "Science Fiction",
    cover_url: COVER("9781451673319"),
    stock: 6,
    rating: 4.4,
    delivery_lead_days: 6,
  },

  // --- Mystery / Thriller ---
  {
    title: "The Girl with the Dragon Tattoo",
    author: "Stieg Larsson",
    publisher: "Vintage",
    description:
      "A disgraced journalist and a brilliant hacker investigate a decades-old disappearance in a powerful family.",
    price_cents: 52500,
    category: "Mystery/Thriller",
    cover_url: COVER("9780307454546"),
    stock: 17,
    rating: 4.3,
    delivery_lead_days: 5,
  },
  {
    title: "Gone Girl",
    author: "Gillian Flynn",
    publisher: "Crown Publishing",
    description:
      "When a woman vanishes on her wedding anniversary, every clue points to her husband in a twisting psychological thriller.",
    price_cents: 48900,
    category: "Mystery/Thriller",
    cover_url: COVER("9780307588371"),
    stock: 11,
    rating: 4.2,
    delivery_lead_days: 4,
  },
  {
    title: "The Da Vinci Code",
    author: "Dan Brown",
    publisher: "Doubleday",
    description:
      "A symbologist races through Europe to unravel a religious mystery hidden in the work of Leonardo da Vinci.",
    price_cents: 45900,
    category: "Mystery/Thriller",
    cover_url: COVER("9780307474278"),
    stock: 28,
    rating: 4.0,
    delivery_lead_days: 5,
  },

  // --- Self-Help ---
  {
    title: "Atomic Habits",
    author: "James Clear",
    publisher: "Avery",
    description:
      "A proven framework for building good habits and breaking bad ones, one tiny change at a time.",
    price_cents: 65000,
    category: "Self-Help",
    cover_url: COVER("9780735211292"),
    stock: 55,
    rating: 4.8,
    delivery_lead_days: 3,
  },
  {
    title: "The Power of Now",
    author: "Eckhart Tolle",
    publisher: "New World Library",
    description:
      "A spiritual guide to living in the present moment and freeing yourself from the mind's relentless chatter.",
    price_cents: 42500,
    category: "Self-Help",
    cover_url: COVER("9781577314806"),
    stock: 20,
    rating: 4.5,
    delivery_lead_days: 5,
  },
  {
    title: "The Subtle Art of Not Giving a F*ck",
    author: "Mark Manson",
    publisher: "HarperOne",
    description:
      "A counterintuitive approach to living a good life by choosing what truly deserves your energy.",
    price_cents: 47900,
    category: "Self-Help",
    cover_url: COVER("9780062457714"),
    stock: 8,
    rating: 4.1,
    delivery_lead_days: 4,
  },

  // --- Business ---
  {
    title: "Thinking, Fast and Slow",
    author: "Daniel Kahneman",
    publisher: "Farrar, Straus and Giroux",
    description:
      "A Nobel laureate reveals the two systems that drive the way we think, judge, and decide.",
    price_cents: 72500,
    category: "Business",
    cover_url: COVER("9780374533557"),
    stock: 13,
    rating: 4.6,
    delivery_lead_days: 6,
  },
  {
    title: "Zero to One",
    author: "Peter Thiel",
    publisher: "Crown Business",
    description:
      "Notes on startups and how to build companies that create something genuinely new rather than copying what works.",
    price_cents: 55000,
    category: "Business",
    cover_url: COVER("9780804139298"),
    stock: 16,
    rating: 4.4,
    delivery_lead_days: 5,
  },
  {
    title: "Rich Dad Poor Dad",
    author: "Robert T. Kiyosaki",
    publisher: "Plata Publishing",
    description:
      "A personal finance classic contrasting two fathers' very different lessons about money and investing.",
    price_cents: 38500,
    category: "Business",
    cover_url: COVER("9781612680194"),
    stock: 40,
    rating: 4.3,
    delivery_lead_days: 4,
  },

  // --- History ---
  {
    title: "Sapiens: A Brief History of Humankind",
    author: "Yuval Noah Harari",
    publisher: "Harper",
    description:
      "A sweeping account of how Homo sapiens came to dominate the planet, from the Cognitive Revolution to today.",
    price_cents: 89900,
    category: "History",
    cover_url: COVER("9780062316097"),
    stock: 24,
    rating: 4.7,
    delivery_lead_days: 5,
  },
  {
    title: "Guns, Germs, and Steel",
    author: "Jared Diamond",
    publisher: "W. W. Norton & Company",
    description:
      "An exploration of why some societies conquered others, tracing fate to geography rather than race.",
    price_cents: 76500,
    category: "History",
    cover_url: COVER("9780393354324"),
    stock: 10,
    rating: 4.4,
    delivery_lead_days: 7,
  },
  {
    title: "A People's History of the United States",
    author: "Howard Zinn",
    publisher: "Harper Perennial",
    description:
      "American history retold from the perspective of workers, women, and the marginalized rather than the powerful.",
    price_cents: 68000,
    category: "History",
    cover_url: COVER("9780062397348"),
    stock: 5,
    rating: 4.5,
    delivery_lead_days: 6,
  },
];

/**
 * Insert the sample catalogue only when the books table is empty, so the
 * storefront, category/publisher browse, and recommendations have data on the
 * very first boot. Running this again is a no-op (idempotent) because the
 * COUNT guard short-circuits once rows exist. Users are intentionally NOT
 * seeded — the auth FEAT owns account creation.
 */
export async function seedIfEmpty(db: SQL): Promise<void> {
  const [row] = await db`SELECT COUNT(*)::int AS count FROM books`;
  if (row && Number(row.count) > 0) return;

  // IDENTITY assigns ids; inserts never specify id, so no sequence reset is
  // needed. The whole batch runs in one transaction (ROLLBACK on any error).
  await db.begin(async (tx) => {
    for (const b of SEED_BOOKS) {
      await tx`
        INSERT INTO books
          (title, author, publisher, description, price_cents, category,
           cover_url, stock, rating, delivery_lead_days)
        VALUES
          (${b.title}, ${b.author}, ${b.publisher}, ${b.description},
           ${b.price_cents}, ${b.category}, ${b.cover_url}, ${b.stock},
           ${b.rating}, ${b.delivery_lead_days})
      `;
    }
  });
}
