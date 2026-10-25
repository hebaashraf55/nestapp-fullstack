/** URL-safe lowercase ASCII slug. Non-Latin names fall back to "item" and rely on the numeric suffix. */
export function slugify(input: string): string {
  const base = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return base || 'item';
}

/** First free slug: `base`, `base-2`, `base-3`, ... `taken` reports whether a candidate is in use. */
export async function uniqueSlug(
  name: string,
  taken: (slug: string) => Promise<boolean>,
): Promise<string> {
  const base = slugify(name);
  if (!(await taken(base))) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!(await taken(candidate))) return candidate;
  }
  throw new Error('Could not allocate a unique slug');
}
