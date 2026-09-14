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

    it("opens approval dialog and confirms", async () => {
        repo.listRequests = vi.fn().mockResolvedValue([{ id: "req-1", type: "plan_change", status: "pending", summary: "Requesting plan change", submittedAt: MOCK_DATE }]);
        repo.recordDecision = vi.fn().mockResolvedValue({});

        renderTab();

        const approveBtn = await screen.findByRole("button", { name: "Approve" });
        await user.click(approveBtn);

        const dialogTitle = await screen.findByText("Confirm Decision");
        expect(dialogTitle).toBeInTheDocument();

        const confirmBtn = screen.getByRole("button", { name: "Confirm approved" });
        await user.click(confirmBtn);

        expect(repo.recordDecision).toHaveBeenCalledWith("cust-1", "req-1", { status: "approved", note: "Updated" });
    });

    it("cancel does not mutate and escapes safely", async () => {
        repo.listRequests = vi.fn().mockResolvedValue([{ id: "req-2", type: "support_request", status: "pending", summary: "Support", submittedAt: MOCK_DATE }]);
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
        repo.listRequests = vi.fn().mockResolvedValue([{ id: "req-3", type: "license_renewal", status: "pending", summary: "Renew", submittedAt: MOCK_DATE }]);
        repo.renewLicense = vi.fn().mockResolvedValue({ id: "lic-999" });
        repo.recordDecision = vi.fn().mockRejectedValue(new Error("API Error"));

        renderTab();

        const approveBtn = await screen.findByRole("button", { name: "Approve" });
        await user.click(approveBtn);

        const confirmBtn = screen.getByRole("button", { name: "Confirm approved" });
        await user.click(confirmBtn);

        // License Service succeeds (repo.renewLicense called) but portal request fails
        await screen.findByText(/Partial failure! License lic-999 was renewed, but portal request update failed/);
    });
});
