const TRUNCATION_NOTICE = "\n\n[... diff truncated to fit the size budget ...]\n";

export interface TruncateResult {
  text: string;
  truncated: boolean;
}

/**
 * Truncate text to a maximum byte length (UTF-8), appending a notice when cut.
 * Truncation happens at a line boundary where possible for readability.
 */
export function truncateToBytes(text: string, maxBytes: number): TruncateResult {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= maxBytes) {
    return { text, truncated: false };
  }

  const noticeBytes = encoder.encode(TRUNCATION_NOTICE).length;
  const budget = Math.max(0, maxBytes - noticeBytes);

  // Binary search for the largest prefix that fits the byte budget.
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (encoder.encode(text.slice(0, mid)).length <= budget) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  let cut = low;
  const lastNewline = text.lastIndexOf("\n", cut);
  if (lastNewline > budget * 0.5) {
    cut = lastNewline;
  }

  return { text: text.slice(0, cut) + TRUNCATION_NOTICE, truncated: true };
}
