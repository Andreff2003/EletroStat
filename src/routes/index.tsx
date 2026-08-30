import { createFileRoute } from "@tanstack/react-router";
import IndexPage from "@/components/helpstat/IndexPage";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster as Sonner } from "@/components/ui/sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ElectroStat — EIS, CV, SWV & BioFET Biosensor Dashboard" },
      {
        name: "description",
        content:
          "ElectroStat: real-time electrochemistry dashboard for ESP32-S3/AD5941 biosensors — EIS with CNLS Randles fitting, cyclic and square-wave voltammetry, BioFET analysis, calibration with LOD/LOQ and CSV export.",
      },
      { property: "og:title", content: "ElectroStat — EIS, CV, SWV & BioFET Biosensor Dashboard" },
      {
        property: "og:description",
        content:
          "Real-time electrochemistry dashboard for ESP32-S3/AD5941 biosensors: EIS, CV, SWV and BioFET with fitting, calibration and CSV export.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <TooltipProvider>
      <Sonner />
      <IndexPage />
    </TooltipProvider>
  );
}
