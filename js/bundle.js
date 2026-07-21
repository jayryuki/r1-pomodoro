(function () {
  "use strict";

  var DEFAULT_DURATIONS = Object.freeze([25, 5, 25, 15]);
  var DEFAULT_STATE = Object.freeze({
    version: 1,
    durations: DEFAULT_DURATIONS,
    calibration: null,
  });

  var STORAGE_KEY = "r1-pomodoro-state";
  var STAGE_NAMES = ["Focus 1", "Short break", "Focus 2", "Long break"];

  function cloneDefaults() {
    return { version: 1, durations: [25, 5, 25, 15], calibration: null };
  }

  function normalizeState(value) {
    if (!value || value.version !== 1 || !Array.isArray(value.durations)) return cloneDefaults();
    var durations = value.durations.map(Number);
    if (durations.length !== 4 || durations.some(function (v) { return !Number.isInteger(v) || v < 1; })) {
      return cloneDefaults();
    }
    var calibration = null;
    if (value.calibration != null) {
      var ba = value.calibration.baseAngle, dir = value.calibration.direction;
      if (!Number.isFinite(ba) || ![1, -1].includes(dir)) return cloneDefaults();
      calibration = { baseAngle: ba, direction: dir };
    }
    return { version: 1, durations: durations, calibration: calibration };
  }

  function createStateStore(options) {
    var creationStorage = (options && options.creationStorage) || window.creationStorage;
    var localStorage = (options && options.localStorage) || window.localStorage;
    return {
      load: async function () {
        try {
          var raw;
          if (creationStorage && creationStorage.plain) {
            raw = await creationStorage.plain.getItem(STORAGE_KEY);
          } else if (localStorage) {
            raw = localStorage.getItem(STORAGE_KEY);
          }
          if (!raw) return cloneDefaults();
          var json = (creationStorage && creationStorage.plain) ? atob(raw) : raw;
          return normalizeState(JSON.parse(json));
        } catch (e) {
          return cloneDefaults();
        }
      },
      save: async function (value) {
        var state = normalizeState(value);
        var json = JSON.stringify(state);
        if (creationStorage && creationStorage.plain) {
          await creationStorage.plain.setItem(STORAGE_KEY, btoa(json));
        } else if (localStorage) {
          localStorage.setItem(STORAGE_KEY, json);
        }
        return state;
      },
    };
  }

  function createTimer(options) {
    var now = (options && options.now) || Date.now;
    var state = { mode: "idle", position: null, durationMs: 0, remainingMs: 0, deadline: null };

    function updateRemaining() {
      if (state.mode !== "running") return;
      state.remainingMs = Math.max(0, state.deadline - now());
      if (state.remainingMs === 0) { state.mode = "alarm"; state.deadline = null; }
    }

    return {
      start: function (position, durationMs) {
        state = { mode: "running", position: position, durationMs: durationMs, remainingMs: durationMs, deadline: now() + durationMs };
      },
      tick: updateRemaining,
      pause: function () {
        if (state.mode !== "running") return;
        updateRemaining();
        if (state.mode === "running") { state.mode = "paused"; state.deadline = null; }
      },
      resume: function () {
        if (state.mode !== "paused") return;
        state.mode = "running"; state.deadline = now() + state.remainingMs;
      },
      dismissAlarm: function () { if (state.mode === "alarm") state.mode = "complete"; },
      snapshot: function () { return Object.assign({}, state); },
    };
  }

  var TAU = Math.PI * 2;

  function wrap(angle) { return ((angle + Math.PI) % TAU + TAU) % TAU - Math.PI; }
  function angularDistance(a, b) { return Math.abs(wrap(a - b)); }

  function normalizeSensorSample(data) {
    var x = data.tiltX != null ? data.tiltX : (data.x != null ? data.x : (Number.isFinite(data.rawX) ? data.rawX / 9.81 : NaN));
    var y = data.tiltY != null ? data.tiltY : (data.y != null ? data.y : (Number.isFinite(data.rawY) ? data.rawY / 9.81 : NaN));
    var z = data.tiltZ != null ? data.tiltZ : (data.z != null ? data.z : (Number.isFinite(data.rawZ) ? data.rawZ / 9.81 : NaN));
    return { x: Number(x), y: Number(y), z: Number(z) };
  }

  function createOrientationTracker(options) {
    options = options || {};
    var calibration = options.calibration || null;
    var stableMs = options.stableMs || 500;
    var flatThreshold = options.flatThreshold || 0.55;
    var tolerance = options.tolerance || Math.PI / 6;
    var smoothing = options.smoothing != null ? options.smoothing : 0.35;

    var saved = calibration;
    var baseAngle = calibration ? calibration.baseAngle : null;
    var direction = calibration ? calibration.direction : null;
    var filtered = null, candidate = null, candidateSince = 0, emittedPosition = null;

    function stable(value, at) {
      if (candidate !== value) { candidate = value; candidateSince = at; return false; }
      return at - candidateSince >= stableMs;
    }

    function classify(angle) {
      var best = null;
      for (var position = 0; position < 4; position++) {
        var center = baseAngle + direction * position * Math.PI / 2;
        var distance = angularDistance(angle, center);
        if (!best || distance < best.distance) best = { position: position, distance: distance };
      }
      return best.distance <= tolerance ? best.position : null;
    }

    return {
      sample: function (raw, at) {
        at = at || Date.now();
        var norm = normalizeSensorSample(raw);
        var x = norm.x, y = norm.y, z = norm.z;
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
        if (Math.hypot(x, y) < flatThreshold) { candidate = null; return { type: "flat" }; }

        if (filtered) {
          filtered.x = filtered.x * (1 - smoothing) + x * smoothing;
          filtered.y = filtered.y * (1 - smoothing) + y * smoothing;
        } else {
          filtered = { x: x, y: y };
        }
        var angle = Math.atan2(filtered.y, filtered.x);

        if (baseAngle == null) {
          if (!stable("base", at)) return null;
          baseAngle = angle; emittedPosition = 0;
          return { type: "base", position: 0 };
        }
        if (direction == null) {
          var quarterTurns = Math.round(wrap(angle - baseAngle) / (Math.PI / 2));
          if (Math.abs(quarterTurns) !== 1 || angularDistance(angle, baseAngle + quarterTurns * Math.PI / 2) > tolerance) {
            candidate = null; return null;
          }
          var nextDirection = Math.sign(quarterTurns);
          if (!stable("direction:" + nextDirection, at)) return null;
          direction = nextDirection; saved = { baseAngle: baseAngle, direction: direction };
          emittedPosition = 1;
          return { type: "calibrated", position: 1, calibration: Object.assign({}, saved) };
        }
        var position = classify(angle);
        if (position == null || position === emittedPosition) { candidate = null; return null; }
        if (!stable("position:" + position, at)) return null;
        emittedPosition = position;
        return { type: "position", position: position };
      },
      setCalibration: function (value) {
        saved = value; baseAngle = value ? value.baseAngle : null; direction = value ? value.direction : null;
        filtered = null; candidate = null; emittedPosition = null;
      },
      reset: function () { this.setCalibration(null); },
      getCalibration: function () { return saved ? Object.assign({}, saved) : null; },
    };
  }

  function createController(deps) {
    var timer = deps.timer, tracker = deps.tracker, store = deps.store, alarm = deps.alarm, render = deps.render;
    var durations = [25, 5, 25, 15];
    var calibration = null, calibrating = false, resumeAfterCalibration = false, lastAlarmMode = false;
    var message = "Stand R1 on an edge";

    function view() {
      return { timer: timer.snapshot(), durations: durations.slice(), calibration: calibration, calibrating: calibrating, message: message };
    }
    function sync() {
      var state = timer.snapshot();
      if (state.mode === "alarm" && !lastAlarmMode) alarm.start();
      if (state.mode !== "alarm" && lastAlarmMode) alarm.stop();
      lastAlarmMode = state.mode === "alarm";
      render(view());
    }
    async function persist() {
      try { await store.save({ version: 1, durations: durations, calibration: calibration }); return true; }
      catch (e) { return false; }
    }

    return {
      init: async function () {
        var saved = await store.load();
        durations = saved.durations.slice();
        calibration = saved.calibration;
        tracker.setCalibration(calibration);
        sync();
      },
      handleSensor: async function (sample, at) {
        at = at || Date.now();
        var event = tracker.sample(sample, at);
        if (!event) return;
        if (event.type === "flat") {
          if (timer.snapshot().mode === "idle") message = "Stand R1 on an edge";
          sync(); return;
        }
        if (event.type === "base") {
          message = "Turn to an adjacent edge";
          if (!calibrating && timer.snapshot().mode === "idle") timer.start(0, durations[0] * 60000);
          sync(); return;
        }
        if (event.type === "calibrated") {
          calibration = event.calibration;
          await persist();
          if (calibrating) { calibrating = false; message = "Running"; if (resumeAfterCalibration) timer.resume(); }
          else { timer.start(event.position, durations[event.position] * 60000); }
          sync(); return;
        }
        if (event.type === "position" && !calibrating) {
          alarm.stop(); timer.start(event.position, durations[event.position] * 60000);
          message = "Running"; sync();
        }
      },
      handlePTT: function () {
        if (calibrating) return;
        var mode = timer.snapshot().mode;
        if (mode === "alarm") { timer.dismissAlarm(); message = "Turn R1"; }
        else if (mode === "running") { timer.pause(); message = "Paused"; }
        else if (mode === "paused") { timer.resume(); message = "Running"; }
        sync();
      },
      tick: function () { timer.tick(); if (timer.snapshot().mode === "alarm") message = "Time's up"; sync(); },
      saveDurations: async function (values) {
        var next = values.map(Number);
        if (next.length !== 4 || next.some(function (v) { return !Number.isInteger(v) || v < 1; }))
          return { ok: false, message: "Enter four positive whole-minute values." };
        durations = next;
        var saved = await persist(); sync();
        return saved ? { ok: true } : { ok: false, message: "Saved for this session only." };
      },
      restoreDefaults: async function () { durations = [25, 5, 25, 15]; await persist(); sync(); },
      calibrate: async function () {
        var mode = timer.snapshot().mode;
        resumeAfterCalibration = mode === "running";
        if (resumeAfterCalibration) timer.pause();
        if (mode === "alarm") timer.dismissAlarm();
        alarm.stop(); calibration = null; calibrating = true;
        message = "Stand R1 on an edge"; tracker.reset();
        await persist(); sync();
      },
      snapshot: view,
    };
  }

  function Alarm(button) {
    this.button = button; this.context = null; this.interval = null;
  }
  Alarm.prototype.enable = async function () {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    if (!this.context) this.context = new AC();
    await this.context.resume();
    this.button.hidden = this.context.state === "running";
    return this.context.state === "running";
  };
  Alarm.prototype.beep = function () {
    if (!this.context || this.context.state !== "running") { this.button.hidden = false; return; }
    var now = this.context.currentTime;
    var osc1 = this.context.createOscillator(), osc2 = this.context.createOscillator();
    var gain = this.context.createGain();
    osc1.frequency.value = 880;
    osc2.frequency.value = 1320;
    osc2.type = "square";
    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this.context.destination);
    osc1.start(now); osc2.start(now);
    osc1.stop(now + 0.4); osc2.stop(now + 0.4);
  };
  Alarm.prototype.start = function () { this.stop(); this.beep(); var self = this; this.interval = setInterval(function () { self.beep(); }, 500); };
  Alarm.prototype.stop = function () { if (this.interval) clearInterval(this.interval); this.interval = null; };

  function formatTime(ms) {
    var seconds = Math.ceil(ms / 1000);
    return String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
  }

  function boot() {
    console.log("[Turnodoro] boot() called");
    var appElement = document.querySelector("#app");
    var settings = document.querySelector("#settings");
    var settingsForm = document.querySelector("#settingsForm");
    var settingsError = document.querySelector("#settingsError");
    var durationInputs = [0, 1, 2, 3].map(function (i) { return document.querySelector("#duration" + i); });
    var soundButton = document.querySelector("#soundButton");
    var debugEl = document.querySelector("#debug");
    var alarm = new Alarm(soundButton);
    var sensorCount = 0;

    function debug(text) {
      console.log("[Turnodoro]", text);
      if (debugEl) debugEl.textContent = text;
    }

    var render = function (state) {
      var t = state.timer;
      document.querySelector("#stageName").textContent = t.position == null ? STAGE_NAMES[0] : STAGE_NAMES[t.position];
      document.querySelector("#time").textContent = formatTime(t.position == null ? state.durations[0] * 60000 : t.remainingMs);
      document.querySelector("#status").textContent = state.message;
      document.querySelectorAll(".position").forEach(function (el, i) { el.classList.toggle("active", i === t.position); });
      appElement.classList.toggle("alarm", t.mode === "alarm");
      if (t.mode === "alarm") settings.hidden = true;

      var rotation = 0;
      if (t.position != null && state.calibration) {
        rotation = -t.position * 90 * state.calibration.direction;
        rotation = ((rotation % 360) + 360) % 360;
        if (rotation > 180) rotation -= 360;
      }
      var sideways = Math.abs(rotation) === 90;
      var scale = sideways ? 240 / 282 : 1;
      appElement.style.transform = "rotate(" + rotation + "deg)" + (sideways ? " scale(" + scale + ")" : "");
    };

    var controller = createController({
      timer: createTimer(),
      tracker: createOrientationTracker(),
      store: createStateStore(),
      alarm: alarm,
      render: render,
    });

    debug("init...");

    function initSensors() {
      debug("checking sensors...");

      if (window.creationSensors && window.creationSensors.accelerometer) {
        debug("creationSensors found");
        var accel = window.creationSensors.accelerometer;

        var startNative = function () {
          try {
            accel.start(function (data) {
              sensorCount++;
              var norm = normalizeSensorSample(data);
              if (sensorCount <= 3 || sensorCount % 20 === 0) {
                debug("#" + sensorCount + " x=" + norm.x.toFixed(2) + " y=" + norm.y.toFixed(2) + " z=" + norm.z.toFixed(2));
              }
              controller.handleSensor(norm);
            }, { frequency: 20 });
            debug("native sensor started");
          } catch (e) {
            debug("native start err: " + (e && e.message ? e.message : e));
            initDeviceMotion();
          }
        };

        if (typeof accel.isAvailable === "function") {
          debug("checking avail...");
          Promise.resolve(accel.isAvailable()).then(function (ok) {
            if (!ok) { debug("native unavailable, fallback"); initDeviceMotion(); return; }
            startNative();
          }).catch(function () { debug("avail err, fallback"); initDeviceMotion(); });
        } else {
          startNative();
        }
      } else {
        debug("no creationSensors, trying DeviceMotion");
        initDeviceMotion();
      }
    }

    function initDeviceMotion() {
      if (typeof DeviceMotionEvent === "undefined") {
        debug("no DeviceMotion either");
        if (!new URLSearchParams(location.search).has("simulate")) {
          document.querySelector("#status").textContent = "No accelerometer";
        }
        return;
      }
      debug("DeviceMotion starting");
      window.addEventListener("devicemotion", function (e) {
        var a = e.accelerationIncludingGravity;
        if (!a) return;
        sensorCount++;
        var norm = { x: (a.x || 0) / 9.81, y: (a.y || 0) / 9.81, z: (a.z || 0) / 9.81 };
        if (sensorCount <= 3 || sensorCount % 20 === 0) {
          debug("#" + sensorCount + " dm x=" + norm.x.toFixed(2) + " y=" + norm.y.toFixed(2) + " z=" + norm.z.toFixed(2));
        }
        controller.handleSensor(norm);
      });
      debug("DeviceMotion listening");
    }

    controller.init().then(function () {
      debug("init done");
      initSensors();
    }).catch(function (e) {
      debug("init err: " + (e && e.message ? e.message : e));
    });

    setInterval(function () { controller.tick(); }, 250);
    window.addEventListener("sideClick", function () { controller.handlePTT(); });

    document.querySelector("#settingsButton").addEventListener("click", function () {
      controller.snapshot().durations.forEach(function (v, i) { durationInputs[i].value = v; });
      settingsError.textContent = ""; settings.hidden = false;
    });
    document.querySelector("#cancelButton").addEventListener("click", function () { settings.hidden = true; });
    document.querySelector("#restoreButton").addEventListener("click", async function () {
      await controller.restoreDefaults();
      controller.snapshot().durations.forEach(function (v, i) { durationInputs[i].value = v; });
    });
    document.querySelector("#calibrateButton").addEventListener("click", async function () {
      await controller.calibrate(); settings.hidden = true;
    });
    settingsForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      var result = await controller.saveDurations(durationInputs.map(function (i) { return i.value; }));
      settingsError.textContent = result.ok ? "" : result.message;
      if (result.ok) settings.hidden = true;
    });
    soundButton.addEventListener("click", function () { alarm.enable(); });

    if (new URLSearchParams(location.search).has("simulate")) {
      window.r1PomodoroDebug = {
        turn: async function (position) {
          var angle = position * Math.PI / 2;
          for (var i = 0; i < 12; i++) {
            controller.handleSensor({ x: Math.cos(angle), y: Math.sin(angle), z: 0 });
            await new Promise(function (r) { setTimeout(r, 50); });
          }
        },
        ptt: function () { controller.handlePTT(); },
        sample: function (data) { controller.handleSensor(data); },
        state: function () { return controller.snapshot(); },
      };
    }
  }

  window.addEventListener("error", function (e) {
    console.error("[Turnodoro] error:", e.message, e.filename, e.lineno);
    var el = document.querySelector("#debug");
    if (el) el.textContent = "ERR: " + e.message;
  });

  if (typeof document !== "undefined") {
    try { console.log("[Turnodoro] boot starting"); boot(); }
    catch (e) {
      console.error("[Turnodoro] boot failed:", e);
      var el = document.querySelector("#debug");
      if (el) el.textContent = "BOOT ERR: " + (e && e.message ? e.message : e);
    }
  }
})();
