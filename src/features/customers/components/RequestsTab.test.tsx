import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RequestsTab } from "./RequestsTab";
import { RepositoryProvider } from "@/data/repository-context";
import { createInMemoryRepository } from "@/data/local-storage-repository";
import { describe, it, expect, vi, beforeEach } from "vitest";

const MOCK_DATE = "2024-02-01T12:00:00.000Z";

describe("RequestsTab", () => {
    let repo: any;
    let user: any;

    beforeEach(() => {
        const { repository } = createInMemoryRepository();
        repo = repository;
        user = userEvent.setup();
        vi.setSystemTime(new Date(MOCK_DATE));
    });

    const renderTab = () => {
        return render(
            <RepositoryProvider repository={repo}>
                <RequestsTab customerId="cust-1" />
            </RepositoryProvider>
        );
    };

    it("renders a human-readable label for every request type and under_review", async () => {
        repo.listRequests = vi.fn().mockResolvedValue([
            { id: "req-a", type: "license_renewal", status: "under_review", summary: "A", submittedAt: MOCK_DATE },
            { id: "req-b", type: "additional_agent_access", status: "submitted", summary: "B", submittedAt: MOCK_DATE },
            { id: "req-c", type: "token_credit", status: "submitted", summary: "C", submittedAt: MOCK_DATE },
            { id: "req-d", type: "plan_change", status: "submitted", summary: "D", submittedAt: MOCK_DATE },
            { id: "req-e", type: "support", status: "submitted", summary: "E", submittedAt: MOCK_DATE },
        ]);

        renderTab();

        expect(await screen.findByText("License renewal")).toBeInTheDocument();
        expect(screen.getByText("Additional agent access")).toBeInTheDocument();
        expect(screen.getByText("Token credit")).toBeInTheDocument();
        expect(screen.getByText("Plan change")).toBeInTheDocument();
        expect(screen.getByText("Support")).toBeInTheDocument();
        expect(screen.getByText("Under review")).toBeInTheDocument();
        expect(screen.queryByText("license_renewal")).not.toBeInTheDocument();
        expect(screen.queryByText("under_review")).not.toBeInTheDocument();
        expect(repo.listRequests).toHaveBeenCalledWith("cust-1");
    });

    it("opens approval dialog and confirms", async () => {
        repo.listRequests = vi.fn().mockResolvedValue([{ id: "req-1", type: "plan_change", status: "submitted", summary: "Requesting plan change", submittedAt: MOCK_DATE }]);
        repo.recordDecision = vi.fn().mockResolvedValue({});

        renderTab();

        const approveBtn = await screen.findByRole("button", { name: "Approve" });
        await user.click(approveBtn);

        const dialogTitle = await screen.findByText("Confirm Decision");
        expect(dialogTitle).toBeInTheDocument();

        const confirmBtn = screen.getByRole("button", { name: "Confirm Approved" });
        await user.click(confirmBtn);

        expect(repo.recordDecision).toHaveBeenCalledWith("cust-1", "req-1", { status: "approved", note: "Updated", idempotencyKey: "decision-req-1-approved", externalReference: undefined });
    });

    it("cancel does not mutate and escapes safely", async () => {
        repo.listRequests = vi.fn().mockResolvedValue([{ id: "req-2", type: "support", status: "submitted", summary: "Support", submittedAt: MOCK_DATE }]);
        repo.recordDecision = vi.fn();

        renderTab();

        const rejectBtn = await screen.findByRole("button", { name: "Reject" });
        await user.click(rejectBtn);

        const cancelBtn = screen.getByRole("button", { name: "Cancel" });
        await user.click(cancelBtn);

        expect(repo.recordDecision).not.toHaveBeenCalled();
        expect(screen.queryByText("Confirm Decision")).not.toBeInTheDocument();

        // Esc closes safely
        await user.click(rejectBtn);
        expect(screen.getByText("Confirm Decision")).toBeInTheDocument();
        await user.keyboard("{Escape}");
        await waitFor(() => expect(screen.queryByText("Confirm Decision")).not.toBeInTheDocument());
    });

    it("partial license-renewal failure shows inline error", async () => {
        repo.listRequests = vi.fn().mockResolvedValue([{ id: "req-3", type: "license_renewal", status: "approved", summary: "Renew", submittedAt: MOCK_DATE, payload: { licenseId: "lic-old" } }]);
        repo.getRequest = vi.fn().mockResolvedValue({ id: "req-3", type: "license_renewal", status: "approved", payload: { licenseId: "lic-old" } });
        repo.renewLicense = vi.fn().mockResolvedValue({ id: "lic-999" });
        repo.recordDecision = vi.fn().mockRejectedValue(new Error("API Error"));

        renderTab();

        const completeBtn = await screen.findByRole("button", { name: "Complete renewal" });
        await user.click(completeBtn);

        const confirmBtn = screen.getByRole("button", { name: "Confirm Completed" });
        await user.click(confirmBtn);

        // License Service succeeds (repo.renewLicense called) but portal request fails
        await screen.findByText(/Partial failure! License lic-999 was renewed, but portal request update failed/);
    });
});
