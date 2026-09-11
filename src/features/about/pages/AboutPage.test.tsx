import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AboutPage } from "./AboutPage";
import { repository } from "@/data/local-storage-repository";

describe("AboutPage", () => {
  it("renders the page title", () => {
    render(<AboutPage />);
    expect(screen.getByTestId("page-title").textContent).toBe("About");
  });

  it("describes the product and surfaces", () => {
    render(<AboutPage />);
    expect(
      screen.getByTestId("about-card").textContent
    ).toContain("Hivarium Operator Console");
    expect(screen.getByTestId("about-card").textContent).toContain("Phase");
  });

  it("reflects the live agent product count from the repository", async () => {
    const count = (await repository.listAgentProducts()).length;
    render(<AboutPage />);
    expect(await screen.findByText(String(count))).toBeInTheDocument();
  });
});
