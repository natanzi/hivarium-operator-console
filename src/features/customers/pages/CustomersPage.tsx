import { useMemo, useState } from "react";
import { RotateCcw, Search, UserPlus } from "lucide-react";

import {
  CUSTOMER_STATUS_LABELS,
  PLAN_LABELS,
  STATUS_BADGE_CLASS,
} from "@/data/seed-data";
import { buildSeedStore } from "@/data/seed-data";
import { createInMemoryRepository } from "@/data/local-storage-repository";
import { useRepository } from "@/data/repository-context";
import { formatDate } from "@/lib/format";
import type {
  AgentLicense,
  Customer,
  CustomerStatus,
  FeatureEntitlement,
  Subscription,
} from "@/domain/types";
import { cn } from "@/lib/utils";
import { DataTable, type DataTableColumn } from "@/data/data-table";
import { Avatar } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/layout/Layout";

type StatusFilter = CustomerStatus | "all";

/**
 * Customers list screen.
 *
 * Renders every customer in the repository as a TanStack table with
 * client-side search + status filter. Each row links to the customer
 * profile. The "New customer" button links to the creation screen.
 */
export function CustomersPage() {
  const repo = useRepository();
  const customers = useMemo(() => repo.listCustomers(), [repo]);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customers
      .filter((c) => (status === "all" ? true : c.status === status))
      .filter((c) =>
        q.length === 0
          ? true
          : c.name.toLowerCase().includes(q) ||
          c.domain.toLowerCase().includes(q) ||
          c.contact.toLowerCase().includes(q)
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [customers, search, status]);

  const statusCounts = useMemo(() => {
    const counts: Record<CustomerStatus, number> = {
      evaluation: 0,
      active: 0,
      paused: 0,
      churned: 0,
    };
    for (const c of customers) counts[c.status]++;
    return counts;
  }, [customers]);

  // Per-customer related records (subscriptions, entitlements, licenses) plus
  // the agent product catalog, so the table columns can render without
  // re-querying the repository for every row.
  const related = useMemo(() => {
    const subscriptions = new Map<string, Subscription[]>();
    const entitlements = new Map<string, FeatureEntitlement[]>();
    const licenses = new Map<string, AgentLicense[]>();
    const productNames = new Map(
      repo.listAgentProducts().map((p) => [p.id, p.name] as const)
    );
    for (const c of customers) {
      subscriptions.set(c.id, repo.getSubscriptions(c.id));
      entitlements.set(c.id, repo.getFeatureEntitlements(c.id));
      licenses.set(c.id, repo.getAgentLicenses(c.id));
    }
    return { subscriptions, entitlements, licenses, productNames };
  }, [repo, customers]);

  const columns: DataTableColumn<Customer>[] = useMemo(() => {
    const activeSubs = (c: Customer) =>
      (related.subscriptions.get(c.id) ?? []).filter(
        (s) => s.status === "active" || s.status === "trialing"
      );

    return [
      {
        id: "organization",
        header: "Organization",
        className: "min-w-[240px]",
        cell: (c) => (
          <div className="flex items-center gap-3">
            <Avatar name={c.name} id={c.id} />
            <div className="leading-tight">
              <p className="text-sm font-semibold">{c.name}</p>
              <p className="text-muted-foreground text-xs">{c.domain}</p>
            </div>
          </div>
        ),
      },
      {
        id: "lifecycle",
        header: "Lifecycle",
        cell: (c) => (
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
              STATUS_BADGE_CLASS[c.status]
            )}
            data-testid={`status-${c.status}`}
          >
            {CUSTOMER_STATUS_LABELS[c.status]}
          </span>
        ),
      },
      {
        id: "subscription",
        header: "Subscription",
        cell: (c) => {
          const subs = activeSubs(c);
          if (subs.length === 0) {
            return <span className="text-muted-foreground text-sm">—</span>;
          }
          const plans = [
            ...new Set(subs.map((s) => PLAN_LABELS[s.plan])),
          ].join(", ");
          const seats = subs.reduce((n, s) => n + s.seats, 0);
          return (
            <div className="leading-tight">
              <p className="text-sm">{plans}</p>
              <p className="text-muted-foreground text-xs tabular-nums">
                {seats} {seats === 1 ? "seat" : "seats"}
              </p>
            </div>
          );
        },
      },
      {
        id: "deployment",
        header: "Deployment",
        cell: (c) => {
          const names = [
            ...new Set(
              activeSubs(c).map(
                (s) =>
                  related.productNames.get(s.agentProductId) ??
                  s.agentProductId
              )
            ),
          ];
          if (names.length === 0) {
            return <span className="text-muted-foreground text-sm">—</span>;
          }
          return <span className="text-sm">{names.join(", ")}</span>;
        },
      },
      {
        id: "features",
        header: "Features",
        cell: (c) => {
          const list = related.entitlements.get(c.id) ?? [];
          if (list.length === 0) {
            return <span className="text-muted-foreground text-sm">—</span>;
          }
          return (
            <span
              className="tabular-nums text-sm"
              title={list.map((e) => e.feature).join(", ")}
            >
              {list.length}
            </span>
          );
        },
      },
      {
        id: "agents",
        header: "Agents",
        cell: (c) => {
          const list = related.licenses.get(c.id) ?? [];
          if (list.length === 0) {
            return <span className="text-muted-foreground text-sm">—</span>;
          }
          return (
            <span
              className="tabular-nums text-sm"
              title={list
                .map(
                  (l) =>
                    related.productNames.get(l.agentProductId) ??
                    l.agentProductId
                )
                .join(", ")}
            >
              {list.length}
            </span>
          );
        },
      },
      {
        id: "updated",
        header: "Updated",
        cell: (c) => {
          const dates = [
            ...(related.subscriptions.get(c.id) ?? []).map((s) => s.renewsAt),
            ...(related.entitlements.get(c.id) ?? []).map((e) => e.grantedAt),
            ...(related.licenses.get(c.id) ?? []).map((l) => l.issuedAt),
          ];
          const latest =
            dates.length > 0 ? dates.sort()[dates.length - 1] : c.createdAt;
          return <span className="text-sm">{formatDate(latest)}</span>;
        },
      },
      {
        id: "actions",
        header: "Actions",
        cell: (c) => (
          <div className="flex items-center gap-2">
            <a
              href={`/customers/${c.id}`}
              onClick={(e) => e.stopPropagation()}
              className="text-primary text-sm font-medium hover:underline"
              data-testid={`view-${c.id}`}
            >
              View
            </a>
            <a
              href={`/customers/${c.id}/edit`}
              onClick={(e) => e.stopPropagation()}
              className="text-muted-foreground hover:text-foreground text-sm"
              data-testid={`edit-${c.id}`}
            >
              Edit
            </a>
          </div>
        ),
      },
    ];
  }, [related]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Customers"
        description="Accounts onboarded to Hivarium, their lifecycle state, key contacts and subscription footprint."
        id="customers-page-title"
      >
        <Button asChild size="sm">
          <a href="/customers/new" data-testid="new-customer-button">
            <UserPlus className="size-4" />
            New customer
          </a>
        </Button>
      </PageHeader>

      <SummaryStrip
        total={customers.length}
        active={statusCounts.active}
        evaluation={statusCounts.evaluation}
        archived={statusCounts.churned}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, domain or contact…"
            aria-label="Search customers"
            data-testid="customer-search"
            className="bg-card pl-9"
          />
        </div>
        <div className="flex items-center gap-2" role="radiogroup" aria-label="Filter by status">
          {(["all", "active", "evaluation", "paused", "churned"] as const).map((s) => (
            <StatusPill
              key={s}
              selected={status === s}
              onClick={() => setStatus(s)}
              label={s === "all" ? "All" : CUSTOMER_STATUS_LABELS[s]}
            />
          ))}
        </div>
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        getRowId={(c) => c.id}
        rowLink={(c) => `/customers/${c.id}`}
        rowTestId={(c) => `customer-row-${c.id}`}
        ariaLabel="Customer list"
        pageSize={8}
        emptyMessage={
          search || status !== "all"
            ? "No customers match the current filters."
            : "No customers yet."
        }
      />

      <ResetData />
    </div>
  );
}

