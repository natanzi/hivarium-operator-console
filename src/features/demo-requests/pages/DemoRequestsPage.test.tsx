import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DemoRequestsPage } from "./DemoRequestsPage";

describe("DemoRequestsPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows an empty state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    render(<DemoRequestsPage />);
    expect(await screen.findByTestId("demo-requests-empty")).toBeInTheDocument();
  });

  it("renders a request row", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [
              {
                id: "dreq_1",
                publicReference: "HV-DEMO-1",
                status: "submitted",
                organizationName: "Acme Research",
                applicantName: "Ada Lovelace",
                applicantEmail: "ada@acme.example",
                useCase: "Evaluate private agent governance.",
                expectedAgentCount: "1-5",
                submittedAt: "2026-09-14T00:00:00.000Z",
                deploymentPreference: "on_premises",
                provisioningStatus: "not_started",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    render(<DemoRequestsPage />);
    expect(await screen.findByTestId("demo-row-dreq_1")).toHaveTextContent("Acme Research");
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("ada@acme.example")).toBeInTheDocument();
    expect(screen.getByText("Review")).toBeInTheDocument();
  });

  it("shows an error state with retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "http-error", message: "upstream down" } }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    render(<DemoRequestsPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load demo requests");
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument());
  });
});
