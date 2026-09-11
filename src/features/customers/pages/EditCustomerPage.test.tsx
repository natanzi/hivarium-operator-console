import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { EditCustomerPage } from "./EditCustomerPage";
import { repository } from "@/data/local-storage-repository";
import { renderWithRepository } from "@/test/render";

/** Renders the page inside a memory router so useParams/useNavigate resolve. */
function renderEditPage(customerId = "cust_northwind") {
  const router = createMemoryRouter(
    [
      { path: "/customers/:customerId/edit", element: <EditCustomerPage /> },
      { path: "*", element: null },
    ],
    { initialEntries: [`/customers/${customerId}/edit`] }
  );
  return renderWithRepository(<RouterProvider router={router} />);
}

describe("EditCustomerPage", () => {
  it("renders the page title and pre-fills the form with the customer", async () => {
    renderEditPage();
    expect(await screen.findByTestId("submit-customer")).toBeInTheDocument();
    expect(screen.getByTestId("page-title").textContent).toBe(
      "Edit Northwind Trading"
    );
    expect(screen.getByTestId("edit-customer-card")).toBeInTheDocument();
    const form = screen.getByTestId("submit-customer").closest("form")!;
    expect(form.querySelector("[name='name']")).toHaveValue("Northwind Trading");
    expect(form.querySelector("[name='domain']")).toHaveValue("northwind.example");
    expect(form.querySelector("[name='contact']")).toHaveValue("Ingrid Halvorsen");
  });

  it("shows a not-found state for unknown ids", async () => {
    renderEditPage("does_not_exist");
    expect(await screen.findByText("Customer not found")).toBeInTheDocument();
    expect(screen.queryByTestId("edit-customer-card")).not.toBeInTheDocument();
  });

  it("persists edits through updateCustomer when the form is valid", async () => {
    renderEditPage();
    const submitBtn = await screen.findByTestId("submit-customer");
    const form = submitBtn.closest("form")!;

    // Wait for the async customer load + form.reset() to populate the fields
    await waitFor(() => {
      expect(form.querySelector("[name='name']")).toHaveValue("Northwind Trading");
    });

    const nameInput = form.querySelector("[name='name']") as HTMLInputElement;
    const contactInput = form.querySelector("[name='contact']") as HTMLInputElement;

    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Northwind Trading Co.");

    await userEvent.clear(contactInput);
    await userEvent.type(contactInput, "Ingrid Halvorsen Jr.");

    // Shadcn select sometimes loses value on async reset in JSdom
    await userEvent.click(screen.getByTestId("status-trigger"));
    await userEvent.click(screen.getByRole("option", { name: "Active" }));

    await userEvent.click(submitBtn);

    await new Promise((r) => setTimeout(r, 100));

    await waitFor(async () => {
      const updated = await repository.getCustomer("cust_northwind");
      expect(updated?.name).toBe("Northwind Trading Co.");
    });
  });
});