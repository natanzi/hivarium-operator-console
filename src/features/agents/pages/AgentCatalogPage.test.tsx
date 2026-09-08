import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AgentCatalogPage } from "./AgentCatalogPage";
import { renderWithRepository } from "@/test/render";

describe("AgentCatalogPage", () => {
  it("renders the page title", () => {
    renderWithRepository(<AgentCatalogPage />);
    expect(screen.getByTestId("page-title").textContent).toBe("Agent Catalog");
  });

  it("renders a card for every seeded agent product", () => {
    renderWithRepository(<AgentCatalogPage />);
    expect(screen.getByTestId("agent-card-agent_sentinel")).toBeInTheDocument();
    expect(screen.getByTestId("agent-card-agent_vanguard")).toBeInTheDocument();
  });

  it("shows the product version and plans", () => {
    renderWithRepository(<AgentCatalogPage />);
    const card = screen.getByTestId("agent-card-agent_sentinel");
    expect(card.textContent).toContain("v2.4.1");
    expect(card.textContent).toContain("Security");
    expect(screen.getByTestId("agent-plans-agent_sentinel").textContent).toContain(
      "Growth"
    );
  });
});
