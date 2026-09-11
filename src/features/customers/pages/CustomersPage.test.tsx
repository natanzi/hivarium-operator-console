import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CustomersPage } from "./CustomersPage";
import { createInMemoryRepository } from "@/data/local-storage-repository";
import { RepositoryProvider } from "@/data/repository-context";

describe("CustomersPage deletion", () => {
  it("requires confirmation and archives the customer while retaining related records", async () => {
    const { repository } = createInMemoryRepository();
    const customers = await repository.listCustomers();
    const customer = (
      await Promise.all(
        customers.map(async (candidate) => ({
          candidate,
          hasSubscriptions:
            (await repository.getSubscriptions(candidate.id)).length > 0,
        }))
      )
    ).find((entry) => entry.hasSubscriptions)!.candidate;

    render(
      <RepositoryProvider repository={repository}>
        <CustomersPage />
      </RepositoryProvider>
    );

    fireEvent.click(await screen.findByTestId(`archive-${customer.id}`));

    expect(
      await screen.findByRole("heading", { name: `Archive ${customer.name}?` })
    ).toBeInTheDocument();
    expect((await repository.getCustomer(customer.id))?.status).not.toBe(
      "archived"
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect((await repository.getCustomer(customer.id))?.status).not.toBe(
      "archived"
    );

    fireEvent.click(await screen.findByTestId(`archive-${customer.id}`));
    fireEvent.click(
      await screen.findByTestId(`confirm-archive-${customer.id}`)
    );

    await waitFor(() =>
      expect(screen.queryByTestId(`customer-row-${customer.id}`)).not.toBeInTheDocument()
    );
    expect((await repository.getCustomer(customer.id))?.status).toBe("archived");
    expect(await repository.getSubscriptions(customer.id)).not.toHaveLength(0);
    expect(await repository.getFeatureEntitlements(customer.id)).not.toHaveLength(0);
    expect(await repository.getAgentLicenses(customer.id)).not.toHaveLength(0);
    expect(screen.getByTestId("summary-total")).toHaveTextContent("6");
  });
});

describe("CustomersPage prepaid balance", () => {
  it("shows the derived token balance for an active prepaid customer without a low-balance badge above threshold", async () => {
    const { repository } = createInMemoryRepository();
    render(
      <RepositoryProvider repository={repository}>
        <CustomersPage />
      </RepositoryProvider>
    );

    const row = await screen.findByTestId("customer-row-cust_meridians");
    expect(row).toHaveTextContent("250,000 tokens");
    expect(screen.queryByTestId("low-balance-cust_meridians")).not.toBeInTheDocument();
  });

  it("shows the Low balance badge with accessible balance and threshold text at or below threshold", async () => {
    const { repository } = createInMemoryRepository();
    await repository.updateWarningThreshold("cust_meridians", 300000);
    render(
      <RepositoryProvider repository={repository}>
        <CustomersPage />
      </RepositoryProvider>
    );

    const row = await screen.findByTestId("customer-row-cust_meridians");
    expect(row).toHaveTextContent("250,000 tokens");
    expect(row).toHaveTextContent("300,000 tokens");
    const badge = screen.getByTestId("low-balance-cust_meridians");
    expect(badge).toHaveTextContent("Low balance");
    expect(badge).toHaveTextContent(
      "Low balance: 250,000 tokens remaining; warning threshold 300,000 tokens"
    );
  });

  it("does not show a token balance for customers without an active prepaid arrangement", async () => {
    const { repository } = createInMemoryRepository();
    render(
      <RepositoryProvider repository={repository}>
        <CustomersPage />
      </RepositoryProvider>
    );

    const row = await screen.findByTestId("customer-row-cust_northwind");
    expect(row).not.toHaveTextContent("tokens");
    expect(screen.queryByTestId("low-balance-cust_northwind")).not.toBeInTheDocument();
  });
});
