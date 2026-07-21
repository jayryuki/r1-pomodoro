import assert from "node:assert/strict";
import test from "node:test";
import { createController } from "../js/app.js";
import { createOrientationTracker } from "../js/orientation.js";
import { DEFAULT_STATE } from "../js/storage.js";
import { createTimer } from "../js/timer.js";

function harness(saved = DEFAULT_STATE, { failSave = false } = {}) {
  let now = 0;
  let persisted = saved;
  let alarmStarts = 0;
  let alarmStops = 0;
  const controller = createController({
    timer: createTimer({ now: () => now }),
    tracker: createOrientationTracker({ calibration: saved.calibration, smoothing: 1 }),
    store: {
      load: async () => persisted,
      save: async value => {
        if (failSave) throw new Error("storage unavailable");
        persisted = value;
        return value;
      },
    },
    alarm: {
      start: () => { alarmStarts += 1; },
      stop: () => { alarmStops += 1; },
    },
    render: () => {},
  });
  return {
    controller,
    setNow: value => { now = value; },
    getPersisted: () => persisted,
    getAlarmCounts: () => [alarmStarts, alarmStops],
  };
}

test("stable mapped edge starts its configured timer", async () => {
  const h = harness({
    version: 1,
    durations: [25, 5, 25, 15],
    calibration: { baseAngle: 0, direction: 1 },
  });
  await h.controller.init();
  h.controller.handleSensor({ x: 1, y: 0, z: 0 }, 0);
  h.controller.handleSensor({ x: 1, y: 0, z: 0 }, 500);
  assert.equal(h.controller.snapshot().timer.remainingMs, 25 * 60_000);
});

test("PTT pauses, resumes, and dismisses alarm", async () => {
  const h = harness({
    version: 1,
    durations: [1, 5, 25, 15],
    calibration: { baseAngle: 0, direction: 1 },
  });
  await h.controller.init();
  h.controller.handleSensor({ x: 1, y: 0, z: 0 }, 0);
  h.controller.handleSensor({ x: 1, y: 0, z: 0 }, 500);
  h.controller.handlePTT();
  assert.equal(h.controller.snapshot().timer.mode, "paused");
  h.controller.handlePTT();
  assert.equal(h.controller.snapshot().timer.mode, "running");
  h.setNow(60_000);
  h.controller.tick();
  h.controller.handlePTT();
  assert.equal(h.controller.snapshot().timer.mode, "complete");
});

test("calibration pauses then resumes the previous countdown", async () => {
  const h = harness({
    version: 1,
    durations: [25, 5, 25, 15],
    calibration: { baseAngle: 0, direction: 1 },
  });
  await h.controller.init();
  h.controller.handleSensor({ x: 1, y: 0, z: 0 }, 0);
  h.controller.handleSensor({ x: 1, y: 0, z: 0 }, 500);
  await h.controller.calibrate();
  assert.equal(h.controller.snapshot().timer.mode, "paused");
  h.controller.handleSensor({ x: 1, y: 0, z: 0 }, 1_000);
  h.controller.handleSensor({ x: 1, y: 0, z: 0 }, 1_500);
  h.controller.handleSensor({ x: 0, y: 1, z: 0 }, 2_000);
  await h.controller.handleSensor({ x: 0, y: 1, z: 0 }, 2_500);
  assert.equal(h.controller.snapshot().timer.mode, "running");
  assert.equal(h.controller.snapshot().timer.position, 0);
  assert.equal(h.getPersisted().calibration.direction, 1);
});

test("duration validation rejects non-positive or fractional minutes", async () => {
  const h = harness();
  await h.controller.init();
  assert.deepEqual(await h.controller.saveDurations([25, 0, 25, 15]), {
    ok: false,
    message: "Enter four positive whole-minute values.",
  });
});

test("storage failure keeps values for the session and reports a warning", async () => {
  const h = harness(DEFAULT_STATE, { failSave: true });
  await h.controller.init();
  assert.deepEqual(await h.controller.saveDurations([30, 6, 30, 18]), {
    ok: false,
    message: "Saved for this session only.",
  });
  assert.deepEqual(h.controller.snapshot().durations, [30, 6, 30, 18]);
});
