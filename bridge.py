#!/usr/bin/env python3
"""
ElectroStat bridge — WebSocket ↔ ESP32-S3 / simulated backend.

Supports EIS, BioFET, CV and SWV.  SWV wire protocol:

Frontend → bridge:
    { "command": "start_swv",
      "startE": -0.2, "endE": 0.6, "step_mV": 2, "amplitude_mV": 25,
      "frequency_Hz": 25, "quietTime_s": 2, "direction": "anodic",
      "concentration": 10 }
    { "command": "stop" }

Bridge → frontend:
    { "type": "swv_status", "status": "running" }
    { "type": "swv_data", "E": 0.245, "IForward": 2.34, "IReverse": 1.10,
      "INet": 1.24, "time": 4.53, "index": 123, "direction": "anodic" }
    { "type": "swv_done", "points": 401 }
    { "type": "swv_error", "message": "..." }

Simulated SWV uses the same empirical Langmuir-Gaussian model as the frontend
so live-mode UX matches simulation without hardware.

Usage:
    python bridge.py --mode simulated --port 8765
    python bridge.py --mode wifi --esp-url ws://192.168.1.42/ws --port 8765
"""
from __future__ import annotations

import argparse
import asyncio
import json
import math
import random
import sys
from typing import Any, Dict

try:
    import websockets  # type: ignore
except ImportError:  # pragma: no cover
    print("bridge.py requires `pip install websockets`", file=sys.stderr)
    sys.exit(1)


# ────────────────── SWV simulated generator ──────────────────

IMAX_UA = 1.6
KD_NM = 30.0
EPEAK_V = 0.22


def _langmuir(c_nM: float) -> float:
    c = max(0.0, c_nM)
    return IMAX_UA * (c / (c + KD_NM))


async def _stream_swv_simulated(send, p: Dict[str, Any]) -> None:
    startE = float(p.get("startE", -0.2))
    endE = float(p.get("endE", 0.6))
    step_mV = float(p.get("step_mV", 2))
    amp_mV = float(p.get("amplitude_mV", 25))
    freq = float(p.get("frequency_Hz", 25))
    quiet = float(p.get("quietTime_s", 2.0))
    direction = str(p.get("direction", "anodic"))
    conc = float(p.get("concentration", 0))
    # Mirror the frontend validators — never accept a payload that would
    # produce a NaN-laden stream.
    if not (step_mV > 0):
        await send({"type": "swv_error", "message": "step_mV must be > 0."})
        return
    if not (freq > 0):
        await send({"type": "swv_error", "message": "frequency_Hz must be > 0."})
        return
    if not (amp_mV > 0):
        await send({"type": "swv_error", "message": "amplitude_mV must be > 0."})
        return
    if quiet < 0:
        await send({"type": "swv_error", "message": "quietTime_s must be >= 0."})
        return
    if startE == endE:
        await send({"type": "swv_error", "message": "startE must differ from endE."})
        return
    step_V = step_mV / 1000.0
    n = int(math.floor(abs(endE - startE) / step_V + 1e-9)) + 1
    ramp = 1 if endE >= startE else -1
    ipk = _langmuir(conc)
    sigma = max(0.02, 0.03 + amp_mV / 4000.0)
    period = 1.0 / freq
    await send({"type": "swv_status", "status": "running"})
    try:
        await asyncio.sleep(min(quiet, 0.5))
        for i in range(n):
            E = startE + ramp * i * step_V
            base = 0.05 + 0.02 * E
            i_net = ipk * math.exp(-0.5 * ((E - EPEAK_V) / sigma) ** 2) + base \
                + random.gauss(0, 0.01)
            cbg = 0.05 + 0.01 * E
            i_fwd = cbg + 0.5 * (i_net - base) + random.gauss(0, 0.01)
            i_rev = cbg - 0.5 * (i_net - base) + random.gauss(0, 0.01)
            # Never emit NaN — every value is finite by construction of the
            # empirical model, but we still round to 6 decimal places so no
            # accidental subnormals leak into the JSON payload.
            await send({
                "type": "swv_data",
                "E": round(E, 6),
                "IForward": round(i_fwd, 6),
                "IReverse": round(i_rev, 6),
                "INet": round(i_fwd - i_rev, 6),
                "time": round(quiet + i * period, 6),
                "index": i,
                "direction": direction,
            })
            await asyncio.sleep(max(0.005, period))
        await send({"type": "swv_done", "points": n})
    except asyncio.CancelledError:
        # Stop mid-sweep: report an explicit idle transition so the frontend
        # never gets stuck in "running" waiting for a done frame.
        await send({"type": "swv_status", "status": "idle"})
        raise


# ────────────────── server ──────────────────

async def _handle(ws, mode: str) -> None:
    task: asyncio.Task | None = None

    async def send(msg: Dict[str, Any]) -> None:
        await ws.send(json.dumps(msg))

    async for raw in ws:
        try:
            msg = json.loads(raw)
        except Exception:
            await send({"type": "swv_error", "message": "Invalid JSON payload."})
            continue
        cmd = msg.get("command")
        if cmd == "start_swv":
            if task and not task.done():
                task.cancel()
            if mode == "simulated":
                task = asyncio.create_task(_stream_swv_simulated(send, msg))
            else:
                await send({"type": "swv_error",
                            "message": "SWV over wifi not yet supported in this bridge build."})
        elif cmd in ("stop", "stop_swv"):
            if task and not task.done():
                task.cancel()
                # Cancellation handler inside _stream_swv_simulated also emits
                # idle — this covers the case where no task is running.
            await send({"type": "swv_status", "status": "idle"})
        else:
            await send({"type": "swv_error",
                        "message": f"Unknown command: {cmd!r}"})


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["simulated", "wifi"], default="simulated")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--esp-url", default=None)
    args = ap.parse_args()
    print(f"[bridge] listening ws://0.0.0.0:{args.port}  mode={args.mode}")
    async with websockets.serve(lambda ws: _handle(ws, args.mode),
                                "0.0.0.0", args.port):
        await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
