import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { toast, Toaster } from "sonner";
import { afterEach, describe, expect, it } from "vitest";

import { CustomerProfilePage } from "./CustomerProfilePage";
import { ReversalSheet } from "@/features/customers/components/ReversalSheet";
import {
  createInMemoryRepository,
  type HiveRepository,
} from "@/data/local-storage-repository";
import { RepositoryProvider } from "@/data/repository-context";
import { SEED_NOW } from "@/data/seed-data";

const STORAGE_KEY = "hivarium.operator-console.store.v1";

// Sonner keeps a module-global toast store, so a toast fired in one test
// would otherwise still be rendered by the next test's <Toaster /> and make
// `findByText` queries ambiguous. Dismiss every toast after each test.
afterEach(() => {
  toast.dismiss();
});

/** Renders the page inside a memory router + repo provider + toast surface. */
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
      <Toaster position="bottom-right" />
    </RepositoryProvider>
  );
}

/** Opens the commercial drawer from the Overview primary action. */
async function openCommercialSheet(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("overview-commercial-action"));
  return screen.findByTestId("commercial-sheet");
}

/** Opens the grant drawer from the Agent Access tab. */
async function openAccessSheet(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("tab-agent-access"));
  await user.click(screen.getByTestId("grant-agent-access"));
  return screen.findByTestId("access-sheet");
}

/** Opens the Record usage sheet from the Activity tab. */
async function openUsageSheet(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("tab-activity"));
  await user.click(screen.getByTestId("record-usage"));
  return screen.findByTestId("record-usage-sheet");
}

/** Opens the Adjust balance sheet from the Commercial tab. */
async function openAdjustmentSheet(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("tab-commercial"));
  await user.click(screen.getByTestId("adjust-balance"));
  return screen.findByTestId("adjustment-sheet");
}

/**
 * Opens the Reverse transaction sheet from the Activity tab by clicking the
 * per-row "Reverse transaction" action for `transactionId`. Defaults to the
 * seeded opening credit so the shared reversal flows keep their original
 * target.
 */
async function openReversalSheet(
  user: ReturnType<typeof userEvent.setup>,
  transactionId = "txn_opening_arr_meridians_prepaid"
) {
  await user.click(screen.getByTestId("tab-activity"));
  await user.click(screen.getByTestId(`reverse-${transactionId}`));
  return screen.findByTestId("reversal-sheet");
}

/** Selects the Sentinel agent inside the Record usage sheet. */
async function chooseUsageAgent(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("usage-agent-trigger"));
  await user.click(screen.getByTestId("usage-agent-option-agent_sentinel"));
}

