# CV WebSocket Protocol (ESP32 ↔ HelpStat)

All messages are JSON, framed as individual WebSocket text frames.
Units are strict: E in volts, I in microamperes, t in seconds.

## Client → ESP32

Start a sweep with the configured CV parameters:

```json
{ "command": "start_cv",
  "scanRate": 100, "eStart": 0.6,
  "eVertex1": -0.2, "eVertex2": 0.6,
  "nCycles": 1, "n": 1, "cMM": 5, "areaCm2": 0.0707,
  "cvModel": "reversible" }
```

Abort the sweep:

```json
{ "command": "stop" }
```

## ESP32 → Client

### `cv_data` — one sample per frame

```json
{ "type": "cv_data",
  "E": 0.245, "I": 81.2,
  "cycle": 1, "t": 4.53, "branch": "reverse" }
```

- `E` — potential (V vs reference)
- `I` — current (µA, signed: anodic +, cathodic −)
- `cycle` — integer ≥ 1
- `t` — seconds since the sweep started
- `branch` — `"forward" | "reverse" | "return"` (optional but recommended)

Frames with non-finite `E` / `I` are dropped by the client.

### `cv_status` — heartbeat

```json
{ "type": "cv_status", "status": "running" }
```

`status ∈ {"idle","running","done","error"}`

### `cv_done` — sweep finished cleanly

```json
{ "type": "cv_done", "cycle": 1, "points": 1601 }
```

### `cv_error` — hardware failure

```json
{ "type": "cv_error", "message": "ADC saturated" }
```

The client surfaces `message` as a UI alert.