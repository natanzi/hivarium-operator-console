import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CustomersPage } from "./CustomersPage";
import { createInMemoryRepository } from "@/data/local-storage-repository";
import { RepositoryProvider } from "@/data/repository-context";

describe("CustomersPage deletion", () => {
  it("requires confirmation and removes the customer with related local records", async () => {
    const { repository } = createInMemoryRepository();
    const customer = repository
      .listCustomers()
      .find((candidate) => repository.getSubscriptions(candidate.id).length > 0)!;

    render(
      <RepositoryProvider repository={repository}>
        <CustomersPage />
      </RepositoryProvider>
    );

    fireEvent.click(screen.getByTestId(`delete-${customer.id}`));

    expect(
      screen.getByRole("heading", { name: `Delete ${customer.name}?` })
    ).toBeInTheDocument();
    expect(repository.getCustomer(customer.id)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(repository.getCustomer(customer.id)).toBeDefined();

    fireEvent.click(screen.getByTestId(`delete-${customer.id}`));
    fireEvent.click(screen.getByTestId(`confirm-delete-${customer.id}`));

    await waitFor(() =>
      expect(screen.queryByTestId(`customer-row-${customer.id}`)).not.toBeInTheDocument()
    );
    expect(repository.getCustomer(customer.id)).toBeUndefined();
    expect(repository.getSubscriptions(customer.id)).toHaveLength(0);
    expect(repository.getFeatureEntitlements(customer.id)).toHaveLength(0);
    expect(repository.getAgentLicenses(customer.id)).toHaveLength(0);
    expect(screen.getByTestId("summary-total")).toHaveTextContent("5");
  });
});

describe("CustomersPage prepaid balance", () => {
  it("shows the derived token balance for an active prepaid customer without a low-balance badge above threshold", () => {
    const { repository } = createInMemoryRepository();
    render(
      <RepositoryProvider repository={repository}>
        <CustomersPage />
      </RepositoryProvider>
    );

    const row = screen.getByTestId("customer-row-cust_meridians");
    expect(row).toHaveTextContent("250,000 tokens");
    expect(screen.queryByTestId("low-balance-cust_meridians")).not.toBeInTheDocument();
  });

  it("shows the Low balance badge with accessible balance and threshold text at or below threshold", () => {
    const { repository } = createInMemoryRepository();
    repository.updateWarningThreshold("cust_meridians", 300000);
    render(
      <RepositoryProvider repository={repository}>
        <CustomersPage />
      </RepositoryProvider>
    );

    const row = screen.getByTestId("customer-row-cust_meridians");
    expect(row).toHaveTextContent("250,000 tokens");
    expect(row).toHaveTextContent("300,000 tokens");
    const badge = screen.getByTestId("low-balance-cust_meridians");
    expect(badge).toHaveTextContent("Low balance");
    expect(badge).toHaveTextContent(
      "Low balance: 250,000 tokens remaining; warning threshold 300,000 tokens"
    );
  });

  it("does not show a token balance for customers without an active prepaid arrangement", () => {
    const { repository } = createInMemoryRepository();
    render(
      <RepositoryProvider repository={repository}>
        <CustomersPage />
      </RepositoryProvider>
    );

    const row = screen.getByTestId("customer-row-cust_northwind");
    expect(row).not.toHaveTextContent("tokens");
    expect(screen.queryByTestId("low-balance-cust_northwind")).not.toBeInTheDocument();
  });
});
