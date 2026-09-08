import { fireEvent, screen, waitFor } from "@testing-library/react";
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
  it("renders the page title and pre-fills the form with the customer", () => {
    renderEditPage();
    expect(screen.getByTestId("page-title").textContent).toBe(
      "Edit Northwind Trading"
    );
    expect(screen.getByTestId("edit-customer-card")).toBeInTheDocument();
    const form = screen.getByTestId("submit-customer").closest("form")!;
    expect(form.querySelector("[name='name']")).toHaveValue("Northwind Trading");
    expect(form.querySelector("[name='domain']")).toHaveValue("northwind.example");
    expect(form.querySelector("[name='contact']")).toHaveValue("Ingrid Halvorsen");
  });

  it("shows a not-found state for unknown ids", () => {
    renderEditPage("does_not_exist");
    expect(screen.getByText("Customer not found")).toBeInTheDocument();
    expect(screen.queryByTestId("edit-customer-card")).not.toBeInTheDocument();
  });

  it("persists edits through updateCustomer when the form is valid", async () => {
    renderEditPage();
    const form = screen.getByTestId("submit-customer").closest("form")!;

    fireEvent.change(form.querySelector("[name='name']")!, {
      target: { value: "Northwind Trading Co." },
    });
    fireEvent.change(form.querySelector("[name='contact']")!, {
      target: { value: "Ingrid Halvorsen Jr." },
    });
    fireEvent.click(screen.getByTestId("submit-customer"));

    await waitFor(() => {
      const updated = repository.getCustomer("cust_northwind");
      expect(updated?.name).toBe("Northwind Trading Co.");
      expect(updated?.contact).toBe("Ingrid Halvorsen Jr.");
    });
  });
});