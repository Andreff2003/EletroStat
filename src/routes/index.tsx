import { createFileRoute } from "@tanstack/react-router";
import IndexPage from "@/components/helpstat/IndexPage";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster as Sonner } from "@/components/ui/sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ElectroStat — Biosensor Dashboard" },
      { name: "description", content: "ElectroStat Biosensor Dashboard" },
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
