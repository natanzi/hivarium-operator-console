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
