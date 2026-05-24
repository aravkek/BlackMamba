/**
 * Process-local store of every Stripe Issuing card BlackMamba has minted.
 *
 * Same shape as `savings-state.ts`: in-memory only, resets on server restart.
 * That's fine for the demo — each card-issuance request appends a row, and
 * the dashboard `/api/wallet` GET reads the full list.
 *
 * A real product would persist this to a per-user table.
 */

export type WalletCard = {
  cardId: string;
  merchant: string;
  last4: string;
  brand: string;
  expMonth: number;
  expYear: number;
  monthlyCapCents: number;
  issuedAt: string; // ISO timestamp
  status: "active" | "revoked";
  mock: boolean;
};

const _cards: WalletCard[] = [];

export function addWalletCard(
  card: Omit<WalletCard, "issuedAt" | "status">,
): WalletCard {
  // Replace earlier card for same merchant (re-issue) so the wallet never
  // shows stale duplicates.
  const idx = _cards.findIndex(
    (c) => c.merchant.toLowerCase() === card.merchant.toLowerCase(),
  );
  const row: WalletCard = {
    ...card,
    issuedAt: new Date().toISOString(),
    status: "active",
  };
  if (idx >= 0) {
    _cards[idx] = row;
  } else {
    _cards.push(row);
  }
  return row;
}

export function listWalletCards(): WalletCard[] {
  // Newest first so the most recent demo issuance sits at the top.
  return [..._cards].sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
}

export function revokeWalletCard(cardId: string): boolean {
  const row = _cards.find((c) => c.cardId === cardId);
  if (!row) return false;
  row.status = "revoked";
  return true;
}

export function resetWallet(): void {
  _cards.length = 0;
}
