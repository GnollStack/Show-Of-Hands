import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LatestValueRateLimiter } from '../scripts/latest-value-rate-limiter.js';

test('latest-value limiter delivers the newest coalesced value at the trailing edge', () => {
    let now = 0;
    let nextTimerId = 1;
    const timers = new Map();
    const delivered = [];
    const limiter = new LatestValueRateLimiter({
        intervalMs: 250,
        now: () => now,
        setTimer(callback, delay) {
            const id = nextTimerId++;
            timers.set(id, { callback, due: now + delay });
            return id;
        },
        clearTimer: id => timers.delete(id),
        deliver: value => delivered.push(value)
    });

    assert.equal(limiter.push('user', 'old'), 'delivered');
    now = 50;
    assert.equal(limiter.push('user', 'intermediate'), 'scheduled');
    now = 100;
    assert.equal(limiter.push('user', 'newest'), 'coalesced');
    assert.deepEqual(delivered, ['old']);
    assert.equal(timers.size, 1);

    now = 250;
    const [timerId, timer] = [...timers.entries()][0];
    timers.delete(timerId);
    timer.callback();
    assert.deepEqual(delivered, ['old', 'newest']);
    assert.equal(timers.size, 0);
});

test('latest-value limiter cancellation prevents stale trailing delivery', () => {
    let now = 0;
    let nextTimerId = 1;
    const timers = new Map();
    const delivered = [];
    const limiter = new LatestValueRateLimiter({
        intervalMs: 100,
        now: () => now,
        setTimer(callback, delay) {
            const id = nextTimerId++;
            timers.set(id, { callback, due: now + delay });
            return id;
        },
        clearTimer: id => timers.delete(id),
        deliver: value => delivered.push(value)
    });

    limiter.push('user', 'visible');
    now = 10;
    limiter.push('user', 'stale-pending');
    limiter.cancel('user', { forgetLast: true });
    assert.equal(timers.size, 0);
    assert.deepEqual(delivered, ['visible']);

    assert.equal(limiter.push('user', 'fresh'), 'delivered');
    assert.deepEqual(delivered, ['visible', 'fresh']);
});

test('cancelling a pending value can retain delivery history to prevent clear-message bypass', () => {
    let now = 0;
    let nextTimerId = 1;
    const timers = new Map();
    const delivered = [];
    const limiter = new LatestValueRateLimiter({
        intervalMs: 100,
        now: () => now,
        setTimer(callback, delay) {
            const id = nextTimerId++;
            timers.set(id, { callback, due: now + delay });
            return id;
        },
        clearTimer: id => timers.delete(id),
        deliver: value => delivered.push(value)
    });

    assert.equal(limiter.push('user', 'first-image'), 'delivered');
    now = 10;
    assert.equal(limiter.push('user', 'stale-image'), 'scheduled');
    limiter.cancel('user');
    assert.equal(timers.size, 0);

    assert.equal(limiter.push('user', 'image-after-clear'), 'scheduled');
    assert.deepEqual(delivered, ['first-image']);
    assert.equal(timers.size, 1);

    now = 100;
    const [timerId, timer] = [...timers.entries()][0];
    timers.delete(timerId);
    timer.callback();
    assert.deepEqual(delivered, ['first-image', 'image-after-clear']);
});
