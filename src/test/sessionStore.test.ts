import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  saveSession,
  saveSessionDebounced,
  flushSessionSave,
  loadSession,
  type StoredMeasurement,
} from "@/utils/sessionStore";

const sample: StoredMeasurement[] = [
  {
    id: "eis-1",
    mode: "eis",
    timestamp: 1700000000000,
    concentration: 10,
    source: "simulated",
    params: {} as never,
    raw: [],
    extracted: { Rct: 1200 },
  } as unknown as StoredMeasurement,
];

describe("sessionStore persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves and reloads measurements", () => {
    const onStatus = vi.fn();
    saveSession(sample, onStatus);
    expect(onStatus).toHaveBeenCalledWith("saved");
    expect(loadSession()).toHaveLength(1);
  });

  it("debounces repeated writes into a single save", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem");
    saveSessionDebounced(sample);
    saveSessionDebounced(sample);
    saveSessionDebounced(sample);
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(700);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("reports an error status when storage rejects the write", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    const onStatus = vi.fn();
    flushSessionSave(sample, onStatus);
    expect(onStatus).toHaveBeenCalledWith("error", expect.anything());
    spy.mockRestore();
  });
});
