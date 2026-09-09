import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { CustomerProfilePage } from "./CustomerProfilePage";
import { createInMemoryRepository } from "@/data/local-storage-repository";
import { RepositoryProvider } from "@/data/repository-context";
import { SEED_NOW } from "@/data/seed-data";

/** Renders the page inside a memory router (so useParams resolves) + the repo provider. */
function renderProfilePath(
  path: string,
  repository = createInMemoryRepository().repository
) {
  const url = new URL(path, "http://localhost");
  const router = createMemoryRouter(
    [
      { path: "/customers/:customerId", element: <CustomerProfilePage /> },
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

describe("CustomerProfilePage", () => {
  it("renders the customer name in the page header", () => {
    renderProfilePath("/customers/cust_northwind");
    expect(screen.getByTestId("page-title").textContent).toBe("Northwind Trading");
  });

  it("shows the overview card with status and active agent count", () => {
    renderProfilePath("/customers/cust_northwind");
    const overview = screen.getByTestId("customer-overview");
    expect(overview.textContent).toContain("Active");
    expect(overview.textContent).toContain("Active agents");
    // Northwind has two active grants (Courier + Mercator)
    expect(overview.textContent).toContain("2");
  });

  it("shows feature entitlements on the overview tab", () => {
    renderProfilePath("/customers/cust_northwind");
    const panel = screen.getByTestId("panel-overview");
    expect(panel.textContent).toContain("sso");
    expect(panel.textContent).toContain("webhooks");
  });

  it("switches to the commercial tab and shows the active arrangement", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_northwind");

    await user.click(screen.getByTestId("tab-commercial"));
    const panel = screen.getByTestId("panel-commercial");
    expect(panel).toBeVisible();
    expect(panel.textContent).toContain("Monthly");
    expect(panel.textContent).toContain("$149.00");
  });

  it("shows the exact empty state when no commercial model is active", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_greyharbor");

    await user.click(screen.getByTestId("tab-commercial"));
    const panel = screen.getByTestId("panel-commercial");
    expect(panel).toBeVisible();
    expect(panel.textContent).toContain("No commercial model is active");
    expect(panel.textContent).toContain(
      "Choose how this customer uses Hivarium before granting agent access."
    );
  });

  it("creates a monthly commercial arrangement through the form", async () => {
    const user = userEvent.setup();
    const { repository } = createInMemoryRepository();
    renderProfilePath("/customers/cust_greyharbor", repository);

    await user.click(screen.getByTestId("tab-commercial"));
    await user.type(screen.getByTestId("monthly-amount"), "199");
    await user.type(screen.getByTestId("renews-at"), "2027-01-01");
    await user.type(
      screen.getByTestId("arrangement-reason"),
      "Test monthly arrangement"
    );
    await user.click(screen.getByTestId("submit-monthly-arrangement"));

    const snapshot = repository.getCommercialSnapshot(
      "cust_greyharbor",
      SEED_NOW
    );
    expect(snapshot.active).not.toBeNull();
    expect(snapshot.active?.model).toBe("monthly");
    if (snapshot.active?.model === "monthly") {
      expect(snapshot.active.monthlyAmountCents).toBe(19900);
    }
  });

  it("switches to the agent access tab and shows current grants", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_northwind");

    await user.click(screen.getByTestId("tab-agent-access"));
    const panel = screen.getByTestId("panel-agent-access");
    expect(panel).toBeVisible();
    expect(panel.textContent).toContain("Courier");
    expect(panel.textContent).toContain("Mercator");
  });

  it("grants agent access through the form", async () => {
    const user = userEvent.setup();
    const { repository } = createInMemoryRepository();
    renderProfilePath("/customers/cust_greyharbor", repository);

    await user.click(screen.getByTestId("tab-agent-access"));
    await user.click(screen.getByTestId("agent-product-trigger"));
    await user.click(await screen.findByRole("option", { name: "Sentinel" }));
    await user.type(screen.getByTestId("access-reason"), "Test grant");
    await user.click(screen.getByTestId("submit-agent-access"));

    const snapshot = repository.getAgentAccessSnapshot(
      "cust_greyharbor",
      SEED_NOW
    );
    expect(
      snapshot.current.some((g) => g.agentProductId === "agent_sentinel")
    ).toBe(true);
  });

  it("shows the activity timeline", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_northwind");

    await user.click(screen.getByTestId("tab-activity"));
    const panel = screen.getByTestId("panel-activity");
    expect(panel).toBeVisible();
    expect(panel.textContent).toContain("commercial.created");
    expect(panel.textContent).toContain("access.granted");
  });

  it("shows a not-found state for unknown ids", () => {
    renderProfilePath("/customers/does_not_exist");
    expect(screen.queryByTestId("page-title")).not.toBeInTheDocument();
    expect(screen.getByText("Customer not found")).toBeInTheDocument();
  });
});