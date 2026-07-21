import { createOrientationTracker, normalizeSensorSample } from "./orientation.js";
import { DEFAULT_DURATIONS, createStateStore } from "./storage.js";
import { createTimer } from "./timer.js";

const STAGE_NAMES = ["Focus 1", "Short break", "Focus 2", "Long break"];

export function createController({ timer, tracker, store, alarm, render }) {
  let durations = [...DEFAULT_DURATIONS];
  let calibration = null;
  let calibrating = false;
  let resumeAfterCalibration = false;
  let lastAlarmMode = false;
  let message = "Stand R1 on an edge";

  function view() {
    return {
      timer: timer.snapshot(),
      durations: [...durations],
      calibration,
      calibrating,
      message,
    };
  }

  function sync() {
    const state = timer.snapshot();
    if (state.mode === "alarm" && !lastAlarmMode) alarm.start();
    if (state.mode !== "alarm" && lastAlarmMode) alarm.stop();
    lastAlarmMode = state.mode === "alarm";
    render(view());
  }

  async function persist() {
    try {
      await store.save({ version: 1, durations, calibration });
      return true;
    } catch {
      return false;
    }
  }

  return {
    async init() {
      const saved = await store.load();
      durations = [...saved.durations];
      calibration = saved.calibration;
      tracker.setCalibration(calibration);
      sync();
    },

    async handleSensor(sample, at = Date.now()) {
      const event = tracker.sample(sample, at);
      if (!event) return;
      if (event.type === "flat") {
        if (timer.snapshot().mode === "idle") message = "Stand R1 on an edge";
        sync();
        return;
      }
      if (event.type === "base") {
        message = "Turn to an adjacent edge";
        if (!calibrating && timer.snapshot().mode === "idle") {
          timer.start(0, durations[0] * 60_000);
        }
        sync();
        return;
      }
      if (event.type === "calibrated") {
        calibration = event.calibration;
        await persist();
        if (calibrating) {
          calibrating = false;
          message = "Running";
          if (resumeAfterCalibration) timer.resume();
        } else {
          timer.start(event.position, durations[event.position] * 60_000);
        }
        sync();
        return;
      }
      if (event.type === "position" && !calibrating) {
        alarm.stop();
        timer.start(event.position, durations[event.position] * 60_000);
        message = "Running";
        sync();
      }
    },

    handlePTT() {
      if (calibrating) return;
      const mode = timer.snapshot().mode;
      if (mode === "alarm") {
        timer.dismissAlarm();
        message = "Turn R1";
      } else if (mode === "running") {
        timer.pause();
        message = "Paused";
      } else if (mode === "paused") {
        timer.resume();
        message = "Running";
      }
      sync();
    },

    tick() {
      timer.tick();
      if (timer.snapshot().mode === "alarm") message = "Time's up";
      sync();
    },

    async saveDurations(values) {
      const next = values.map(Number);
      if (next.length !== 4 || next.some(value => !Number.isInteger(value) || value < 1)) {
        return { ok: false, message: "Enter four positive whole-minute values." };
      }
      durations = next;
      const saved = await persist();
      sync();
      return saved
        ? { ok: true }
        : { ok: false, message: "Saved for this session only." };
    },

    async restoreDefaults() {
      durations = [...DEFAULT_DURATIONS];
      await persist();
      sync();
    },

    async calibrate() {
      const mode = timer.snapshot().mode;
      resumeAfterCalibration = mode === "running";
      if (resumeAfterCalibration) timer.pause();
      if (mode === "alarm") timer.dismissAlarm();
      alarm.stop();
      calibration = null;
      calibrating = true;
      message = "Stand R1 on an edge";
      tracker.reset();
      await persist();
      sync();
    },

    snapshot: view,
  };
}
