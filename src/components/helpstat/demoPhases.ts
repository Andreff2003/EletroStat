export type DemoPhase = "idle" | "eis" | "cv" | "swv" | "fet" | "done";

export const PHASE_ORDER: DemoPhase[] = ["eis", "cv", "swv", "fet"];

export const PHASE_LABEL: Record<DemoPhase, string> = {
  idle: "",
  eis: "EIS",
  cv: "CV",
  swv: "SWV",
  fet: "BioFET",
  done: "",
};
