// A small in-memory sliding-window limiter, per key (usually a client IP).
// Resets on restart, same tradeoff as the WebSocket per-IP connection cap in
// server.mjs: no database, so "free again after a server restart" is fine
// for an abuse guard, not a security boundary.
export function makeLimiter(windowMs) {
  const hits = new Map();
  return {
    // Returns true when `key` is still under `limit` for this window, and
    // counts this call towards it. Returns false (and does not count it)
    // once over, so a caller can retry without the rejected attempt itself
    // eating into the window.
    hit(key, limit, now = Date.now()) {
      const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
      if (list.length >= limit) { hits.set(key, list); return false; }
      list.push(now);
      hits.set(key, list);
      return true;
    },
  };
}
