export function createTimer({ now = Date.now } = {}) {
  let state = {
    mode: "idle",
    position: null,
    durationMs: 0,
    remainingMs: 0,
    deadline: null,
  };

  function updateRemaining() {
    if (state.mode !== "running") return;
    state.remainingMs = Math.max(0, state.deadline - now());
    if (state.remainingMs === 0) {
      state.mode = "alarm";
      state.deadline = null;
    }
  }

  return {
    start(position, durationMs) {
      state = {
        mode: "running",
        position,
        durationMs,
        remainingMs: durationMs,
        deadline: now() + durationMs,
      };
    },
    tick: updateRemaining,
    pause() {
      if (state.mode !== "running") return;
      updateRemaining();
      if (state.mode === "running") {
        state.mode = "paused";
        state.deadline = null;
      }
    },
    resume() {
      if (state.mode !== "paused") return;
      state.mode = "running";
      state.deadline = now() + state.remainingMs;
    },
    dismissAlarm() {
      if (state.mode === "alarm") state.mode = "complete";
    },
    snapshot() {
      return { ...state };
    },
  };
}