/**
 * Compact summary strip replacing the previous row of large stat cards.
 * Purely presentational — the status pills below the strip drive filtering.
 */
function SummaryStrip({
  total,
  active,
  evaluation,
  archived,
}: {
  total: number;
  active: number;
  evaluation: number;
  archived: number;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border bg-card px-4 py-2.5 shadow-sm"
      data-testid="summary-strip"
    >
      <span className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
        Summary
      </span>
      <SummaryItem label="Total" count={total} testId="summary-total" />
      <SummaryItem label="Active" count={active} testId="summary-active" />
      <SummaryItem
        label="Evaluation"
        count={evaluation}
        testId="summary-evaluation"
      />
      <SummaryItem label="Archived" count={archived} testId="summary-archived" />
    </div>
  );
}

function SummaryItem({
  label,
  count,
  testId,
}: {
  label: string;
  count: number;
  testId: string;
}) {
  return (
    <span className="flex items-baseline gap-1.5" data-testid={testId}>
      <span className="tabular-nums text-sm font-semibold">{count}</span>
      <span className="text-muted-foreground text-xs">{label}</span>
    </span>
  );
}

function StatusPill({
  selected,
  onClick,
  label,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      data-testid={`status-pill-${label.toLowerCase()}`}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : "bg-card text-muted-foreground border hover:border-primary/40 hover:text-foreground"
      )}
    >
      {label}
    </button>
  );
}

function ResetData() {
  const [confirmed, setConfirmed] = useState(false);
  const [lastReset, setLastReset] = useState<string | null>(null);

  const handleReset = () => {
    if (!confirmed) {
      setConfirmed(true);
      window.setTimeout(() => setConfirmed(false), 4000);
      return;
    }
    const seeded = createInMemoryRepository();
    seeded.repository.reset();
    const fresh = buildSeedStore();
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(
          "hivarium.operator-console.store.v1",
          JSON.stringify(fresh)
        );
      }
    } catch {
      /* localStorage unavailable – reset still works in-memory */
    }
    // Force the table to re-read by triggering a re-render via state.
    setLastReset(new Date().toISOString());
    setConfirmed(false);
  };

  return (
    <div className="mt-2 flex items-center justify-between border-t pt-4 text-xs">
      <p className="text-muted-foreground">
        Data is seeded on first load and persists to this browser&apos;s
        localStorage.
        {lastReset ? (
          <span className="ml-1 text-sage">Reset at {formatDate(lastReset)}.</span>
        ) : null}
      </p>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleReset}
        data-testid="reset-data-button"
        className={cn(
          "text-muted-foreground hover:text-destructive",
          confirmed && "text-destructive hover:text-destructive"
        )}
      >
        <RotateCcw className="size-4" />
        {confirmed ? "Click again to confirm" : "Reset sample data"}
      </Button>
    </div>
  );
}