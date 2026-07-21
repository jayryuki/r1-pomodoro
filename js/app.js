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

class Alarm {
  constructor(button) {
    this.button = button;
    this.context = null;
    this.interval = null;
  }

  async enable() {
    const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContext) return false;
    this.context ??= new AudioContext();
    await this.context.resume();
    this.button.hidden = this.context.state === "running";
    return this.context.state === "running";
  }

  beep() {
    if (!this.context || this.context.state !== "running") {
      this.button.hidden = false;
      return;
    }
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.12, this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.context.currentTime + 0.18);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start();
    oscillator.stop(this.context.currentTime + 0.2);
  }

  start() {
    this.stop();
    this.beep();
    this.interval = setInterval(() => this.beep(), 900);
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }
}

function formatTime(milliseconds) {
  const seconds = Math.ceil(milliseconds / 1_000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function boot() {
  const appElement = document.querySelector("#app");
  const settings = document.querySelector("#settings");
  const settingsForm = document.querySelector("#settingsForm");
  const settingsError = document.querySelector("#settingsError");
  const durationInputs = [0, 1, 2, 3].map(index => document.querySelector(`#duration${index}`));
  const soundButton = document.querySelector("#soundButton");
  const debugEl = document.querySelector("#debug");
  const alarm = new Alarm(soundButton);

  let sensorCount = 0;

  function debug(text) {
    if (debugEl) debugEl.textContent = text;
  }

  const render = state => {
    const { timer } = state;
    document.querySelector("#stageName").textContent =
      timer.position == null ? STAGE_NAMES[0] : STAGE_NAMES[timer.position];
    document.querySelector("#time").textContent = formatTime(
      timer.position == null ? state.durations[0] * 60_000 : timer.remainingMs,
    );
    document.querySelector("#status").textContent = state.message;
    document.querySelectorAll(".position").forEach((element, index) => {
      element.classList.toggle("active", index === timer.position);
    });
    appElement.classList.toggle("alarm", timer.mode === "alarm");
    if (timer.mode === "alarm") settings.hidden = true;
  };

  const controller = createController({
    timer: createTimer(),
    tracker: createOrientationTracker(),
    store: createStateStore(),
    alarm,
    render,
  });

  debug("init...");

  controller.init().then(() => {
    debug("init done");
    const accelerometer = globalThis.creationSensors?.accelerometer;
    if (!accelerometer) {
      debug("no creationSensors");
      if (!new URLSearchParams(location.search).has("simulate")) {
        document.querySelector("#status").textContent = "Accelerometer unavailable";
      }
      return;
    }

    debug("sensor found");

    const startAccel = () => {
      try {
        accelerometer.start(data => {
          sensorCount += 1;
          const norm = normalizeSensorSample(data);
          if (sensorCount <= 3 || sensorCount % 20 === 0) {
            const keys = data ? Object.keys(data).join(",") : "null";
            debug(`#${sensorCount} ${keys} x=${norm.x.toFixed(2)} y=${norm.y.toFixed(2)} z=${norm.z.toFixed(2)}`);
          }
          controller.handleSensor(norm);
        }, { frequency: 20 });
        debug("sensor started");
      } catch (e) {
        debug("start err: " + (e?.message || e));
      }
    };

    if (typeof accelerometer.isAvailable === "function") {
      debug("checking avail...");
      Promise.resolve(accelerometer.isAvailable()).then(available => {
        if (!available) {
          debug("sensor unavailable");
          document.querySelector("#status").textContent = "Accelerometer unavailable";
          return;
        }
        startAccel();
      }).catch(e => {
        debug("avail err, starting anyway");
        startAccel();
      });
    } else {
      startAccel();
    }
  }).catch(e => {
    debug("init err: " + (e?.message || e));
  });

  setInterval(() => controller.tick(), 250);
  window.addEventListener("sideClick", () => controller.handlePTT());

  document.querySelector("#settingsButton").addEventListener("click", () => {
    controller.snapshot().durations.forEach((value, index) => { durationInputs[index].value = value; });
    settingsError.textContent = "";
    settings.hidden = false;
  });
  document.querySelector("#cancelButton").addEventListener("click", () => { settings.hidden = true; });
  document.querySelector("#restoreButton").addEventListener("click", async () => {
    await controller.restoreDefaults();
    controller.snapshot().durations.forEach((value, index) => { durationInputs[index].value = value; });
  });
  document.querySelector("#calibrateButton").addEventListener("click", async () => {
    await controller.calibrate();
    settings.hidden = true;
  });
  settingsForm.addEventListener("submit", async event => {
    event.preventDefault();
    const result = await controller.saveDurations(durationInputs.map(input => input.value));
    settingsError.textContent = result.ok ? "" : result.message;
    if (result.ok) settings.hidden = true;
  });
  soundButton.addEventListener("click", () => alarm.enable());

  if (new URLSearchParams(location.search).has("simulate")) {
    window.r1PomodoroDebug = {
      async turn(position) {
        const angle = position * Math.PI / 2;
        for (let index = 0; index < 12; index += 1) {
          controller.handleSensor({ x: Math.cos(angle), y: Math.sin(angle), z: 0 });
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      },
      ptt: () => controller.handlePTT(),
      sample: data => controller.handleSensor(data),
      state: () => controller.snapshot(),
    };
  }
}

if (typeof document !== "undefined") boot();
