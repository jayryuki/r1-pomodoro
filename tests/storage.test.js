import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_STATE,
  createStateStore,
  normalizeState,
} from "../js/storage.js";

test("invalid persisted state falls back to defaults", () => {
  assert.deepEqual(normalizeState({ version: 1, durations: [0, 5] }), DEFAULT_STATE);
});

test("valid state retains durations and complete calibration", () => {
  const state = normalizeState({
    version: 1,
    durations: [30, 7, 30, 20],
    calibration: { baseAngle: 0.25, direction: -1 },
  });
  assert.deepEqual(state, {
    version: 1,
    durations: [30, 7, 30, 20],
    calibration: { baseAngle: 0.25, direction: -1 },
  });
});

test("browser store round-trips JSON", async () => {
  const memory = new Map();
  const localStorage = {
    getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value),
  };
  const store = createStateStore({ creationStorage: null, localStorage });
  const state = { version: 1, durations: [20, 4, 20, 10], calibration: null };
  await store.save(state);
  assert.deepEqual(await store.load(), state);
});

test("Rabbit store writes Base64 and reads it back", async () => {
  let encoded = null;
  const creationStorage = {
    plain: {
      getItem: async () => encoded,
      setItem: async (_key, value) => { encoded = value; },
    },
  };
  const store = createStateStore({ creationStorage, localStorage: null });
  await store.save(DEFAULT_STATE);
  assert.notEqual(encoded, JSON.stringify(DEFAULT_STATE));
  assert.deepEqual(await store.load(), DEFAULT_STATE);
});
