// Minimal circuit breaker: after `threshold` consecutive provider failures the
// AI path is skipped for `cooldownMs` so a provider outage costs one fast
// failure instead of a timeout on every message. Rules keep working throughout.
class CircuitBreaker {
  constructor({ threshold = 3, cooldownMs = 60000, now = () => Date.now() } = {}) {
    this.threshold = threshold;
    this.cooldownMs = cooldownMs;
    this.now = now;
    this.failures = 0;
    this.openedAt = null;
  }

  get isOpen() {
    if (this.openedAt === null) return false;
    if (this.now() - this.openedAt >= this.cooldownMs) {
      // Half-open: allow one trial request.
      this.openedAt = null;
      this.failures = this.threshold - 1;
      return false;
    }
    return true;
  }

  success() {
    this.failures = 0;
    this.openedAt = null;
  }

  failure() {
    this.failures += 1;
    if (this.failures >= this.threshold) this.openedAt = this.now();
  }

  state() {
    return { open: this.isOpen, failures: this.failures };
  }
}

module.exports = CircuitBreaker;
