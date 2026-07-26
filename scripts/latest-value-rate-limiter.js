/**
 * Deliver the first value for a key immediately, then coalesce values received
 * inside the interval so the newest one is delivered at the trailing edge.
 * This keeps rate limits from leaving consumers stuck with stale state.
 */
export class LatestValueRateLimiter {
    constructor({ intervalMs, deliver, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
        if (!(Number(intervalMs) >= 0)) throw new TypeError('intervalMs must be a non-negative number.');
        if (typeof deliver !== 'function') throw new TypeError('deliver must be a function.');
        this.intervalMs = Number(intervalMs);
        this.deliver = deliver;
        this.now = now;
        this.setTimer = setTimer;
        this.clearTimer = clearTimer;
        this.lastDelivered = new Map();
        this.pending = new Map();
    }

    push(key, value) {
        const currentTime = this.now();
        const hasLast = this.lastDelivered.has(key);
        const last = this.lastDelivered.get(key) ?? 0;
        const elapsed = currentTime - last;

        if (!hasLast || (elapsed >= this.intervalMs && !this.pending.has(key))) {
            this.lastDelivered.set(key, currentTime);
            this.deliver(value, key);
            return 'delivered';
        }

        const existing = this.pending.get(key);
        if (existing) {
            existing.value = value;
            return 'coalesced';
        }

        const delay = Math.max(0, this.intervalMs - elapsed);
        const pending = { value, timer: null };
        pending.timer = this.setTimer(() => {
            const latest = this.pending.get(key);
            if (latest !== pending) return;
            this.pending.delete(key);
            this.lastDelivered.set(key, this.now());
            this.deliver(latest.value, key);
        }, delay);
        this.pending.set(key, pending);
        return 'scheduled';
    }

    cancel(key, { forgetLast = false } = {}) {
        const pending = this.pending.get(key);
        if (pending) this.clearTimer(pending.timer);
        this.pending.delete(key);
        if (forgetLast) this.lastDelivered.delete(key);
    }

    clear() {
        for (const { timer } of this.pending.values()) this.clearTimer(timer);
        this.pending.clear();
        this.lastDelivered.clear();
    }
}
