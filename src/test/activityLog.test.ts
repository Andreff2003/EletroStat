import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  logActivity,
  getActivityLog,
  clearActivityLog,
  subscribeActivityLog,
  formatTimestamp,
} from "@/utils/activityLog";

// `entries` is module-level singleton state (mirrors localStorage), so every
// test starts from a clean slate regardless of execution order.
beforeEach(() => {
  clearActivityLog();
});

describe("activityLog", () => {
  it("starts empty", () => {
    expect(getActivityLog()).toEqual([]);
  });

  it("appends entries in order with the given category and message", () => {
    logActivity("connection", "Connected to ws://127.0.0.1:81");
    logActivity("measurement", "EIS sweep complete");

    const log = getActivityLog();
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ category: "connection", message: "Connected to ws://127.0.0.1:81" });
    expect(log[1]).toMatchObject({ category: "measurement", message: "EIS sweep complete" });
    expect(typeof log[0].timestamp).toBe("number");
  });

  it("getActivityLog returns a copy, not the live array", () => {
    logActivity("system", "boot");
    const log = getActivityLog();
    log.push({ timestamp: 0, category: "system", message: "tampered" });
    expect(getActivityLog()).toHaveLength(1);
  });

  it("clearActivityLog empties the log", () => {
    logActivity("sample", "Injected sample #1");
    expect(getActivityLog()).toHaveLength(1);
    clearActivityLog();
    expect(getActivityLog()).toEqual([]);
  });

  it("notifies subscribers on log and clear, and stops after unsubscribing", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeActivityLog(listener);

    logActivity("calibration", "Added calibration point");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(
      expect.arrayContaining([expect.objectContaining({ message: "Added calibration point" })]),
    );

    clearActivityLog();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith([]);

    unsubscribe();
    logActivity("system", "should not notify");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("formatTimestamp renders a 'yyyy-MM-dd HH:mm:ss' string", () => {
    const formatted = formatTimestamp(Date.now());
    expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});
