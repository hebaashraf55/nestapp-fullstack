/**
 * Removes secrets before anything is logged. Keys that name a secret are replaced whatever their value;
 * strings are scrubbed of connection-string passwords, bearer tokens and JWT-shaped values.
 */
const SECRET_KEY =
  /pass(word)?|secret|token|authorization|cookie|credential|api[-_]?key|otp|nonce|card|cvv|^code$|hash/i;

export function redactText(text: string): string {
  return text
    .replace(/(mongodb(?:\+srv)?|redis(?:s)?|smtps?):\/\/[^\s/@]+@/gi, '$1://<redacted>@')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer <redacted>')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '<jwt>')
    .replace(/(#|[?&](?:token|code)=)[0-9a-f]{32}\b/gi, '$1<redacted>');
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[…]';
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SECRET_KEY.test(k) ? '[REDACTED]' : redact(v, depth + 1),
      ]),
    );
  }
  return value;
}