describe("CustomerProfilePage", () => {
  // -------------------------------------------------------------------------
  // Tabs
  // -------------------------------------------------------------------------

  it("renders exactly four tabs with the approved labels", () => {
    renderProfilePath("/customers/cust_northwind");
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(4);
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Overview",
      "Commercial",
      "Agent Access",
      "Activity",
    ]);
  });

  it("links each tab trigger to its tabpanel", () => {
    renderProfilePath("/customers/cust_northwind");
    const overviewTab = screen.getByRole("tab", { name: "Overview" });
    const overviewPanel = screen.getByRole("tabpanel", { name: "Overview" });
    expect(overviewTab).toHaveAttribute("aria-controls", overviewPanel.id);
    expect(overviewPanel).toHaveAttribute("aria-labelledby", overviewTab.id);
  });

  it("supports arrow-key navigation between tabs", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_northwind");
    screen.getByRole("tab", { name: "Overview" }).focus();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Commercial" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Agent Access" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Activity" })).toHaveFocus();
    // Wraps back to the first tab.
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Activity" })).toHaveFocus();
  });

  it("supports Home and End keyboard navigation", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_northwind");
    screen.getByRole("tab", { name: "Agent Access" }).focus();

    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Activity" })).toHaveFocus();
  });

  // -------------------------------------------------------------------------
  // Overview tab
  // -------------------------------------------------------------------------

  it("shows lifecycle, active model, value, important date, agent count and primary action", () => {
    renderProfilePath("/customers/cust_northwind");
    const band = screen.getByTestId("overview-summary-band");
    expect(band).toHaveTextContent("Active");
    expect(band).toHaveTextContent("Monthly");
    expect(band).toHaveTextContent("$149.00 / month");
    expect(band).toHaveTextContent("Renews Mar 14, 2026");
    expect(band).toHaveTextContent("2");
    expect(
      screen.getByRole("button", { name: "Change commercial model" })
    ).toBeInTheDocument();
  });

  it("shows Set commercial model when no arrangement exists", () => {
    renderProfilePath("/customers/cust_greyharbor");
    const band = screen.getByTestId("overview-summary-band");
    expect(band).toHaveTextContent("No commercial model");
    expect(
      screen.getByRole("button", { name: "Set commercial model" })
    ).toBeInTheDocument();
  });

  it("shows the scheduled change date when a successor is scheduled", () => {
    renderProfilePath("/customers/cust_meridians");
    const band = screen.getByTestId("overview-summary-band");
    expect(band).toHaveTextContent("Prepaid");
    expect(band).toHaveTextContent("250,000 tokens");
    expect(band).toHaveTextContent(/Scheduled change (Dec 1|Nov 30), 2026/);
  });

  it("shows contact details, notes and feature entitlements with expiry bounds", () => {
    renderProfilePath("/customers/cust_bluepeak");
    const panel = screen.getByTestId("panel-overview");
    expect(panel).toHaveTextContent("Marcus Oyelaran");
    expect(panel).toHaveTextContent("marcus.oyelaran@bluepeak.example");
    expect(panel).toHaveTextContent("bluepeak.example");
    expect(panel).toHaveTextContent("sso");
    expect(panel).toHaveTextContent("audit_log");
    expect(panel).toHaveTextContent("priority_support");
    expect(panel).toHaveTextContent("Expires Feb 15, 2026");
    expect(panel).toHaveTextContent("No expiry");
  });

  it("uses singular grammar for one active agent", () => {
    renderProfilePath("/customers/cust_meridians");
    const band = screen.getByTestId("overview-summary-band");
    expect(band).toHaveTextContent("Active agent");
    expect(band).not.toHaveTextContent("Active agents");
  });

  // -------------------------------------------------------------------------
  // Commercial tab
  // -------------------------------------------------------------------------

  it("shows the active monthly arrangement terms", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_northwind");
    await user.click(screen.getByTestId("tab-commercial"));
    const card = screen.getByTestId("active-arrangement");
    expect(card).toHaveTextContent("Monthly");
    expect(card).toHaveTextContent("$149.00");
    expect(card).toHaveTextContent("Next renewal");
    expect(card).toHaveTextContent("Mar 14, 2026");
  });

  it("shows the active prepaid arrangement terms", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_meridians");
    await user.click(screen.getByTestId("tab-commercial"));
    const card = screen.getByTestId("active-arrangement");
    expect(card).toHaveTextContent("Prepaid");
    expect(card).toHaveTextContent("250,000 tokens");
    expect(card).toHaveTextContent("No expiry");
    expect(card).toHaveTextContent(
      "Prepaid balance loaded during the consolidation pause."
    );
  });

  it("shows the scheduled change strip with Review action", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_meridians");
    await user.click(screen.getByTestId("tab-commercial"));
    const strip = screen.getByTestId("scheduled-change");
    expect(strip).toHaveTextContent("Scheduled change");
    expect(strip).toHaveTextContent(/Effective (Dec 1|Nov 30), 2026/);
    expect(strip).toHaveTextContent("Monthly");
    expect(screen.getByTestId("review-scheduled-change")).toBeInTheDocument();
  });

  it("shows arrangement history newest first", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_greyharbor");
    await user.click(screen.getByTestId("tab-commercial"));
    const panel = screen.getByTestId("panel-commercial");
    const rows = within(panel).getAllByRole("row");
    // Header row first, then monthly (2024) before annual (2021).
    expect(rows[1]).toHaveTextContent("monthly");
    expect(rows[1]).toHaveTextContent("terminated");
    expect(rows[rows.length - 1]).toHaveTextContent("annual");
    expect(rows[rows.length - 1]).toHaveTextContent("ended");
  });

  it("shows the exact empty state when no commercial model is active", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_greyharbor");
    await user.click(screen.getByTestId("tab-commercial"));
    const panel = screen.getByTestId("panel-commercial");
    expect(panel).toHaveTextContent("No commercial model is active");
    expect(panel).toHaveTextContent(
      "Choose how this customer uses Hivarium before granting agent access."
    );
  });

  it("shows Not recorded for absent annual renewal posture", async () => {
    const user = userEvent.setup();
    const { repository } = createInMemoryRepository();
    repository.saveCommercialArrangement(
      {
        id: "arr_test_annual",
        customerId: "cust_greyharbor",
        model: "annual",
        status: "active",
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        effectiveTo: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        reason: "Test annual",
        currency: "USD",
        contractValueCents: 100000,
        startsAt: "2026-01-01T00:00:00.000Z",
        endsAt: "2027-01-01T00:00:00.000Z",
        includedAllowance: 1000,
        allowanceUnit: "tokens",
        overageRateCentsPerUnit: 2,
      },
      "2026-01-01T00:00:00.000Z"
    );
    renderProfilePath("/customers/cust_greyharbor", repository);
    await user.click(screen.getByTestId("tab-commercial"));
    const card = screen.getByTestId("active-arrangement");
    expect(card).toHaveTextContent("Not recorded");
  });

  it("opens a read-only record dialog from history", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_greyharbor");
    await user.click(screen.getByTestId("tab-commercial"));
    await user.click(screen.getByTestId("view-record-arr_greyharbor_annual"));
    const dialog = screen.getByTestId("arrangement-record-dialog");
    expect(dialog).toHaveTextContent("Annual contract arrangement record");
    expect(dialog).toHaveTextContent("$12000.00");
    expect(dialog).toHaveTextContent("500,000 tokens");
    expect(dialog).toHaveTextContent("arr_greyharbor_annual");
  });

  // -------------------------------------------------------------------------
  // Commercial drawer
  // -------------------------------------------------------------------------

  it("opens the commercial drawer from the Overview primary action", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_greyharbor");
    await openCommercialSheet(user);
    expect(
      screen.getByRole("heading", { name: "Set commercial model" })
    ).toBeInTheDocument();
  });

  it("creates a monthly arrangement through the drawer", async () => {
    const user = userEvent.setup();
    const { repository } = createInMemoryRepository();
    renderProfilePath("/customers/cust_greyharbor", repository);

    await openCommercialSheet(user);
    await user.type(screen.getByTestId("monthly-amount"), "199");
    await user.type(screen.getByTestId("renews-at"), "2027-01-01");
    await user.type(
      screen.getByTestId("arrangement-reason"),
      "Test monthly arrangement"
    );
    await user.click(screen.getByTestId("submit-commercial-arrangement"));

    await waitFor(() =>
      expect(screen.queryByTestId("commercial-sheet")).not.toBeInTheDocument()
    );
    expect(
      await screen.findByText("Commercial model started")
    ).toBeInTheDocument();

    const snapshot = repository.getCommercialSnapshot(
      "cust_greyharbor",
      SEED_NOW
    );
    expect(snapshot.active?.model).toBe("monthly");
    if (snapshot.active?.model === "monthly") {
      expect(snapshot.active.monthlyAmountCents).toBe(19900);
    }
  });

  it("creates a prepaid arrangement through the drawer", async () => {
    const user = userEvent.setup();
    const { repository } = createInMemoryRepository();
    renderProfilePath("/customers/cust_greyharbor", repository);

    await openCommercialSheet(user);
    await user.click(screen.getByLabelText(/Prepaid/));
    await user.type(
      screen.getByTestId("arrangement-reason"),
      "Prepaid load"
    );
    await user.click(screen.getByTestId("submit-commercial-arrangement"));

    await waitFor(() =>
      expect(screen.queryByTestId("commercial-sheet")).not.toBeInTheDocument()
    );

    const snapshot = repository.getCommercialSnapshot(
      "cust_greyharbor",
      SEED_NOW
    );
    expect(snapshot.active?.model).toBe("prepaid");
    if (snapshot.active?.model === "prepaid") {
      expect(snapshot.active.warningThresholdTokens).toBe(100);
    }
  });

  it("creates an annual arrangement through the drawer", async () => {
    const user = userEvent.setup();
    const { repository } = createInMemoryRepository();
    renderProfilePath("/customers/cust_greyharbor", repository);

    await openCommercialSheet(user);
    await user.click(screen.getByLabelText(/Annual contract/));
    await user.type(screen.getByTestId("annual-value"), "12000");
    await user.type(screen.getByTestId("annual-start"), "2026-01-01");
    await user.type(screen.getByTestId("annual-end"), "2027-01-01");
    await user.type(screen.getByTestId("annual-allowance"), "100000");
    await user.type(screen.getByTestId("annual-overage"), "0.02");
    await user.type(
      screen.getByTestId("arrangement-reason"),
      "Annual deal"
    );
    await user.click(screen.getByTestId("submit-commercial-arrangement"));

    await waitFor(() =>
      expect(screen.queryByTestId("commercial-sheet")).not.toBeInTheDocument()
    );

    const snapshot = repository.getCommercialSnapshot(
      "cust_greyharbor",
      SEED_NOW
    );
    expect(snapshot.active?.model).toBe("annual");
    if (snapshot.active?.model === "annual") {
      expect(snapshot.active.contractValueCents).toBe(1200000);
      expect(snapshot.active.includedAllowance).toBe(100000);
      expect(snapshot.active.allowanceUnit).toBe("tokens");
      expect(snapshot.active.overageRateCentsPerUnit).toBe(2);
    }
  });

  it("schedules a commercial change and keeps the current arrangement active", async () => {
    const user = userEvent.setup();
    const { repository } = createInMemoryRepository();
    renderProfilePath("/customers/cust_northwind", repository);

    await openCommercialSheet(user);
    fireEvent.click(screen.getByLabelText("Schedule for date"));
    await user.clear(screen.getByTestId("monthly-amount"));
    await user.type(screen.getByTestId("monthly-amount"), "249");
    await user.type(screen.getByTestId("effective-date"), "2026-12-01");
    const renewsAt = screen.getByTestId("renews-at");
    await user.clear(renewsAt);
    await user.type(renewsAt, "2027-12-01");
    await user.type(
      screen.getByTestId("arrangement-reason"),
      "Scheduled upgrade"
    );
    await user.click(screen.getByTestId("submit-commercial-arrangement"));

    await waitFor(() =>
      expect(screen.queryByTestId("commercial-sheet")).not.toBeInTheDocument()
    );
    expect(
      await screen.findByText("Commercial model scheduled")
    ).toBeInTheDocument();

    const snapshot = repository.getCommercialSnapshot(
      "cust_northwind",
      SEED_NOW
    );
    expect(snapshot.active?.model).toBe("monthly");
    expect(snapshot.scheduled?.model).toBe("monthly");
    if (snapshot.scheduled?.model === "monthly") {
      expect(snapshot.scheduled.monthlyAmountCents).toBe(24900);
      expect(snapshot.scheduled.effectiveFrom).toBe("2026-12-01T00:00:00.000Z");
    }
  });

  it("discloses that the current arrangement will move to history", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_northwind");
    await openCommercialSheet(user);
    expect(
      screen.getByText(/The current Monthly arrangement will move to history/)
    ).toBeInTheDocument();
  });

  it("opens the drawer in review mode from the scheduled change strip", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_meridians");
    await user.click(screen.getByTestId("tab-commercial"));
    await user.click(screen.getByTestId("review-scheduled-change"));
    expect(await screen.findByTestId("commercial-sheet")).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Review scheduled change" })
    ).toBeInTheDocument();
    expect(screen.getByTestId("monthly-amount")).toHaveValue(149);
    expect(
      screen.getByText(/The scheduled Monthly change will be replaced/)
    ).toBeInTheDocument();
  });

  it("blocks negative money inline", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_greyharbor");
    await openCommercialSheet(user);
    fireEvent.change(screen.getByTestId("monthly-amount"), {
      target: { value: "-5" },
    });
    await user.type(screen.getByTestId("renews-at"), "2027-01-01");
    await user.type(screen.getByTestId("arrangement-reason"), "Test");
    await user.click(screen.getByTestId("submit-commercial-arrangement"));
    expect(
      screen.getByText("Monthly amount must be greater than zero.")
    ).toBeInTheDocument();
    expect(screen.getByTestId("commercial-sheet")).toBeInTheDocument();
  });

  it("blocks missing required fields inline", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_greyharbor");
    await openCommercialSheet(user);
    await user.click(screen.getByTestId("submit-commercial-arrangement"));
    expect(
      screen.getByText("Monthly amount must be greater than zero.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Next renewal date is required.")
    ).toBeInTheDocument();
    expect(screen.getByText("Reason is required.")).toBeInTheDocument();
    expect(screen.getByTestId("commercial-sheet")).toBeInTheDocument();
  });

  it("shows the save error toast and retains entered values when the repository rejects", async () => {
    const user = userEvent.setup();
    const { repository } = createInMemoryRepository();
    const failing: any = Object.create(repository);
    failing.saveCommercialArrangement = () => {
      throw new Error("boom");
    };
    renderProfilePath("/customers/cust_greyharbor", failing);

    await openCommercialSheet(user);
    await user.type(screen.getByTestId("monthly-amount"), "199");
    await user.type(screen.getByTestId("renews-at"), "2027-01-01");
    await user.type(screen.getByTestId("arrangement-reason"), "Test");
    await user.click(screen.getByTestId("submit-commercial-arrangement"));

    expect(
      await screen.findByText(
        "Commercial changes were not saved. Review the highlighted fields and try again."
      )
    ).toBeInTheDocument();
    expect(screen.getByTestId("commercial-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("monthly-amount")).toHaveValue(199);
  });

  it("shows the pending verb and disables the submit button while committing", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_greyharbor");
    await openCommercialSheet(user);
    await user.type(screen.getByTestId("monthly-amount"), "199");
    await user.type(screen.getByTestId("renews-at"), "2027-01-01");
    await user.type(screen.getByTestId("arrangement-reason"), "Test");
    const submit = screen.getByTestId("submit-commercial-arrangement");
    fireEvent.click(submit);
    expect(submit).toHaveTextContent("Starting monthly subscription…");
    expect(submit).toBeDisabled();
    await waitFor(() =>
      expect(screen.queryByTestId("commercial-sheet")).not.toBeInTheDocument()
    );
  });

  it("asks to discard dirty commercial changes before closing", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_greyharbor");
    await openCommercialSheet(user);
    const reasonInput = screen.getByTestId("arrangement-reason");
    fireEvent.input(reasonInput, { target: { value: 'Something' } });
    fireEvent.blur(reasonInput);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(
      screen.getByText("Discard commercial changes?")
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Continue editing" })
    );
    expect(
      screen.queryByText("Discard commercial changes?")
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("commercial-sheet")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(
      screen.getByRole("button", { name: "Discard commercial changes" })
    );
    await waitFor(() =>
      expect(screen.queryByTestId("commercial-sheet")).not.toBeInTheDocument()
    );
  });

  it("terminates the arrangement with the exact confirmation copy and revokes grants", async () => {
    const user = userEvent.setup();
    const { repository } = createInMemoryRepository();
    renderProfilePath("/customers/cust_northwind", repository);

    await user.click(screen.getByTestId("tab-commercial"));
    await user.click(screen.getByTestId("terminate-arrangement"));

    expect(
      screen.getByText("Terminate Monthly for Northwind Trading?")
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "2 active agent access grants will be revoked and recorded in Activity."
      )
    ).toBeInTheDocument();

    await user.type(screen.getByTestId("terminate-reason"), "Closeout");
    await user.click(
      screen.getByRole("button", { name: "Terminate and revoke access" })
    );

    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    );

    const snapshot = repository.getCommercialSnapshot(
      "cust_northwind",
      SEED_NOW
    );
    expect(snapshot.history.some(a => a.reason === "Closeout")).toBe(true);
    const access = repository.getAgentAccessSnapshot(
      "cust_northwind",
      SEED_NOW
    );
    expect(access.current).toHaveLength(0);
    expect(access.history).toHaveLength(2);
  });

  it("uses singular grammar for one active grant in the termination confirmation", async () => {
    const user = userEvent.setup();
    const { repository } = createInMemoryRepository();
    repository.grantAgentAccess(
      {
        customerId: "cust_sablefin",
        agentProductId: "agent_courier",
        startsAt: "2026-08-01T00:00:00.000Z",
        endsAt: null,
        createdAt: "2026-08-01T00:00:00.000Z",
        reasonForChange: "Test grant",
      },
      "2026-08-01T00:00:00.000Z"
    );
    renderProfilePath("/customers/cust_sablefin", repository);

    await user.click(screen.getByTestId("tab-commercial"));
    await user.click(screen.getByTestId("terminate-arrangement"));
    expect(
      screen.getByText(
        "1 active agent access grant will be revoked and recorded in Activity."
      )
    ).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Agent Access tab
  // -------------------------------------------------------------------------

  it("shows current grants with revoke controls", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_northwind");
    await user.click(screen.getByTestId("tab-agent-access"));
    const panel = screen.getByTestId("panel-agent-access");
    expect(panel).toHaveTextContent("Courier");
    expect(panel).toHaveTextContent("Mercator");
    expect(panel).toHaveTextContent("agent_courier");
    expect(panel).toHaveTextContent("agent_mercator");
    expect(within(panel).getAllByRole("button", { name: "Revoke access" })).toHaveLength(
      2
    );
  });

  it("shows scheduled access separately", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_meridians");
    await user.click(screen.getByTestId("tab-agent-access"));
    const panel = screen.getByTestId("panel-agent-access");
    expect(panel).toHaveTextContent(/Revocation scheduled (Oct 1|Sep 30), 2026/);
  });

  it("shows access history", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_greyharbor");
    await user.click(screen.getByTestId("tab-agent-access"));
    const panel = screen.getByTestId("panel-agent-access");
    expect(panel).toHaveTextContent("Access history");
    expect(panel).toHaveTextContent("revoked");
  });

  it("shows the exact empty state when no current access exists", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_greyharbor");
    await user.click(screen.getByTestId("tab-agent-access"));
    const panel = screen.getByTestId("panel-agent-access");
    expect(panel).toHaveTextContent("No agents are available to this customer");
    expect(panel).toHaveTextContent(
      "Grant access to an agent from the Hivarium catalog."
    );
  });

  // -------------------------------------------------------------------------
  // Grant drawer
  // -------------------------------------------------------------------------

  it("grants agent access immediately through the drawer", async () => {
    const user = userEvent.setup();
    const { repository } = createInMemoryRepository();
    renderProfilePath("/customers/cust_sablefin", repository);

    await openAccessSheet(user);
    await user.click(screen.getByTestId("agent-option-agent_sentinel"));
    await user.type(screen.getByTestId("access-reason"), "Test grant");
    await user.click(screen.getByTestId("submit-agent-access"));

    await waitFor(() =>
      expect(screen.queryByTestId("access-sheet")).not.toBeInTheDocument()
    );
    expect(await screen.findByText("Agent access granted")).toBeInTheDocument();

    const snapshot = repository.getAgentAccessSnapshot(
      "cust_sablefin",
      SEED_NOW
    );
    expect(
      snapshot.current.some((g) => g.agentProductId === "agent_sentinel")
    ).toBe(true);
  });

  it("schedules agent access through the drawer", async () => {
    const user = userEvent.setup();
    const { repository } = createInMemoryRepository();
    renderProfilePath("/customers/cust_sablefin", repository);

    await openAccessSheet(user);
    await user.click(screen.getByTestId("agent-option-agent_courier"));
    await user.click(screen.getByLabelText("Schedule for date"));
    await user.type(screen.getByTestId("access-start-date"), "2026-12-01");
    await user.type(screen.getByTestId("access-reason"), "Planned grant");
    await user.click(screen.getByTestId("submit-agent-access"));

    await waitFor(() =>
      expect(screen.queryByTestId("access-sheet")).not.toBeInTheDocument()
    );
    expect(
      await screen.findByText("Agent access scheduled")
    ).toBeInTheDocument();

    const snapshot = repository.getAgentAccessSnapshot(
      "cust_sablefin",
      SEED_NOW
    );
    expect(
      snapshot.scheduled.some((g) => g.agentProductId === "agent_courier")
    ).toBe(true);
  });

  it("disables agents the customer already has access to", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_northwind");
    await openAccessSheet(user);
    const courierOption = screen.getByTestId("agent-option-agent_courier");
    expect(courierOption).toBeDisabled();
    expect(courierOption).toHaveTextContent(
      "This customer already has access"
    );
  });

  it("shows the no-matching-agents empty state", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_sablefin");
    await openAccessSheet(user);
    await user.type(screen.getByTestId("agent-search"), "zzzz");
    expect(
      screen.getByText("No catalog agents match this search")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Clear the search or choose another category.")
    ).toBeInTheDocument();
  });

  it("shows the access save error toast and keeps the drawer open", async () => {
    const user = userEvent.setup();
    const { repository } = createInMemoryRepository();
    const failing: any = Object.create(repository);
    failing.grantAgentAccess = () => {
      throw new Error("boom");
    };
    renderProfilePath("/customers/cust_sablefin", failing);

    await openAccessSheet(user);
    await user.click(screen.getByTestId("agent-option-agent_sentinel"));
    await user.type(screen.getByTestId("access-reason"), "Test");
    await user.click(screen.getByTestId("submit-agent-access"));

    expect(
      await screen.findByText(
        "Agent access was not changed. Review the dates and try again."
      )
    ).toBeInTheDocument();
    expect(screen.getByTestId("access-sheet")).toBeInTheDocument();
  });

  it("asks to discard dirty access changes before closing", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_sablefin");
    await openAccessSheet(user);
    await user.click(screen.getByTestId("agent-option-agent_sentinel"));
    const reasonInput = screen.getByTestId("access-reason");
    fireEvent.input(reasonInput, { target: { value: 'Something' } });
    fireEvent.blur(reasonInput);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByText("Discard access changes?")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Continue editing" })
    );
    expect(screen.queryByText("Discard access changes?")).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(
      screen.getByRole("button", { name: "Discard access changes" })
    );
    await waitFor(() =>
      expect(screen.queryByTestId("access-sheet")).not.toBeInTheDocument()
    );
  });

  // -------------------------------------------------------------------------
  // Revoke dialog
  // -------------------------------------------------------------------------

  it("revokes access immediately with the exact confirmation copy", async () => {
    const user = userEvent.setup();
    const { repository } = createInMemoryRepository();
    renderProfilePath("/customers/cust_northwind", repository);

    await user.click(screen.getByTestId("tab-agent-access"));
    const row = screen.getByTestId("grant-grant_lic_northwind_courier");
    await user.click(within(row).getByRole("button", { name: "Revoke access" }));

    expect(
      screen.getByText("Revoke Courier access for Northwind Trading?")
    ).toBeInTheDocument();
    expect(
      screen.getByText("The access record will remain in history.")
    ).toBeInTheDocument();

    await user.type(screen.getByTestId("revoke-reason"), "No longer needed");
    await user.click(
      screen.getByRole("button", { name: "Revoke agent access" })
    );

    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    );

    const access = repository.getAgentAccessSnapshot(
      "cust_northwind",
      SEED_NOW
    );
    expect(
      access.current.some((g) => g.agentProductId === "agent_courier")
    ).toBe(false);
    expect(
      access.history.some((g) => g.agentProductId === "agent_courier")
    ).toBe(true);
  });

  it("schedules a revocation", async () => {
    const user = userEvent.setup();
    const { repository } = createInMemoryRepository();
    renderProfilePath("/customers/cust_northwind", repository);

    await user.click(screen.getByTestId("tab-agent-access"));
    const row = screen.getByTestId("grant-grant_lic_northwind_courier");
    await user.click(within(row).getByRole("button", { name: "Revoke access" }));

    await user.click(screen.getByLabelText("Schedule for date"));
    await user.type(screen.getByTestId("revoke-date"), "2026-12-01");
    await user.type(screen.getByTestId("revoke-reason"), "Planned offboarding");
    await user.click(
      screen.getByRole("button", { name: "Schedule revocation" })
    );

    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    );

    const grant = repository
      .listAgentAccessGrants("cust_northwind")
      .find((g) => g.agentProductId === "agent_courier");
    expect(grant?.scheduledRevokeAt).toBe("2026-12-01T00:00:00.000Z");
  });

  // -------------------------------------------------------------------------
  // Activity tab
  // -------------------------------------------------------------------------

  it("shows the activity timeline newest first", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_greyharbor");
    await user.click(screen.getByTestId("tab-activity"));
    const panel = screen.getByTestId("panel-activity");
    const items = within(panel).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Migrated");
    expect(items[items.length - 1]).toHaveTextContent(
      "Started annual contract."
    );
  });

  it("links automatic revocations to their commercial cause", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_greyharbor");
    await user.click(screen.getByTestId("tab-activity"));
    const cause = screen.getByTestId(
      "activity-cause-evt_grant_greyharbor_sentinel_revoked"
    );
    expect(cause).toHaveTextContent("Automatic");
    expect(cause).toHaveTextContent(
      "Terminated monthly commercial arrangement."
    );
  });

  it("shows the exact empty state when no activity exists", async () => {
    const user = userEvent.setup();
    const { repository } = createInMemoryRepository();
    repository.createCustomer({
      id: "cust_empty",
      name: "Empty Co",
      domain: "empty.example",
      contact: "A B",
      email: "a@empty.example",
      status: "active",
      notes: "",
    });
    renderProfilePath("/customers/cust_empty", repository);
    await user.click(screen.getByTestId("tab-activity"));
    expect(screen.getByText("No activity recorded")).toBeInTheDocument();
    expect(
      screen.getByText("No commercial or access changes have been recorded yet.")
    ).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Token account statement
  // -------------------------------------------------------------------------

  it("renders the token account statement newest first with full-account balances", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_meridians");
    await user.click(screen.getByTestId("tab-activity"));

    // The statement is the first section of the Activity tab, above the
    // commercial/access timeline.
    const statement = screen.getByTestId("token-statement");
    expect(statement).toHaveTextContent("Token account statement");
    expect(statement).toHaveTextContent("Balance 250,000 tokens");
    expect(
      statement.compareDocumentPosition(screen.getByTestId("activity-timeline")) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    const table = screen.getByRole("table", {
      name: "Token account statement for Meridians Health",
    });
    const rows = within(table).getAllByRole("row");
    // Header row plus six newest-first statement rows.
    expect(rows).toHaveLength(7);

    // Newest first: the July credit grant leads, the April opening credit last.
    expect(rows[1]).toHaveTextContent("Credit grant");
    expect(rows[1]).toHaveTextContent("+2,000 tokens");
    expect(rows[1]).toHaveTextContent("250,000 tokens");
    expect(rows[1]).toHaveTextContent("credit_meridians_jul_001");

    expect(rows[2]).toHaveTextContent("Reversal");
    expect(rows[2]).toHaveTextContent("+1,500 tokens");
    expect(rows[2]).toHaveTextContent("248,000 tokens");
    expect(rows[2]).toHaveTextContent("rev_usage_meridians_jun_003");
    expect(rows[2]).toHaveTextContent("Reverses usage_meridians_jun_003");

    expect(rows[3]).toHaveTextContent("Usage debit");
    expect(rows[3]).toHaveTextContent("−1,500 tokens");
    expect(rows[3]).toHaveTextContent("246,500 tokens");
    expect(rows[3]).toHaveTextContent("usage_meridians_jun_003");
    expect(rows[3]).toHaveTextContent("Sentinel");
    expect(rows[3]).toHaveTextContent("Reversed");

    expect(rows[4]).toHaveTextContent("Usage debit");
    expect(rows[4]).toHaveTextContent("−800 tokens");
    expect(rows[4]).toHaveTextContent("248,000 tokens");
    expect(rows[4]).toHaveTextContent("usage_meridians_jun_002");
    expect(rows[4]).toHaveTextContent("Mercator");

    expect(rows[5]).toHaveTextContent("Usage debit");
    expect(rows[5]).toHaveTextContent("−1,200 tokens");
    expect(rows[5]).toHaveTextContent("248,800 tokens");
    expect(rows[5]).toHaveTextContent("usage_meridians_may_001");
    expect(rows[5]).toHaveTextContent("Sentinel");

    expect(rows[6]).toHaveTextContent("Credit grant");
    expect(rows[6]).toHaveTextContent("+250,000 tokens");
    expect(rows[6]).toHaveTextContent("250,000 tokens");
    expect(rows[6]).toHaveTextContent("opening_arr_meridians_prepaid");
  });

  it("combines date, agent, and transaction-type filters", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_meridians");
    await user.click(screen.getByTestId("tab-activity"));

    await user.type(screen.getByTestId("statement-from"), "2026-05-01");
    await user.type(screen.getByTestId("statement-to"), "2026-06-30");
    await user.click(screen.getByTestId("statement-agent-trigger"));
    await user.click(
      screen.getByTestId("statement-agent-option-agent_sentinel")
    );
    await user.click(screen.getByTestId("statement-type-trigger"));
    await user.click(screen.getByTestId("statement-type-option-usage_debit"));

    const table = screen.getByRole("table", {
      name: "Token account statement for Meridians Health",
    });
    const rows = within(table).getAllByRole("row");
    // Header plus the two Sentinel usage debits inside the May–June window.
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent("usage_meridians_jun_003");
    expect(rows[1]).toHaveTextContent("−1,500 tokens");
    expect(rows[1]).toHaveTextContent("246,500 tokens");
    expect(rows[2]).toHaveTextContent("usage_meridians_may_001");
    expect(rows[2]).toHaveTextContent("−1,200 tokens");
    expect(rows[2]).toHaveTextContent("248,800 tokens");

    // The selected-period summary tracks the combined filters.
    expect(screen.getByTestId("statement-net-consumed")).toHaveTextContent(
      "−2,700 tokens"
    );
    expect(
      screen.getByTestId("statement-agent-agent_sentinel")
    ).toHaveTextContent("Sentinel — 2,700 tokens");
  });

  it("keeps rows on both inclusive date boundaries", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_meridians");
    await user.click(screen.getByTestId("tab-activity"));

    await user.type(screen.getByTestId("statement-from"), "2026-06-20");
    await user.type(screen.getByTestId("statement-to"), "2026-06-21");

    const table = screen.getByRole("table", {
      name: "Token account statement for Meridians Health",
    });
    const rows = within(table).getAllByRole("row");
    // Both boundary rows remain visible: the reversal on the 21st and the
    // usage debit on the 20th.
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent("rev_usage_meridians_jun_003");
    expect(rows[2]).toHaveTextContent("usage_meridians_jun_003");
  });

  it("shows the exact empty-filtered copy and keeps filters available", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_meridians");
    await user.click(screen.getByTestId("tab-activity"));

    await user.type(screen.getByTestId("statement-from"), "2026-01-01");
    await user.type(screen.getByTestId("statement-to"), "2026-01-31");

    const empty = screen.getByTestId("statement-empty-filtered");
    expect(empty).toHaveTextContent("No transactions match these filters");
    expect(empty).toHaveTextContent(
      "Clear one or more filters to review the full token account statement."
    );
    // The current balance and filters remain visible.
    expect(screen.getByTestId("token-statement")).toHaveTextContent(
      "Balance 250,000 tokens"
    );
    const clear = screen.getByTestId("clear-statement-filters");
    expect(clear).toBeEnabled();
    await user.click(clear);
    const table = screen.getByRole("table", {
      name: "Token account statement for Meridians Health",
    });
    expect(within(table).getAllByRole("row")).toHaveLength(7);
  });

  it("shows per-agent totals ordered highest consumption first", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_meridians");
    await user.click(screen.getByTestId("tab-activity"));

    expect(screen.getByTestId("statement-net-consumed")).toHaveTextContent(
      "−2,000 tokens"
    );
    const summary = screen.getByTestId("statement-summary");
    const agentRows = within(summary).getAllByRole("listitem");
    expect(agentRows).toHaveLength(2);
    expect(agentRows[0]).toHaveTextContent("Sentinel — 1,200 tokens");
    expect(agentRows[1]).toHaveTextContent("Mercator — 800 tokens");
  });

  it("nets a reversed usage debit to zero in the selected period", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_meridians");
    await user.click(screen.getByTestId("tab-activity"));

    await user.type(screen.getByTestId("statement-from"), "2026-06-20");
    await user.type(screen.getByTestId("statement-to"), "2026-06-21");

    expect(screen.getByTestId("statement-net-consumed")).toHaveTextContent(
      "0 tokens"
    );
    expect(
      screen.getByTestId("statement-agent-agent_sentinel")
    ).toHaveTextContent("Sentinel — 0 tokens");
    // The reversed original row remains visible with a neutral Reversed badge.
    expect(
      screen.getByTestId("reversed-txn_usage_usage_meridians_jun_003")
    ).toHaveTextContent("Reversed");
  });

  it("shows the exact empty-account copy for a historical prepaid account", async () => {
    const user = userEvent.setup();
    const { repository } = createInMemoryRepository();
    repository.createCustomer({
      id: "cust_prepaid_hist",
      name: "Prepaid History Co",
      domain: "prepaid-hist.example",
      contact: "A B",
      email: "a@prepaid-hist.example",
      status: "active",
      notes: "",
    });
    repository.saveCommercialArrangement(
      {
        id: "arr_prepaid_hist",
        customerId: "cust_prepaid_hist",
        model: "prepaid",
        status: "active",
        effectiveFrom: "2025-01-01T00:00:00.000Z",
        effectiveTo: null,
        createdAt: "2025-01-01T00:00:00.000Z",
        reason: "Historical prepaid",
        warningThresholdTokens: 100,
        expiresAt: null,
      },
      "2025-01-01T00:00:00.000Z"
    );
    repository.terminateCommercialArrangement(
      {
        arrangementId: "arr_prepaid_hist",
        customerId: "cust_prepaid_hist",
        reason: "Closed",
      },
      "2025-06-01T00:00:00.000Z"
    );
    renderProfilePath("/customers/cust_prepaid_hist", repository);
    await user.click(screen.getByTestId("tab-activity"));

    const empty = screen.getByTestId("statement-empty");
    expect(empty).toHaveTextContent("No token transactions yet");
    expect(empty).toHaveTextContent(
      "Add token credit to create this customer's first immutable statement entry."
    );
    // A historical prepaid account with zero entries is read-only.
    expect(
      screen.queryByTestId("statement-add-credit")
    ).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Record usage sheet
  // -------------------------------------------------------------------------

  it("opens the Record usage sheet from the Activity tab with customer and balance", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_meridians");
    const sheet = await openUsageSheet(user);
    expect(sheet).toHaveTextContent("Record usage");
    expect(sheet).toHaveTextContent("Meridians Health");
    expect(sheet).toHaveTextContent("Available balance");
    expect(sheet).toHaveTextContent("250,000 tokens");
  });

  it("lists only catalog agents the customer may currently use", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_meridians");
    await openUsageSheet(user);
    await user.click(screen.getByTestId("usage-agent-trigger"));
    expect(
      screen.getByTestId("usage-agent-option-agent_sentinel")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("usage-agent-option-agent_courier")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("usage-agent-option-agent_mercator")
    ).not.toBeInTheDocument();
  });

  it("keeps Review usage disabled until every required field is valid", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_meridians");
    await openUsageSheet(user);
    const review = screen.getByTestId("review-usage");
    expect(review).toBeDisabled();

    await user.type(screen.getByTestId("usage-tokens"), "0");
    expect(
      screen.getByText("Tokens consumed must be a positive whole number.")
    ).toBeInTheDocument();
    expect(review).toBeDisabled();

    await user.clear(screen.getByTestId("usage-tokens"));
    await user.type(screen.getByTestId("usage-tokens"), "1200");
    await chooseUsageAgent(user);
    await user.type(
      screen.getByTestId("usage-source-reference"),
      "usage_valid_001"
    );
    expect(review).toBeEnabled();
  });

  it("shows the projected resulting balance live", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_meridians");
    await openUsageSheet(user);
    const resulting = screen.getByTestId("usage-resulting-balance");
    expect(resulting).toHaveTextContent("250,000 tokens");
    await user.type(screen.getByTestId("usage-tokens"), "1200");
    expect(resulting).toHaveTextContent("248,800 tokens");
  });

  it("records usage through the named-customer confirmation with exact copy", async () => {
    const user = userEvent.setup();
    const { repository } = createInMemoryRepository();
    renderProfilePath("/customers/cust_meridians", repository);

    await openUsageSheet(user);
    await chooseUsageAgent(user);
    await user.type(screen.getByTestId("usage-tokens"), "1200");
    await user.type(
      screen.getByTestId("usage-source-reference"),
      "usage_test_001"
    );
    await user.click(screen.getByTestId("review-usage"));

    const confirmation = screen.getByTestId("usage-confirmation");
    expect(confirmation).toHaveTextContent(
      "Record 1,200 tokens of usage for Meridians Health?"
    );
    expect(confirmation).toHaveTextContent("Sentinel will consume 1,200 tokens.");
    expect(confirmation).toHaveTextContent("Source reference: usage_test_001");
    expect(confirmation).toHaveTextContent(
      "The balance will change from 250,000 tokens to 248,800 tokens."
    );

    await user.click(screen.getByTestId("confirm-record-usage"));
    expect(await screen.findByText("Usage recorded")).toBeInTheDocument();
    expect(
      screen.getByText("1,200 tokens were deducted for Sentinel.")
    ).toBeInTheDocument();
    expect(repository.getTokenBalance("cust_meridians")).toBe(248800);
  });

  it("announces an exact replay with no additional deduction", async () => {
    const user = userEvent.setup();
    const { repository } = createInMemoryRepository();
    renderProfilePath("/customers/cust_meridians", repository);

    await openUsageSheet(user);
    await chooseUsageAgent(user);
    await user.type(screen.getByTestId("usage-tokens"), "1200");
    await user.type(
      screen.getByTestId("usage-source-reference"),
      "usage_replay_001"
    );
    await user.click(screen.getByTestId("review-usage"));
    await user.click(screen.getByTestId("confirm-record-usage"));
    expect(await screen.findByText("Usage recorded")).toBeInTheDocument();
    expect(repository.getTokenBalance("cust_meridians")).toBe(248800);

    // Re-submit the identical source reference with identical values.
    await openUsageSheet(user);
    await chooseUsageAgent(user);
    await user.type(screen.getByTestId("usage-tokens"), "1200");
    await user.type(
      screen.getByTestId("usage-source-reference"),
      "usage_replay_001"
    );
    await user.click(screen.getByTestId("review-usage"));
    await user.click(screen.getByTestId("confirm-record-usage"));

    expect(await screen.findByText("Usage already recorded")).toBeInTheDocument();
    expect(
      screen.getByText("No additional tokens were deducted.")
    ).toBeInTheDocument();
    expect(repository.getTokenBalance("cust_meridians")).toBe(248800);
  });

  it("preserves the form and shows the conflict message on conflicting reuse", async () => {
    const user = userEvent.setup();
    const { repository } = createInMemoryRepository();
    renderProfilePath("/customers/cust_meridians", repository);

    await openUsageSheet(user);
    await chooseUsageAgent(user);
    await user.type(screen.getByTestId("usage-tokens"), "100");
    await user.type(
      screen.getByTestId("usage-source-reference"),
      "usage_conflict_001"
    );
    await user.click(screen.getByTestId("review-usage"));
    await user.click(screen.getByTestId("confirm-record-usage"));
    expect(await screen.findByText("Usage recorded")).toBeInTheDocument();

    // Reuse the reference with a different token quantity.
    await openUsageSheet(user);
    await chooseUsageAgent(user);
    await user.type(screen.getByTestId("usage-tokens"), "200");
    await user.type(
      screen.getByTestId("usage-source-reference"),
      "usage_conflict_001"
    );
    await user.click(screen.getByTestId("review-usage"));
    await user.click(screen.getByTestId("confirm-record-usage"));

    expect(await screen.findByTestId("usage-conflict-message")).toHaveTextContent(
      'Source reference "usage_conflict_001" is already assigned to different usage. Enter a unique source reference or restore the original values.'
    );
    expect(screen.getByTestId("usage-tokens")).toHaveValue(200);
    expect(screen.getByTestId("usage-source-reference")).toHaveValue(
      "usage_conflict_001"
    );
    expect(repository.getTokenBalance("cust_meridians")).toBe(249900);
  });

  it("blocks usage that would exceed the balance before the confirmation", async () => {
    const user = userEvent.setup();
    const { repository } = createInMemoryRepository();
    renderProfilePath("/customers/cust_meridians", repository);

    await openUsageSheet(user);
    await chooseUsageAgent(user);
    await user.type(screen.getByTestId("usage-tokens"), "300000");
    await user.type(
      screen.getByTestId("usage-source-reference"),
      "usage_big_001"
    );
    await user.click(screen.getByTestId("review-usage"));

    expect(screen.getByTestId("usage-insufficient-message")).toHaveTextContent(
      "Usage was not recorded. Meridians Health has 250,000 tokens available, but this debit requires 300,000 tokens."
    );
    expect(screen.queryByTestId("usage-confirmation")).not.toBeInTheDocument();
    expect(repository.getTokenBalance("cust_meridians")).toBe(250000);
  });

  it("asks to discard a dirty usage draft before closing", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_meridians");
    await openUsageSheet(user);
    await user.type(screen.getByTestId("usage-tokens"), "100");
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByText("Discard usage draft?")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Continue editing" })
    );
    expect(screen.queryByText("Discard usage draft?")).not.toBeInTheDocument();
    expect(screen.getByTestId("record-usage-sheet")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(
      screen.getByRole("button", { name: "Discard usage draft" })
    );
    await waitFor(() =>
      expect(screen.queryByTestId("record-usage-sheet")).not.toBeInTheDocument()
    );
  });

  // -------------------------------------------------------------------------
  // Adjustment sheet
  // -------------------------------------------------------------------------

  it("opens the Adjust balance sheet from the Commercial tab", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_meridians");
    const sheet = await openAdjustmentSheet(user);
    expect(sheet).toHaveTextContent("Adjust balance");
    expect(sheet).toHaveTextContent("Meridians Health");
    expect(sheet).toHaveTextContent("Current balance");
    expect(sheet).toHaveTextContent("250,000 tokens");
  });

  it("applies a positive adjustment through the named-customer confirmation", async () => {
    const user = userEvent.setup();
    const { repository } = createInMemoryRepository();
    renderProfilePath("/customers/cust_meridians", repository);

    await openAdjustmentSheet(user);
    await user.type(screen.getByTestId("adjustment-amount"), "500");
    await user.type(screen.getByTestId("adjustment-reference"), "adj_add_001");
    await user.type(screen.getByTestId("adjustment-reason"), "Test credit");
    await user.click(screen.getByTestId("review-adjustment"));

    const confirmation = screen.getByTestId("adjustment-confirmation");
    expect(confirmation).toHaveTextContent("Adjust Meridians Health's balance?");
    expect(confirmation).toHaveTextContent("+500 tokens will be applied.");
    expect(confirmation).toHaveTextContent(
      "The balance will change from 250,000 tokens to 250,500 tokens."
    );

    await user.click(screen.getByTestId("confirm-apply-adjustment"));
    expect(
      await screen.findByText("Balance adjustment recorded")
    ).toBeInTheDocument();
    expect(repository.getTokenBalance("cust_meridians")).toBe(250500);
  });

  it("applies a negative adjustment through the named-customer confirmation", async () => {
    const user = userEvent.setup();
    const { repository } = createInMemoryRepository();
    renderProfilePath("/customers/cust_meridians", repository);

    await openAdjustmentSheet(user);
    await user.click(screen.getByLabelText("Remove tokens"));
    await user.type(screen.getByTestId("adjustment-amount"), "500");
    await user.type(screen.getByTestId("adjustment-reference"), "adj_rm_001");
    await user.type(screen.getByTestId("adjustment-reason"), "Test removal");
    await user.click(screen.getByTestId("review-adjustment"));

    const confirmation = screen.getByTestId("adjustment-confirmation");
    expect(confirmation).toHaveTextContent("Adjust Meridians Health's balance?");
    expect(confirmation).toHaveTextContent("−500 tokens will be applied.");
    expect(confirmation).toHaveTextContent(
      "The balance will change from 250,000 tokens to 249,500 tokens."
    );

    await user.click(screen.getByTestId("confirm-apply-adjustment"));
    expect(
      await screen.findByText("Balance adjustment recorded")
    ).toBeInTheDocument();
    expect(repository.getTokenBalance("cust_meridians")).toBe(249500);
  });

  it("blocks a negative-resulting adjustment before the confirmation", async () => {
    const user = userEvent.setup();
    const { repository } = createInMemoryRepository();
    renderProfilePath("/customers/cust_meridians", repository);

    await openAdjustmentSheet(user);
    await user.click(screen.getByLabelText("Remove tokens"));
    await user.type(screen.getByTestId("adjustment-amount"), "300000");
    await user.type(screen.getByTestId("adjustment-reference"), "adj_big_001");
    await user.type(screen.getByTestId("adjustment-reason"), "Too large");
    await user.click(screen.getByTestId("review-adjustment"));

    expect(screen.getByTestId("adjustment-blocked-message")).toHaveTextContent(
      "Adjustment was not applied. Removing 300,000 tokens would exceed the available balance of 250,000 tokens."
    );
    expect(screen.queryByTestId("adjustment-confirmation")).not.toBeInTheDocument();
    expect(repository.getTokenBalance("cust_meridians")).toBe(250000);
  });

  it("keeps Review adjustment disabled until amount, reference, and reason are valid", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_meridians");
    await openAdjustmentSheet(user);
    const review = screen.getByTestId("review-adjustment");
    expect(review).toBeDisabled();

    await user.type(screen.getByTestId("adjustment-amount"), "0");
    expect(
      screen.getByText("Token amount must be a positive whole number.")
    ).toBeInTheDocument();
    expect(review).toBeDisabled();

    await user.clear(screen.getByTestId("adjustment-amount"));
    await user.type(screen.getByTestId("adjustment-amount"), "500");
    await user.type(screen.getByTestId("adjustment-reference"), "adj_valid_001");
    await user.type(screen.getByTestId("adjustment-reason"), "Valid");
    expect(review).toBeEnabled();
  });

  it("asks to discard a dirty adjustment draft before closing", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_meridians");
    await openAdjustmentSheet(user);
    await user.type(screen.getByTestId("adjustment-amount"), "100");
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByText("Discard adjustment draft?")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Continue editing" })
    );
    expect(screen.queryByText("Discard adjustment draft?")).not.toBeInTheDocument();
    expect(screen.getByTestId("adjustment-sheet")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(
      screen.getByRole("button", { name: "Discard adjustment draft" })
    );
    await waitFor(() =>
      expect(screen.queryByTestId("adjustment-sheet")).not.toBeInTheDocument()
    );
  });

  // -------------------------------------------------------------------------
  // Reversal sheet
  // -------------------------------------------------------------------------

  it("opens the Reverse transaction sheet showing the immutable original", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_meridians");
    const sheet = await openReversalSheet(user);
    expect(sheet).toHaveTextContent("Reverse transaction");
    const original = screen.getByTestId("reversal-original-transaction");
    expect(original).toHaveTextContent("Credit grant");
    expect(original).toHaveTextContent("+250,000 tokens");
    expect(original).toHaveTextContent("opening_arr_meridians_prepaid");
    expect(original).toHaveTextContent("Opening token credit from prototype migration");
  });

  it("reverses the target through the named-customer confirmation with exact copy", async () => {
    const user = userEvent.setup();
    const { repository } = createInMemoryRepository();
    renderProfilePath("/customers/cust_meridians", repository);

    await openReversalSheet(user);
    await user.type(screen.getByTestId("reversal-reference"), "rev_test_001");
    await user.type(screen.getByTestId("reversal-reason"), "Test reversal");
    await user.click(screen.getByTestId("review-reversal"));

    const confirmation = screen.getByTestId("reversal-confirmation");
    expect(confirmation).toHaveTextContent(
      "Reverse this transaction for Meridians Health?"
    );
    expect(confirmation).toHaveTextContent(
      "The original transaction of +250,000 tokens will be reversed by −250,000 tokens."
    );
    expect(confirmation).toHaveTextContent(
      "The balance will change from 250,000 tokens to 0 tokens."
    );
    expect(confirmation).toHaveTextContent(
      "The original record will remain visible."
    );

    await user.click(screen.getByTestId("confirm-reverse-transaction"));
    expect(await screen.findByText("Transaction reversed")).toBeInTheDocument();
    expect(repository.getTokenBalance("cust_meridians")).toBe(0);
  });

  it("blocks a second reversal of the same target with the precise reason", async () => {
    const user = userEvent.setup();
    const { repository } = createInMemoryRepository();
    renderProfilePath("/customers/cust_meridians", repository);

    await openReversalSheet(user);
    await user.type(screen.getByTestId("reversal-reference"), "rev_first_001");
    await user.type(screen.getByTestId("reversal-reason"), "First reversal");
    await user.click(screen.getByTestId("review-reversal"));
    await user.click(screen.getByTestId("confirm-reverse-transaction"));
    expect(await screen.findByText("Transaction reversed")).toBeInTheDocument();

    // The reversed original row now shows a neutral Reversed badge and no
    // reverse action, so the second attempt is exercised through the sheet
    // directly against the already-reversed target.
    const customer = repository.getCustomer("cust_meridians");
    const openingCredit = repository
      .listLedgerTransactions("cust_meridians")
      .find(
        (transaction) =>
          transaction.kind === "credit_grant" &&
          transaction.reference === "opening_arr_meridians_prepaid"
      );
    expect(customer).toBeDefined();
    expect(openingCredit).toBeDefined();
    render(
      <RepositoryProvider repository={repository}>
        <ReversalSheet
          customer={customer!}
          transaction={openingCredit!}
          balanceTokens={0}
          open
          onOpenChange={() => {}}
          onSaved={() => {}}
        />
        <Toaster position="bottom-right" />
      </RepositoryProvider>
    );

    await user.type(screen.getByTestId("reversal-reference"), "rev_second_001");
    await user.type(screen.getByTestId("reversal-reason"), "Second reversal");
    await user.click(screen.getByTestId("review-reversal"));
    await user.click(screen.getByTestId("confirm-reverse-transaction"));

    expect(await screen.findByTestId("reversal-blocked-message")).toHaveTextContent(
      "This transaction has already been reversed."
    );
    expect(repository.getTokenBalance("cust_meridians")).toBe(0);
  });

  it("blocks a reversal-of-reversal with the precise reason", async () => {
    const user = userEvent.setup();
    const { repository } = createInMemoryRepository();
    const reversal = repository.reverseTransaction(
      {
        customerId: "cust_meridians",
        transactionId: "txn_opening_arr_meridians_prepaid",
        reference: "rev_setup_001",
        reason: "Setup reversal",
      },
      SEED_NOW
    );
    const customer = repository.getCustomer("cust_meridians");
    expect(customer).toBeDefined();
    render(
      <RepositoryProvider repository={repository}>
        <ReversalSheet
          customer={customer!}
          transaction={reversal}
          balanceTokens={0}
          open
          onOpenChange={() => {}}
          onSaved={() => {}}
        />
        <Toaster position="bottom-right" />
      </RepositoryProvider>
    );

    await user.type(screen.getByTestId("reversal-reference"), "rev_of_rev_001");
    await user.type(screen.getByTestId("reversal-reason"), "Reversing the reversal");
    await user.click(screen.getByTestId("review-reversal"));
    await user.click(screen.getByTestId("confirm-reverse-transaction"));

    expect(await screen.findByTestId("reversal-blocked-message")).toHaveTextContent(
      "A reversal transaction cannot be reversed."
    );
  });

  it("blocks a reversal that would make the balance negative", async () => {
    const user = userEvent.setup();
    const { repository } = createInMemoryRepository();
    const customer = repository.getCustomer("cust_meridians");
    const openingCredit = repository
      .listLedgerTransactions("cust_meridians")
      .find((transaction) => transaction.kind === "credit_grant");
    expect(customer).toBeDefined();
    expect(openingCredit).toBeDefined();
    render(
      <RepositoryProvider repository={repository}>
        <ReversalSheet
          customer={customer!}
          transaction={openingCredit!}
          balanceTokens={100}
          open
          onOpenChange={() => {}}
          onSaved={() => {}}
        />
        <Toaster position="bottom-right" />
      </RepositoryProvider>
    );

    await user.type(screen.getByTestId("reversal-reference"), "rev_neg_001");
    await user.type(screen.getByTestId("reversal-reason"), "Negative result");
    await user.click(screen.getByTestId("review-reversal"));

    expect(screen.getByTestId("reversal-blocked-message")).toHaveTextContent(
      "Transaction cannot be reversed because the resulting balance would be negative."
    );
    expect(screen.queryByTestId("reversal-confirmation")).not.toBeInTheDocument();
  });

  it("asks to discard a dirty reversal draft before closing", async () => {
    const user = userEvent.setup();
    renderProfilePath("/customers/cust_meridians");
    await openReversalSheet(user);
    await user.type(screen.getByTestId("reversal-reference"), "rev_dirty_001");
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByText("Discard reversal draft?")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Continue editing" })
    );
    expect(screen.queryByText("Discard reversal draft?")).not.toBeInTheDocument();
    expect(screen.getByTestId("reversal-sheet")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(
      screen.getByRole("button", { name: "Discard reversal draft" })
    );
    await waitFor(() =>
      expect(screen.queryByTestId("reversal-sheet")).not.toBeInTheDocument()
    );
  });

  // -------------------------------------------------------------------------
  // Not found / long text / overflow
  // -------------------------------------------------------------------------

  it("shows a not-found state for unknown ids", () => {
    renderProfilePath("/customers/does_not_exist");
    expect(screen.queryByTestId("page-title")).not.toBeInTheDocument();
    expect(screen.getByText("Customer not found")).toBeInTheDocument();
  });

  it("renders long customer names fully without page-level overflow", () => {
    const { repository } = createInMemoryRepository();
    const longName =
      "A Very Long Customer Name That Keeps Going And Going And Going And Going And Going And Going";
    repository.createCustomer({
      id: "cust_long",
      name: longName,
      domain: "long.example",
      contact: "A B",
      email: "a@long.example",
      status: "active",
      notes: "",
    });
    renderProfilePath("/customers/cust_long", repository);
    expect(screen.getByTestId("page-title")).toHaveTextContent(longName);
  });

  it("exposes full long agent names accessibly", async () => {
    const user = userEvent.setup();
    const { repository, storage } = createInMemoryRepository();
    const longName =
      "A Very Long Agent Name That Keeps Going And Going And Going And Going And Going";
    const raw = storage.getItem(STORAGE_KEY)!;
    const store = JSON.parse(raw) as {
      agentProducts: unknown[];
      agentAccessGrants: unknown[];
    };
    store.agentProducts.push({
      id: "agent_longname",
      name: longName,
      description: "Long description",
      category: "Test",
      version: "1.0.0",
      plans: ["growth"],
    });
    store.agentAccessGrants.push({
      id: "grant_long",
      customerId: "cust_greyharbor",
      agentProductId: "agent_longname",
      startsAt: "2026-01-01T00:00:00.000Z",
      endsAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      revokedAt: null,
      scheduledRevokeAt: null,
      activityEventId: "evt_long",
      reasonForChange: "Test",
    });
    storage.setItem(STORAGE_KEY, JSON.stringify(store));

    renderProfilePath("/customers/cust_greyharbor", repository);
    await user.click(screen.getByTestId("tab-agent-access"));
    const row = screen.getByTestId("grant-grant_long");
    expect(row).toHaveTextContent(longName);
    expect(row.querySelector("p[title]")).toHaveAttribute("title", longName);
  });
});