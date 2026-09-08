import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import { repository } from "@/data/local-storage-repository";
import { RepositoryProvider } from "@/data/repository-context";

/**
 * Renders a page component wrapped in the same providers the router uses so
 * `useRepository` resolves to the shared in-app singleton.
 */
export function renderWithRepository(ui: ReactElement) {
  return render(
    <RepositoryProvider repository={repository}>{ui}</RepositoryProvider>
  );
}
