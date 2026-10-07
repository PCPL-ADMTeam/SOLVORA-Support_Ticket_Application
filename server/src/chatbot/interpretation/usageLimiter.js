// Per-user daily cap on AI interpretation calls (cost control), in addition to
// the per-minute chatbot rate limit. In-memory per server process, like the
// existing limiter; use a shared store if you run several instances.
class DailyUsageLimiter {
  constructor({ maxPerDay = 200, now = () => new Date() } = {}) {
    this.maxPerDay = maxPerDay;
    this.now = now;
    this.counts = new Map();
  }

  key(userId) {
    return `${userId}:${this.now().toISOString().slice(0, 10)}`;
  }

  // Returns true and counts the call if the user is under the cap.
  tryConsume(userId) {
    const k = this.key(userId);
    const n = this.counts.get(k) || 0;
    if (n >= this.maxPerDay) return false;
    this.counts.set(k, n + 1);
    // Drop yesterday's entries opportunistically.
    if (this.counts.size > 5000) for (const key of this.counts.keys()) if (!key.endsWith(this.now().toISOString().slice(0, 10))) this.counts.delete(key);
    return true;
  }
}

module.exports = DailyUsageLimiter;
