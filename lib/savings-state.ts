// Process-local cumulative savings tracker.
// Hackathon-grade: lives in memory, resets on server restart. That's fine for
// a 3-minute demo and avoids dragging in a DB.

let _annual = 0;

export function addAnnualSavings(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return _annual;
  _annual += amount;
  return _annual;
}

export function getAnnualSavings(): number {
  return _annual;
}

export function resetAnnualSavings(): void {
  _annual = 0;
}
