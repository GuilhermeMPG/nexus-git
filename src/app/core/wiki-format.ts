/** Shared wiki serialization utilities — extracted so they can be unit-tested in isolation. */

export function encodeBlock(data: unknown): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(data))));
}

export function decodeBlock(b64: string): unknown {
  return JSON.parse(decodeURIComponent(escape(atob(b64))));
}

export function extractBlock<T>(content: string, markerV2: string, markerV1: string): T | null {
  const m2 = content.match(new RegExp(`<!-- ${markerV2} ([A-Za-z0-9+/=]+) -->`));
  if (m2) {
    try { return decodeBlock(m2[1]) as T; } catch { /* fall through */ }
  }
  // Backward compat: try v1 raw JSON
  const m1 = content.match(new RegExp(`<!-- ${markerV1} (.*?) -->`));
  if (m1) {
    try { return JSON.parse(m1[1]) as T; } catch { /* fall through */ }
  }
  return null;
}

export function escapeCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}
