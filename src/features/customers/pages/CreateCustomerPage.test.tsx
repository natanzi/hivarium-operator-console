import { fireEvent, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { CreateCustomerPage } from "./CreateCustomerPage";
import { repository } from "@/data/local-storage-repository";
import { renderWithRepository } from "@/test/render";
import { makeCustomerId } from "@/lib/format";

/** Renders the page inside a memory router so useNavigate resolves. */
function renderCreatePage() {
  const router = createMemoryRouter(
    [
      { path: "/customers/new", element: <CreateCustomerPage /> },
      { path: "*", element: null },
    ],
    { initialEntries: ["/customers/new"] }
  );
  return renderWithRepository(<RouterProvider router={router} />);
}

describe("CreateCustomerPage", () => {
  it("renders the page title and form card", () => {
    renderCreatePage();
    expect(screen.getByTestId("page-title").textContent).toBe("New customer");
    expect(screen.getByTestId("create-customer-card")).toBeInTheDocument();
    expect(screen.getByTestId("submit-customer")).toBeInTheDocument();
  });

  it("shows a validation error for an empty company name on submit", async () => {
    renderCreatePage();
    fireEvent.click(screen.getByTestId("submit-customer"));
    await waitFor(() =>
      expect(
        screen.getByText("Company name must be at least 2 characters.")
      ).toBeInTheDocument()
    );
  });

  it("shows a validation error for an invalid email", async () => {
    renderCreatePage();
    const form = screen.getByTestId("submit-customer").closest("form")!;
    fireEvent.change(
      form.querySelector("[name='name']")!,
      { target: { value: "Acme" } }
    );
    fireEvent.change(form.querySelector("[name='contact']")!, {
      target: { value: "Jane Doe" },
    });
    fireEvent.change(form.querySelector("[name='email']")!, {
      target: { value: "not-an-email" },
    });
    fireEvent.change(form.querySelector("[name='domain']")!, {
      target: { value: "acme.com" },
    });
    fireEvent.click(screen.getByTestId("submit-customer"));
    await waitFor(() =>
      expect(
        screen.getByText("Enter a valid email address.")
      ).toBeInTheDocument()
    );
  });

  it("blocks submission when the derived id already exists", async () => {
    renderCreatePage();
    const form = screen.getByTestId("submit-customer").closest("form")!;
    // "Northwind" derives to cust_northwind, which already exists in the seed.
    fireEvent.change(form.querySelector("[name='name']")!, {
      target: { value: "Northwind" },
    });
    expect(await screen.findByTestId("duplicate-note")).toBeInTheDocument();
    expect(screen.getByTestId("submit-customer")).toBeDisabled();
  });

  it("creates a new customer when the form is valid (repository is written)", async () => {
    renderCreatePage();
    const form = screen.getByTestId("submit-customer").closest("form")!;
    const name = "Zephyr Analytics";
    fireEvent.change(form.querySelector("[name='name']")!, {
      target: { value: name },
    });
    fireEvent.change(form.querySelector("[name='domain']")!, {
      target: { value: "zephyr.example" },
    });
    fireEvent.change(form.querySelector("[name='contact']")!, {
      target: { value: "Alice Zephyr" },
    });
    fireEvent.change(form.querySelector("[name='email']")!, {
      target: { value: "alice@zephyr.example" },
    });
    // status defaults to "trial" — leave it.
    fireEvent.click(screen.getByTestId("submit-customer"));

    const expectedId = makeCustomerId(name);
    await waitFor(() =>
      expect(repository.getCustomer(expectedId)).toBeDefined()
    );
  });
});
