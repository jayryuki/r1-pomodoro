export const DEFAULT_DURATIONS = Object.freeze([25, 5, 25, 15]);
export const DEFAULT_STATE = Object.freeze({
  version: 1,
  durations: DEFAULT_DURATIONS,
  calibration: null,
});

const KEY = "r1-pomodoro-state";

function cloneDefaults() {
  return { version: 1, durations: [...DEFAULT_DURATIONS], calibration: null };
}

export function normalizeState(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.durations)) return cloneDefaults();
  const durations = value.durations.map(Number);
  if (durations.length !== 4 || durations.some(value => !Number.isInteger(value) || value < 1)) {
    return cloneDefaults();
  }

  let calibration = null;
  if (value.calibration != null) {
    const { baseAngle, direction } = value.calibration;
    if (!Number.isFinite(baseAngle) || ![1, -1].includes(direction)) return cloneDefaults();
    calibration = { baseAngle, direction };
  }
  return { version: 1, durations, calibration };
}

export function createStateStore({
  creationStorage = globalThis.creationStorage,
  localStorage = globalThis.localStorage,
} = {}) {
  return {
    async load() {
      try {
        const raw = creationStorage?.plain
          ? await creationStorage.plain.getItem(KEY)
          : localStorage?.getItem(KEY);
        if (!raw) return cloneDefaults();
        const json = creationStorage?.plain ? atob(raw) : raw;
        return normalizeState(JSON.parse(json));
      } catch {
        return cloneDefaults();
      }
    },

    async save(value) {
      const state = normalizeState(value);
      const json = JSON.stringify(state);
      if (creationStorage?.plain) {
        await creationStorage.plain.setItem(KEY, btoa(json));
      } else if (localStorage) {
        localStorage.setItem(KEY, json);
      }
      return state;
    },
  };
}
