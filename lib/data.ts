export type Subscription = {
  id: string;
  service: string;
  amount: number;
  frequency: "monthly" | "yearly";
  brandColor: string;
  /** css color for the small accent stripe; keep visible on dark bg */
  accentText?: string;
  /** human note shown under cost */
  note?: string;
};

export const SUBSCRIPTIONS: Subscription[] = [
  {
    id: "netflix",
    service: "Netflix",
    amount: 24.99,
    frequency: "monthly",
    brandColor: "#E50914",
    note: "Standard with ads · 2 screens",
  },
  {
    id: "spotify",
    service: "Spotify",
    amount: 11.99,
    frequency: "monthly",
    brandColor: "#1DB954",
    note: "Premium individual",
  },
  {
    id: "disney",
    service: "Disney+",
    amount: 14.99,
    frequency: "monthly",
    brandColor: "#113CCF",
    accentText: "#5b8cff",
    note: "Premium · 4K",
  },
  {
    id: "notion",
    service: "Notion",
    amount: 10.0,
    frequency: "monthly",
    brandColor: "#FFFFFF",
    accentText: "#ededed",
    note: "Plus · 1 member",
  },
  {
    id: "goodlife",
    service: "GoodLife Fitness",
    amount: 54.99,
    frequency: "monthly",
    brandColor: "#ED1C24",
    note: "All-club · monthly",
  },
];

/** annual at-stake total computed once */
export const YEARLY_AT_STAKE = SUBSCRIPTIONS.reduce(
  (sum, s) => sum + s.amount * (s.frequency === "monthly" ? 12 : 1),
  0,
);

/** the Crave bid that replaces Netflix on accept */
export const CRAVE_REPLACEMENT = {
  id: "crave",
  service: "Crave",
  amount: 0,
  frequency: "monthly" as const,
  brandColor: "#1D2C56",
  accentText: "#7da3ff",
  note: "3 months free · then $19.99",
};

export type Bid = {
  id: string;
  brand: string;
  brandColor: string;
  headline: string;
  bullets: string[];
  cashback?: string;
  winner?: boolean;
};

export const NETFLIX_BIDS: Bid[] = [
  {
    id: "crave",
    brand: "Crave",
    brandColor: "#1D2C56",
    headline: "$0 for 3 months",
    bullets: [
      "HBO, Max Originals, Crave Originals",
      "Then $19.99/mo (save $5/mo vs Netflix)",
      "Cancel anytime — card dies on click",
    ],
    cashback: "+$30 Tangerine cashback",
    winner: true,
  },
  {
    id: "tubi",
    brand: "Tubi",
    brandColor: "#FA382F",
    headline: "Free, with ads",
    bullets: [
      "40,000+ movies & shows",
      "No subscription, ever",
      "Tangerine pays you $5/mo to watch",
    ],
    cashback: "+$5/mo cashback",
  },
  {
    id: "appletv",
    brand: "Apple TV+",
    brandColor: "#ffffff",
    headline: "6 months free",
    bullets: [
      "Ted Lasso, Severance, Slow Horses",
      "Then $12.99/mo",
      "Family Sharing included",
    ],
  },
];
