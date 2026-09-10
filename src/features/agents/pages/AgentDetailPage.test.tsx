import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { AgentDetailPage } from "./AgentDetailPage";
import {
  createInMemoryRepository,
  type HiveRepository,
} from "@/data/local-storage-repository";
import { RepositoryProvider } from "@/data/repository-context";

/** Renders the detail page inside a memory router + repo provider. */
function renderAgentDetail(
  path: string,
  repository: HiveRepository = createInMemoryRepository().repository
) {
  const url = new URL(path, "http://localhost");
  const router = createMemoryRouter(
    [
      { path: "/agents/:agentProductId", element: <AgentDetailPage /> },
      { path: "*", element: null },
    ],
    { initialEntries: [url.pathname] }
  );
  return render(
    <RepositoryProvider repository={repository}>
      <RouterProvider router={router} />
    </RepositoryProvider>
  );
}

describe("AgentDetailPage", () => {
  it("renders the agent identity and capability", () => {
    renderAgentDetail("/agents/agent_sentinel");
    expect(screen.getByTestId("page-title").textContent).toBe("Sentinel");
    expect(screen.getByTestId("page-title").parentElement?.textContent).toContain(
      "Security"
    );
    const card = screen.getByTestId("agent-detail-card");
    expect(card.textContent).toContain("v2.4.1");
    expect(card.textContent).toContain("agent_sentinel");
    expect(card.textContent).toContain("Autonomous security triage agent");
    expect(screen.getByTestId("agent-detail-plans").textContent).toContain(
      "Growth"
    );
  });

  it("lists customers with current access and links to their profiles", () => {
    renderAgentDetail("/agents/agent_sentinel");
    const link = screen.getByTestId("agent-access-link-grant_meridians_sentinel");
    expect(link).toHaveAttribute("href", "/customers/cust_meridians");
    expect(link.textContent).toBe("Meridians Health");
    const row = screen.getByTestId("agent-access-grant_meridians_sentinel");
    expect(row.textContent).toContain("active");
    expect(row.textContent).toMatch(/Effective (Aug 1|Jul 31), 2026/);
    expect(row.textContent).toContain("No end date");
    expect(row.textContent).toMatch(/Revocation scheduled (Oct 1|Sep 30), 2026/);
  });

  it("shows the empty state when no customer has access", () => {
    renderAgentDetail("/agents/agent_vanguard");
    expect(
      screen.getByTestId("agent-customer-access-empty")
    ).toBeInTheDocument();
  });

  it("renders a not-found state for an unknown agent id", () => {
    renderAgentDetail("/agents/agent_missing");
    expect(screen.getByText("Agent not found")).toBeInTheDocument();
    expect(screen.getByTestId("back-to-agents")).toHaveAttribute(
      "href",
      "/agents"
    );
  });
});