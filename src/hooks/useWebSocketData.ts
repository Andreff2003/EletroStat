import { useState, useEffect, useRef, useCallback } from "react";
import type { EISDataPoint, FETTransferPoint, FETTimePoint } from "./useSimulatedData";
import type { CVDataPoint } from "./useSimulatedCVData";
import { parseCVWebSocketMessage } from "./useSimulatedCVData";

/**
 * ============================================================
 * WEBSOCKET LIVE DATA HOOK
 * ============================================================
 * Connects to your ESP32-S3 WebSocket server and receives
 * real-time sensor data for EIS and BioFET measurements.
 *
 * EXPECTED JSON MESSAGES FROM ESP32:
 *
 * For EIS data:
 *   { "type": "eis", "zReal": 150.3, "zImag": 200.1, "frequency": 1000, "zMag": 250.2, "phase": -53.1 }
 *
 * For FET transfer curve:
 *   { "type": "fet_transfer", "vg": 0.5, "id": 12.3, "curve": "baseline" }
 *   { "type": "fet_transfer", "vg": 0.5, "id": 10.1, "curve": "analyte" }
 *
 * For FET time response:
 *   { "type": "fet_time", "time": 5.2, "id": 24.8 }
 *
 * Control commands (sent TO ESP32):
 *   { "command": "start_eis" }
 *   { "command": "start_fet" }
 *   { "command": "stop" }
 * ============================================================
 */

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

interface UseWebSocketDataReturn {
  // Connection
  status: ConnectionStatus;
  connect: (url: string) => void;
  disconnect: () => void;
  errorMessage: string;

  // EIS data
  eisData: EISDataPoint[];
  clearEIS: () => void;
  lastFilename: string;

  // FET data
  fetBaseline: FETTransferPoint[];
  fetAnalyte: FETTransferPoint[];
  fetTimeData: FETTimePoint[];
  clearFET: () => void;

  // CV data
  cvData: CVDataPoint[];
  clearCV: () => void;
  cvStatus: "idle" | "running" | "done" | "error";
  cvError: string | null;

  // Send commands to ESP32
  sendCommand: (command: string, payload?: Record<string, unknown>) => void;
}

export function useWebSocketData(): UseWebSocketDataReturn {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [errorMessage, setErrorMessage] = useState("");

  const [eisData, setEisData] = useState<EISDataPoint[]>([]);
  const [lastFilename, setLastFilename] = useState("");
  const [fetBaseline, setFetBaseline] = useState<FETTransferPoint[]>([]);
  const [fetAnalyte, setFetAnalyte] = useState<FETTransferPoint[]>([]);
  const [fetTimeData, setFetTimeData] = useState<FETTimePoint[]>([]);
  const [cvData, setCvData] = useState<CVDataPoint[]>([]);
  const [cvStatus, setCvStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [cvError, setCvError] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    setStatus("disconnected");
  }, []);

  const connect = useCallback((url: string) => {
    // Close any existing connection
    if (socketRef.current) {
      socketRef.current.close();
    }

    setStatus("connecting");
    setErrorMessage("");

    try {
      const ws = new WebSocket(url);
      socketRef.current = ws;

      ws.onopen = () => {
        setStatus("connected");
        setErrorMessage("");
      };

      ws.onclose = () => {
        setStatus("disconnected");
      };

      ws.onerror = () => {
        setStatus("error");
        setErrorMessage("Could not connect. Check the IP address and that the ESP32 is on.");
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          switch (msg.type) {
            case "eis":
              if (msg.filename) {
                setLastFilename(msg.filename);
              }
              setEisData((prev) => [
                ...prev,
                {
                  zReal: msg.zReal,
                  zImag: msg.zImag,
                  frequency: msg.frequency,
                  zMag: msg.zMag ?? Math.sqrt(msg.zReal ** 2 + msg.zImag ** 2),
                  phase: msg.phase ?? Math.atan2(-msg.zImag, msg.zReal) * (180 / Math.PI),
                },
              ]);
              break;

            case "fet_transfer":
              if (msg.curve === "analyte") {
                setFetAnalyte((prev) => [...prev, { vg: msg.vg, id: msg.id }]);
              } else {
                setFetBaseline((prev) => [...prev, { vg: msg.vg, id: msg.id }]);
              }
              break;

            case "fet_time":
              setFetTimeData((prev) => [...prev, { time: msg.time, id: msg.id }]);
              break;

            case "cv_data": {
              const pt = parseCVWebSocketMessage(msg);
              if (!pt) {
                console.warn("[ws] cv_data ignored — invalid frame", msg);
                break;
              }
              setCvData((prev) => [...prev, pt]);
              break;
            }

            case "cv_status": {
              const s = msg.status;
              if (s === "idle" || s === "running" || s === "done" || s === "error") {
                setCvStatus(s);
                if (s !== "error") setCvError(null);
              }
              break;
            }

            case "cv_done":
              setCvStatus("done");
              break;

            case "cv_error":
              setCvStatus("error");
              setCvError(typeof msg.message === "string" ? msg.message : "Unknown CV error");
              console.warn("[ws] cv_error", msg);
              break;

            default:
              // Unknown message type — ignore
              break;
          }
        } catch {
          // Non-JSON message — ignore
        }
      };
    } catch {
      setStatus("error");
      setErrorMessage("Invalid WebSocket URL.");
    }
  }, []);

  const sendCommand = useCallback((command: string, payload?: Record<string, unknown>) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ command, ...(payload ?? {}) }));
    }
  }, []);

  const clearEIS = useCallback(() => {
    setEisData([]);
    setLastFilename("");
  }, []);
  const clearFET = useCallback(() => {
    setFetBaseline([]);
    setFetAnalyte([]);
    setFetTimeData([]);
  }, []);
  const clearCV = useCallback(() => {
    setCvData([]);
    setCvStatus("idle");
    setCvError(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      socketRef.current?.close();
    };
  }, []);

  return {
    status,
    connect,
    disconnect,
    errorMessage,
    eisData,
    clearEIS,
    lastFilename,
    fetBaseline,
    fetAnalyte,
    fetTimeData,
    clearFET,
    cvData,
    clearCV,
    cvStatus,
    cvError,
    sendCommand,
  };
}

