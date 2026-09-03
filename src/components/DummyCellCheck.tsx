import { useState } from "react";
import { Beaker } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { InfoHint } from "@/components/InfoHint";
import { formatParamValue } from "@/utils/eisFit";
import { evaluateDummyCell, type DummyCellCheckResult, type DummyCellVerdict } from "@/utils/dummyCellCheck";

interface Props {
  /** Best available Randles fit (CNLS preferred, auto-fit fallback) for the current EIS sweep. */
  measured: { Rs: number; Rct: number; Cdl: number } | null;
}

const VERDICT_COLOR: Record<DummyCellVerdict, string> = {
  green: "text-graph-eis",
  yellow: "text-yellow-500",
  red: "text-destructive",
};
const VERDICT_LABEL: Record<DummyCellVerdict, string> = {
  green: "OK",
  yellow: "ATENÇÃO",
  red: "FALHA",
};

export function DummyCellCheck({ measured }: Props) {
  const [rsExpected, setRsExpected] = useState(100);
  const [rctExpected, setRctExpected] = useState(10000);
  const [cdlExpectedNF, setCdlExpectedNF] = useState(100);
  const [result, setResult] = useState<DummyCellCheckResult | null>(null);

  const runCheck = () => {
    if (!measured) return;
    setResult(
      evaluateDummyCell(measured, {
        rsOhm: rsExpected,
        rctOhm: rctExpected,
        cdlF: cdlExpectedNF * 1e-9,
      }),
    );
  };

  const rows = result
    ? [
        { label: "Rs", unit: "Ω", ...result.rs },
        { label: "Rct", unit: "Ω", ...result.rct },
        { label: "Cdl", unit: "F", ...result.cdl },
      ]
    : [];

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-3">
      <h3 className="text-sm font-mono text-muted-foreground flex items-center gap-1.5">
        <Beaker className="h-3.5 w-3.5" />
        Dummy Cell Check
        <InfoHint text="Liga um circuito de teste com resistências/condensador de valor conhecido em vez do elétrodo, corre um sweep de EIS normal, e compara o Rs/Rct/Cdl medido com o valor esperado — confirma que o ESP32 e o ajuste estão fiáveis antes de confiares numa amostra real." />
      </h3>

      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1">
          <Label className="text-[10px] font-mono text-muted-foreground uppercase">Rs esperado (Ω)</Label>
          <Input
            type="number"
            value={rsExpected}
            onChange={(e) => setRsExpected(Number(e.target.value))}
            className="h-8 font-mono text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] font-mono text-muted-foreground uppercase">Rct esperado (Ω)</Label>
          <Input
            type="number"
            value={rctExpected}
            onChange={(e) => setRctExpected(Number(e.target.value))}
            className="h-8 font-mono text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] font-mono text-muted-foreground uppercase">Cdl esperado (nF)</Label>
          <Input
            type="number"
            value={cdlExpectedNF}
            onChange={(e) => setCdlExpectedNF(Number(e.target.value))}
            className="h-8 font-mono text-xs"
          />
        </div>
      </div>

      <Button size="sm" onClick={runCheck} disabled={!measured} className="font-mono text-xs w-full">
        Verificar com o fit EIS atual
      </Button>
      {!measured && (
        <p className="text-[10px] text-muted-foreground">
          Faz um sweep de EIS ao dummy cell e ajusta o circuito de Randles (auto ou CNLS) para poderes verificar.
        </p>
      )}

      {result && (
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between bg-secondary rounded-md p-2">
              <div className="flex flex-col">
                <span className="text-[10px] font-mono text-muted-foreground uppercase">{r.label}</span>
                <span className="text-sm font-mono text-foreground">
                  {formatParamValue(r.label, r.measured, r.unit)}
                  <span className="text-muted-foreground">
                    {" "}/ esperado {formatParamValue(r.label, r.expected, r.unit)}
                  </span>
                </span>
              </div>
              <span className={`text-xs font-mono ${VERDICT_COLOR[r.verdict]}`}>
                {Number.isFinite(r.errorPct) ? `${r.errorPct >= 0 ? "+" : ""}${r.errorPct.toFixed(1)}%` : "—"}
              </span>
            </div>
          ))}
          <div className="text-xs font-mono pt-1">
            Veredito geral:{" "}
            <span className={`uppercase ${VERDICT_COLOR[result.overall]}`}>{VERDICT_LABEL[result.overall]}</span>
          </div>
        </div>
      )}
    </div>
  );
}
