import assert from "node:assert/strict";
import test from "node:test";
import {
  createOrientationTracker,
  normalizeSensorSample,
} from "../js/orientation.js";

function hold(tracker, sample, start = 0) {
  tracker.sample(sample, start);
  return tracker.sample(sample, start + 500);
}

test("normalizes the SDK's alternate accelerometer field names", () => {
  assert.deepEqual(
    normalizeSensorSample({ tiltX: 1, tiltY: 0, tiltZ: 0 }),
    { x: 1, y: 0, z: 0 },
  );
});

test("flat samples do not establish a base", () => {
  const tracker = createOrientationTracker({ smoothing: 1 });
  assert.deepEqual(hold(tracker, { x: 0, y: 0, z: 1 }), { type: "flat" });
  assert.equal(tracker.getCalibration(), null);
});

test("first stable edge becomes position zero", () => {
  const tracker = createOrientationTracker({ smoothing: 1 });
  assert.deepEqual(hold(tracker, { x: 1, y: 0, z: 0 }), { type: "base", position: 0 });
});

test("first adjacent turn establishes direction and all four positions", () => {
  const tracker = createOrientationTracker({ smoothing: 1 });
  hold(tracker, { x: 1, y: 0, z: 0 });
  const calibrated = hold(tracker, { x: 0, y: 1, z: 0 }, 1_000);
  assert.equal(calibrated.type, "calibrated");
  assert.equal(calibrated.position, 1);
  assert.equal(calibrated.calibration.direction, 1);
  assert.deepEqual(hold(tracker, { x: -1, y: 0, z: 0 }, 2_000), {
    type: "position",
    position: 2,
  });
});

test("brief and diagonal movement does not switch position", () => {
  const tracker = createOrientationTracker({
    calibration: { baseAngle: 0, direction: 1 },
    smoothing: 1,
  });
  tracker.sample({ x: 1, y: 0, z: 0 }, 0);
  assert.equal(tracker.sample({ x: 0.7, y: 0.7, z: 0 }, 700), null);
  assert.equal(tracker.sample({ x: 0, y: 1, z: 0 }, 800), null);
});
