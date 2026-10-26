/** `heba@example.com` → `h***@e***.com`. Anything that is not a plausible address becomes `***`. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1) return '***';
  const local = Array.from(email.slice(0, at));
  const labels = email.slice(at + 1).split('.');
  const first = Array.from(labels[0] ?? '');
  const domain =
    labels.length > 1
      ? `${first[0] ?? '*'}***.${labels[labels.length - 1]}`
      : `${first[0] ?? '*'}***`;
  return `${local[0]}***@${domain}`;
}

/** `Heba Ashraf` → `Heba A.`; a single name is kept; empty becomes `Customer`. */
export function maskName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return 'Customer';
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  return last ? `${first} ${Array.from(last)[0]}.` : first;
}
