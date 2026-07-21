# Rabbit R1 Orientation Pomodoro Design

## Purpose

Build a dependency-free Rabbit R1 creation that runs as a static GitHub Pages site. The creation uses the R1 accelerometer to associate the device's four edge-up positions with a Pomodoro sequence. Turning the device immediately selects and starts the timer assigned to the new edge.

## Product Behavior

The default four-stage sequence is:

1. Focus 1: 25 minutes
2. Short break: 5 minutes
3. Focus 2: 25 minutes
4. Long break: 15 minutes

The first recognized stable edge starts its mapped timer automatically. Turning to a different mapped edge cancels the current countdown and starts the new edge's timer from its full configured duration. Placing the device flat on its screen or back does not pause, reset, or change the active timer.

At zero, the screen flashes and a repeating beep plays. Turning to another edge dismisses the alarm and starts that edge's timer. Pressing PTT dismisses the alarm and leaves the completed timer at `00:00` until the device is turned. Outside the alarm state, PTT pauses or resumes the active timer.

## Orientation and Calibration

The creation uses gravity across the accelerometer's X/Y plane to distinguish the four edge-up positions. Sensor samples are smoothed, and a candidate orientation must remain stable for roughly 500 ms before it can change the timer. Angular hysteresis prevents wobble near orientation boundaries from repeatedly restarting a timer.

On first use, or after calibration data is cleared:

1. If the device is flat, the app displays `Stand R1 on an edge` and waits.
2. The first stable edge becomes position one.
3. The first stable adjacent 90-degree turn establishes the direction in which positions advance.
4. The remaining positions follow around the device at 90-degree intervals.

The learned mapping persists across launches. On later launches, the first recognized mapped edge starts its assigned timer. `Calibrate orientation` clears only orientation data and repeats the learning flow; it does not reset configured durations. If a countdown is active, calibration pauses it and suppresses orientation-based timer switching. After the base edge and first adjacent edge are learned, the previous countdown resumes from its remaining time. The next stable edge change returns control to the new orientation mapping.

## Interface

The primary screen fits the R1's fixed 240x282 pixel portrait display:

- Header with the current stage name and a gear button
- Large centered `MM:SS` countdown
- Four position indicators, with the active stage highlighted
- Footer status: `Running`, `Paused`, `Turn R1`, `Calibrating`, or `Time's up`
- High-contrast alarm state with a flashing background, disabled when reduced motion is preferred

Settings uses a full-screen panel with:

- Four positive whole-minute duration fields
- Save and Cancel actions
- Restore defaults action
- Calibrate orientation action

Saving durations does not modify an already-running countdown. New values apply the next time a position starts. Restore defaults resets only durations to 25, 5, 25, and 15 minutes.

## Architecture

The implementation is a dependency-free static site:

- `index.html`: timer and settings markup
- `styles.css`: fixed-size layout, states, and alarm animation
- `js/timer.js`: deadline-based countdown state machine
- `js/orientation.js`: smoothing, edge classification, calibration, stability, and hysteresis
- `js/storage.js`: persistent settings and calibration data
- `js/app.js`: UI rendering, SDK integration, PTT behavior, and alarm audio

Each module exposes a small interface so timer and orientation behavior can be tested independently of the DOM and Rabbit SDK.

## Data Flow

1. The app loads saved settings and orientation calibration.
2. It checks `window.creationSensors.accelerometer` availability and begins sampling at a modest frequency.
3. Orientation samples are normalized, smoothed, and classified as flat, unstable, or one of four edge positions.
4. A stable position event is sent to the timer controller.
5. The timer controller starts, switches, pauses, resumes, or completes the countdown.
6. The app renders state changes and controls the alarm.

Countdowns use an absolute completion timestamp rather than decrementing a counter every second. Rendering delays therefore do not accumulate as timer drift.

## Persistence

Timer settings and calibration data are stored as one versioned JSON document. On R1, the document uses `window.creationStorage.plain` and the SDK-required Base64 encoding. In a normal browser, `localStorage` is used as a development fallback.

Missing, malformed, unsupported-version, or invalid persisted data falls back to default durations and an uncalibrated orientation state. Secure storage is unnecessary because the data contains no secrets.

## Audio and Error Handling

The alarm uses the Web Audio API to generate a repeating beep without an external media asset. If the WebView requires user interaction before audio can play, the app exposes a one-time `Enable sound` control. The visual alarm remains functional when audio is unavailable.

If the accelerometer API is missing or unavailable, the app shows an explicit sensor-unavailable status rather than pretending orientation control works. Storage failures keep the app usable for the current session and surface a concise settings warning. Invalid settings input remains on screen with field-level feedback.

## Testing

Automated tests cover:

- Countdown start, switch, pause, resume, completion, and restart behavior
- Absolute-deadline accuracy after delayed ticks
- Four-way orientation classification and flat-position rejection
- Stability timing and hysteresis at orientation boundaries
- Initial calibration, adjacent-turn direction learning, persistence, and reset
- Settings validation, defaults, serialization, and corrupt-data fallback
- PTT behavior in running, paused, and alarm states

Browser-level checks use simulated accelerometer samples and verify the 240x282 viewport, settings flow, alarm state, browser storage fallback, and static relative asset paths required by GitHub Pages. Final hardware validation checks actual R1 axis signs, sensor stability thresholds, PTT events, storage, and Web Audio behavior.

## Deployment

The repository root is directly deployable through GitHub Pages. After publishing, the hosted URL is entered into the Rabbit creations SDK QR generator, and the resulting QR code is scanned from the R1 creations card.
