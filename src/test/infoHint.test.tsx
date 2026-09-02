import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { InfoHint } from "@/components/InfoHint";

describe("InfoHint", () => {
  it("exposes the hint text as an accessible name on a real, focusable button", () => {
    render(<InfoHint text="Solution resistance, from the highest-frequency point." />);

    const trigger = screen.getByRole("button", {
      name: "Solution resistance, from the highest-frequency point.",
    });
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).toHaveAttribute("type", "button");
  });

  it("hides the decorative icon from assistive tech (the button's aria-label already carries the text)", () => {
    render(<InfoHint text="Example hint" />);
    const trigger = screen.getByRole("button", { name: "Example hint" });
    const icon = trigger.querySelector("svg");
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });
});
