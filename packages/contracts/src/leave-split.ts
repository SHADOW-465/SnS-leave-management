/**
 * Leave beyond the balance is loss of pay, never a rejection. This is the one place that
 * splits a request into paid and loss-of-pay days; the server and the browser both call it so
 * the numbers on screen are the numbers that get stored.
 *
 * Everything is in half-day units (1 = half a day). A balance at or below zero covers nothing.
 */
export function splitLeaveDays(input: { availableHalfDays: number; requestedHalfDays: number }): {
  paidHalfDays: number;
  lopHalfDays: number;
} {
  const requested = Math.max(0, input.requestedHalfDays);
  const paidHalfDays = Math.min(requested, Math.max(0, input.availableHalfDays));
  return { paidHalfDays, lopHalfDays: requested - paidHalfDays };
}
