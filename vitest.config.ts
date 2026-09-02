import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // react() is needed here (separately from vite.config.ts's TanStack Start
  // setup) so .tsx test files — e.g. component tests under src/test/ — get
  // a proper JSX/Fast-Refresh-free transform under Vitest.
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
