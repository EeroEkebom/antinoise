/** Key-file extraction: the user saved the key inside an RTF (rich text) —
 * recover the key token itself regardless of formatting noise. Key prefix anchors the match. */

export function extractKey(text: string, prefix: string): string {
  if (prefix) {
    const anchored = new RegExp(`${prefix.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}[A-Za-z0-9._-]+`);
    const m = anchored.exec(text);
    if (m) return m[0].replace(/[.,;)\]]+$/, '');
  }
  // prefix-less: strip RTF control words + braces, then take the longest key-ish run
  const stripped = text.replace(/\\[a-z]+-?[0-9]* ?/gi, '').replace(/[{}\\]/g, ' ');
  const runs = (stripped.match(/[A-Za-z0-9._-]{20,}/g) ?? []).sort((a, b) => b.length - a.length);
  const best = (prefix ? runs.find((r) => r.startsWith(prefix)) : undefined) ?? runs[0];
  if (!best) throw new Error(`key with prefix ${prefix || '(any long token)'} not found in file`);
  return best;
}