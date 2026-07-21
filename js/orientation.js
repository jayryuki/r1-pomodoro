const TAU = Math.PI * 2;

function wrap(angle) {
  return ((angle + Math.PI) % TAU + TAU) % TAU - Math.PI;
}

function angularDistance(a, b) {
  return Math.abs(wrap(a - b));
}

export function normalizeSensorSample(data) {
  const x = data?.tiltX ?? data?.x ?? (Number.isFinite(data?.rawX) ? data.rawX / 9.81 : NaN);
  const y = data?.tiltY ?? data?.y ?? (Number.isFinite(data?.rawY) ? data.rawY / 9.81 : NaN);
  const z = data?.tiltZ ?? data?.z ?? (Number.isFinite(data?.rawZ) ? data.rawZ / 9.81 : NaN);
  return { x: Number(x), y: Number(y), z: Number(z) };
}

export function createOrientationTracker({
  calibration = null,
  stableMs = 500,
  flatThreshold = 0.55,
  tolerance = Math.PI / 6,
  smoothing = 0.35,
} = {}) {
  let saved = calibration;
  let baseAngle = calibration?.baseAngle ?? null;
  let direction = calibration?.direction ?? null;
  let filtered = null;
  let candidate = null;
  let candidateSince = 0;
  let emittedPosition = null;

  function stable(value, at) {
    if (candidate !== value) {
      candidate = value;
      candidateSince = at;
      return false;
    }
    return at - candidateSince >= stableMs;
  }

  function classify(angle) {
    let best = null;
    for (let position = 0; position < 4; position += 1) {
      const center = baseAngle + direction * position * Math.PI / 2;
      const distance = angularDistance(angle, center);
      if (!best || distance < best.distance) best = { position, distance };
    }
    return best.distance <= tolerance ? best.position : null;
  }

  return {
    sample(raw, at = Date.now()) {
      const { x, y, z } = normalizeSensorSample(raw);
      if (![x, y, z].every(Number.isFinite)) return null;
      if (Math.hypot(x, y) < flatThreshold) {
        candidate = null;
        return { type: "flat" };
      }

      filtered = filtered
        ? { x: filtered.x * (1 - smoothing) + x * smoothing, y: filtered.y * (1 - smoothing) + y * smoothing }
        : { x, y };
      const angle = Math.atan2(filtered.y, filtered.x);

      if (baseAngle == null) {
        if (!stable("base", at)) return null;
        baseAngle = angle;
        emittedPosition = 0;
        return { type: "base", position: 0 };
      }

      if (direction == null) {
        const quarterTurns = Math.round(wrap(angle - baseAngle) / (Math.PI / 2));
        if (Math.abs(quarterTurns) !== 1 || angularDistance(angle, baseAngle + quarterTurns * Math.PI / 2) > tolerance) {
          candidate = null;
          return null;
        }
        const nextDirection = Math.sign(quarterTurns);
        if (!stable(`direction:${nextDirection}`, at)) return null;
        direction = nextDirection;
        saved = { baseAngle, direction };
        emittedPosition = 1;
        return { type: "calibrated", position: 1, calibration: { ...saved } };
      }

      const position = classify(angle);
      if (position == null || position === emittedPosition) {
        candidate = null;
        return null;
      }
      if (!stable(`position:${position}`, at)) return null;
      emittedPosition = position;
      return { type: "position", position };
    },

    setCalibration(value) {
      saved = value;
      baseAngle = value?.baseAngle ?? null;
      direction = value?.direction ?? null;
      filtered = null;
      candidate = null;
      emittedPosition = null;
    },

    reset() {
      this.setCalibration(null);
    },

    getCalibration() {
      return saved ? { ...saved } : null;
    },
  };
}
