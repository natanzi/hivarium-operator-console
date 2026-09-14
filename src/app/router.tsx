import type { ReactNode } from "react";
import { Navigate, createBrowserRouter } from "react-router";

import { Layout } from "@/components/layout/Layout";
import { Toaster } from "@/components/ui/sonner";
import { RepositoryProvider } from "@/data/repository-context";
import { apiRepository } from "@/data/api-repository";
import { AboutPage } from "@/features/about/pages/AboutPage";
import { AgentCatalogPage } from "@/features/agents/pages/AgentCatalogPage";
import { AgentDetailPage } from "@/features/agents/pages/AgentDetailPage";
import { CustomersPage } from "@/features/customers/pages/CustomersPage";
import { CreateCustomerPage } from "@/features/customers/pages/CreateCustomerPage";
import { EditCustomerPage } from "@/features/customers/pages/EditCustomerPage";
import { CustomerProfilePage } from "@/features/customers/pages/CustomerProfilePage";

/**
 * Phase 1 routes:
 *
 *   /                   → redirect to /customers
 *   /customers          → customers list (TanStack table + filters)
 *   /customers/new      → create customer form
 *   /customers/:id      → customer profile (tabs: overview, subscriptions,
 *                         entitlements, licenses)
 *   /customers/:id/edit → edit customer form
 *   /agents             → read-only agent catalog
 *   /agents/:id         → agent detail (capability + reverse customer access)
 *   /settings/about     → product information
 */
function withLayout(
  children: ReactNode
): ReactNode {
  return (
    <Layout>
      {children}
      <Toaster richColors position="bottom-right" />
    </Layout>
  );
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: (
      <RepositoryProvider repository={apiRepository}>
        <RootRedirect />
      </RepositoryProvider>
    ),
  },
  {
    path: "/customers",
    element: (
      <RepositoryProvider repository={apiRepository}>
        {withLayout(<CustomersPage />)}
      </RepositoryProvider>
    ),
  },
  {
    path: "/customers/new",
    element: (
      <RepositoryProvider repository={apiRepository}>
        {withLayout(<CreateCustomerPage />)}
      </RepositoryProvider>
    ),
  },
  {
    path: "/customers/:customerId/edit",
    element: (
      <RepositoryProvider repository={apiRepository}>
        {withLayout(<EditCustomerPage />)}
      </RepositoryProvider>
    ),
  },
  {
    path: "/customers/:customerId",
    element: (
      <RepositoryProvider repository={apiRepository}>
        {withLayout(<CustomerProfilePage />)}
      </RepositoryProvider>
    ),
  },
  {
    path: "/agents",
    element: (
      <RepositoryProvider repository={apiRepository}>
        {withLayout(<AgentCatalogPage />)}
      </RepositoryProvider>
    ),
  },
  {
    path: "/agents/:agentProductId",
    element: (
      <RepositoryProvider repository={apiRepository}>
        {withLayout(<AgentDetailPage />)}
      </RepositoryProvider>
    ),
  },
  {
    path: "/settings/about",
    element: (
      <RepositoryProvider repository={apiRepository}>
        {withLayout(<AboutPage />)}
      </RepositoryProvider>
    ),
  },
  {
    path: "*",
    element: (
      <RepositoryProvider repository={apiRepository}>
        {withLayout(<NotFound />)}
      </RepositoryProvider>
    ),
  },
]);

function RootRedirect() {
  return <Navigate to="/customers" replace />;
}

function NotFound() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
      <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
        404
      </p>
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-muted-foreground max-w-sm text-sm">
        The page you&apos;re looking for doesn&apos;t exist in this build.
      </p>
      <a
        href="/customers"
        className="mt-2 text-sm font-medium underline underline-offset-4"
      >
        Back to Customers
      </a>
    </div>
  );
}
