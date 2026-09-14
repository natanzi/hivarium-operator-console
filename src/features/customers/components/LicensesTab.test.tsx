import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LicensesTab } from "./LicensesTab";
import { RepositoryProvider } from "@/data/repository-context";
import { createInMemoryRepository } from "@/data/local-storage-repository";
import { describe, it, expect, vi, beforeEach } from "vitest";

const MOCK_DATE = "2024-02-01T12:00:00.000Z";

describe("LicensesTab", () => {
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
                <LicensesTab customerId="cust-1" />
            </RepositoryProvider>
        );
    };

    it("opens suspend dialog and confirms (not a one-click)", async () => {
        repo.listLicenses = vi.fn().mockResolvedValue([{ id: "lic-1", productId: "core", status: "active", revision: 1, validFrom: MOCK_DATE, validUntil: null }]);
        repo.suspendLicense = vi.fn().mockResolvedValue({});

        renderTab();

        const suspendBtn = await screen.findByRole("button", { name: "Suspend" });
        await user.click(suspendBtn);

        const dialogTitle = await screen.findByText("Suspend License");
        expect(dialogTitle).toBeInTheDocument();

        // Check double submit prevention isn't directly observable easily without mocking timer, 
        // but we can verify the button disables or triggers mutation
        const confirmBtn = screen.getByRole("button", { name: "Confirm suspend" });
        await user.click(confirmBtn);

        expect(repo.suspendLicense).toHaveBeenCalledWith("cust-1", "lic-1", expect.any(Object));
    });

    it("cancel does not mutate or cause side effects", async () => {
        repo.listLicenses = vi.fn().mockResolvedValue([{ id: "lic-2", productId: "core", status: "active", revision: 1, validFrom: MOCK_DATE, validUntil: null }]);
        repo.revokeLicense = vi.fn();

        renderTab();

        const revokeBtn = await screen.findByRole("button", { name: "Revoke" });
        await user.click(revokeBtn);

        const cancelBtn = screen.getByRole("button", { name: "Cancel" });
        await user.click(cancelBtn);

        expect(repo.revokeLicense).not.toHaveBeenCalled();
        expect(screen.queryByText("Revoke License")).not.toBeInTheDocument();
    });

    it("handles downstream API failure gracefully", async () => {
        repo.listLicenses = vi.fn().mockResolvedValue([]);
        repo.issueLicense = vi.fn().mockRejectedValue(new Error("License issuance failed on backend"));

        renderTab();

        const issueBtn = await screen.findByRole("button", { name: "Issue New License" });
        await user.click(issueBtn);

        const confirmBtn = await screen.findByRole("button", { name: "Confirm issue" });
        await user.click(confirmBtn);

        await screen.findByText("License issuance failed on backend");
        expect(repo.issueLicense).toHaveBeenCalled();
    });
});
