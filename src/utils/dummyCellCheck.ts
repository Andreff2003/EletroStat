/**
 * ============================================================
 * Dummy Cell Check — instrument/pipeline sanity test
 * ------------------------------------------------------------
 * Compares a Randles fit (Rs/Rct/Cdl) measured from a known
 * test circuit (fixed resistors + capacitor instead of a real
 * electrode) against the circuit's known component values.
 * A close match means the ESP32 + bridge + fitting pipeline is
 * trustworthy; a large mismatch flags where to look (hardware,
 * wiring, or the fit itself) before trusting a real sample.
 * ============================================================
 */

export interface DummyCellExpected {
  rsOhm: number;
  rctOhm: number;
  cdlF: number;
}

export type DummyCellVerdict = "green" | "yellow" | "red";

export interface DummyCellParamResult {
  measured: number;
  expected: number;
  errorPct: number;
  verdict: DummyCellVerdict;
}

export interface DummyCellCheckResult {
  rs: DummyCellParamResult;
  rct: DummyCellParamResult;
  cdl: DummyCellParamResult;
  overall: DummyCellVerdict;
}

const GREEN_MAX_ERROR_PCT = 10;
const YELLOW_MAX_ERROR_PCT = 25;

function verdictFor(errorPct: number): DummyCellVerdict {
  const a = Math.abs(errorPct);
  if (a <= GREEN_MAX_ERROR_PCT) return "green";
  if (a <= YELLOW_MAX_ERROR_PCT) return "yellow";
  return "red";
}

function evaluateParam(measured: number, expected: number): DummyCellParamResult {
  const errorPct =
    expected !== 0 ? ((measured - expected) / expected) * 100 : measured === 0 ? 0 : Infinity;
  return { measured, expected, errorPct, verdict: verdictFor(errorPct) };
}

const VERDICT_RANK: Record<DummyCellVerdict, number> = { green: 0, yellow: 1, red: 2 };

export function evaluateDummyCell(
  measured: { Rs: number; Rct: number; Cdl: number },
  expected: DummyCellExpected,
): DummyCellCheckResult {
  const rs = evaluateParam(measured.Rs, expected.rsOhm);
  const rct = evaluateParam(measured.Rct, expected.rctOhm);
  const cdl = evaluateParam(measured.Cdl, expected.cdlF);
  const overall = [rs, rct, cdl].reduce<DummyCellVerdict>(
    (worst, r) => (VERDICT_RANK[r.verdict] > VERDICT_RANK[worst] ? r.verdict : worst),
    "green",
  );
  return { rs, rct, cdl, overall };
}
