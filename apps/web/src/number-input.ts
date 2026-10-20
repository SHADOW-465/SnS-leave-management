/** "012" -> "12", "-007" -> "-7", "0.5" and "0" are left alone. */
export function stripLeadingZeros(value: string): string {
  return value.replace(/^(-?)0+(?=\d)/, '$1');
}

/**
 * Controlled number inputs that fall back to 0 when cleared turn "typing 12 over a 0" into
 * "012". One capture-phase listener tidies every number input before React reads it, so no
 * page needs its own fix.
 */
export function installNumberInputFix(doc: Document = document): void {
  doc.addEventListener(
    'input',
    (e) => {
      const el = e.target;
      if (!(el instanceof HTMLInputElement) || el.type !== 'number') return;
      const clean = stripLeadingZeros(el.value);
      if (clean !== el.value) el.value = clean;
    },
    true,
  );
}
