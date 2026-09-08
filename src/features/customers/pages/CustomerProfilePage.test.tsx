import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { CustomerProfilePage } from "./CustomerProfilePage";
import { repository } from "@/data/local-storage-repository";

/** Renders the page inside a memory router (so useParams resolves) + the repo provider. */
function renderProfilePath(path: string) {
  const url = new URL(path, "http://localhost");
  const router = createMemoryRouter(
    [{ path: "/customers/:customerId", element: <CustomerProfilePage /> }, { path: "*", element: null }],
    { initialEntries: [url.pathname] }
  );
  return render(
    <RepositoryProviderShim>
      <RouterProvider router={router} />
    </RepositoryProviderShim>
  );
}

// Wrap in the repo provider so useRepository resolves to the shared singleton.
function RepositoryProviderShim({ children }: { children: React.ReactNode }) {
  return (
    <RepositoryProvider repository={repository}>{children}</RepositoryProvider>
  );
}

import { RepositoryProvider } from "@/data/repository-context";

describe("CustomerProfilePage", () => {
  it("renders the customer name in the page header", () => {
    renderProfilePath("/customers/cust_northwind");
    expect(screen.getByTestId("page-title").textContent).toBe("Northwind Trading");
  });

  it("shows the overview card with status and seat total", () => {
    renderProfilePath("/customers/cust_northwind");
    const overview = screen.getByTestId("customer-overview");
    expect(overview.textContent).toContain("Active");
    // Northwind has 25 + 40 = 65 active seats
    expect(overview.textContent).toContain("65");
    expect(overview.textContent).toContain("Active seats");
  });

  it("switches tabs and shows the subscriptions table", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_northwind");

    expect(screen.getByTestId("tab-overview")).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByTestId("tab-subscriptions"));
    expect(screen.getByTestId("tab-subscriptions")).toHaveAttribute("aria-selected", "true");

    const panel = screen.getByTestId("panel-subscriptions");
    expect(panel).toBeInTheDocument();
    // Northwind has Courier + Mercator subscriptions
    expect(panel.textContent).toContain("Courier");
    expect(panel.textContent).toContain("Mercator");
    expect(panel.textContent).toContain("Growth");
  });

  it("switches to entitlements and shows the feature list", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_northwind");

    await user.click(screen.getByTestId("tab-entitlements"));
    const panel = screen.getByTestId("panel-entitlements");
    expect(panel).toBeInTheDocument();
    expect(panel.textContent).toContain("sso");
    expect(panel.textContent).toContain("webhooks");
  });

  it("switches to licenses and shows the license list", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_northwind");

    await user.click(screen.getByTestId("tab-licenses"));
    const panel = screen.getByTestId("panel-licenses");
    expect(panel).toBeInTheDocument();
    expect(panel.textContent).toContain("Courier");
    expect(panel.textContent).toContain("active");
  });

  it("shows a not-found state for unknown ids", () => {
    renderProfilePath("/customers/does_not_exist");
    expect(screen.queryByTestId("page-title")).not.toBeInTheDocument();
    expect(screen.getByText("Customer not found")).toBeInTheDocument();
  });
});
