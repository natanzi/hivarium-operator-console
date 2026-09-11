import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { AgentCatalogPage } from "./AgentCatalogPage";
import { repository } from "@/data/local-storage-repository";
import { RepositoryProvider } from "@/data/repository-context";

/** Renders the catalog inside a memory router so card links resolve. */
function renderCatalog() {
  const router = createMemoryRouter(
    [{ path: "/agents", element: <AgentCatalogPage /> }],
    { initialEntries: ["/agents"] }
  );
  return render(
    <RepositoryProvider repository={repository}>
      <RouterProvider router={router} />
    </RepositoryProvider>
  );
}

describe("AgentCatalogPage", () => {
  it("renders the page title", () => {
    renderCatalog();
    expect(screen.getByTestId("page-title").textContent).toBe("Agent Catalog");
  });

  it("renders a card for every seeded agent product", async () => {
    renderCatalog();
    expect(
      await screen.findByTestId("agent-card-agent_sentinel")
    ).toBeInTheDocument();
    expect(
      await screen.findByTestId("agent-card-agent_vanguard")
    ).toBeInTheDocument();
  });

  it("shows the product version and plans", async () => {
    renderCatalog();
    const card = await screen.findByTestId("agent-card-agent_sentinel");
    expect(card.textContent).toContain("v2.4.1");
    expect(card.textContent).toContain("Security");
    expect(
      (await screen.findByTestId("agent-plans-agent_sentinel")).textContent
    ).toContain("Growth");
  });

  it("links every card to its agent detail route", async () => {
    renderCatalog();
    const sentinelLink = await screen.findByTestId("agent-link-agent_sentinel");
    expect(sentinelLink).toHaveAttribute("href", "/agents/agent_sentinel");
    const vanguardLink = await screen.findByTestId("agent-link-agent_vanguard");
    expect(vanguardLink).toHaveAttribute("href", "/agents/agent_vanguard");
  });
});