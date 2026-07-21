import assert from "node:assert/strict";
import test from "node:test";
import { createTimer } from "../js/timer.js";

test("starts and calculates remaining time from an absolute deadline", () => {
  let now = 1_000;
  const timer = createTimer({ now: () => now });
  timer.start(0, 60_000);
  now = 11_250;
  timer.tick();
  assert.equal(timer.snapshot().remainingMs, 49_750);
});

test("switching positions restarts with the new full duration", () => {
  const timer = createTimer({ now: () => 1_000 });
  timer.start(0, 60_000);
  timer.start(1, 20_000);
  assert.deepEqual(
    { position: timer.snapshot().position, remainingMs: timer.snapshot().remainingMs },
    { position: 1, remainingMs: 20_000 },
  );
});

test("pause and resume preserve remaining time", () => {
  let now = 0;
  const timer = createTimer({ now: () => now });
  timer.start(0, 10_000);
  now = 4_000;
  timer.pause();
  now = 9_000;
  timer.resume();
  now = 10_000;
  timer.tick();
  assert.equal(timer.snapshot().remainingMs, 5_000);
});

test("zero enters alarm and dismiss leaves completed state", () => {
  let now = 0;
  const timer = createTimer({ now: () => now });
  timer.start(0, 1_000);
  now = 1_000;
  timer.tick();
  assert.equal(timer.snapshot().mode, "alarm");
  timer.dismissAlarm();
  assert.equal(timer.snapshot().mode, "complete");
});
