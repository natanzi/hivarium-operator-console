import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  Copy,
  RotateCcw,
  Search,
  Trash2,
  UserPlus,
} from "lucide-react";

import {
  CUSTOMER_STATUS_LABELS,
  PLAN_LABELS,
  STATUS_BADGE_CLASS,
} from "@/data/seed-data";
import { buildSeedStore } from "@/data/seed-data";
import type { HiveRepository } from "@/data/local-storage-repository";
import { createInMemoryRepository } from "@/data/local-storage-repository";
import { useRepository } from "@/data/repository-context";
import { customerAge, formatDate, initials } from "@/lib/format";
import type { Customer, CustomerStatus } from "@/domain/types";
import { cn } from "@/lib/utils";
import { DataTable, type DataTableColumn } from "@/data/data-table";
import { Avatar, StatRow } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  const [sortBy, setSortBy] = useState<"name" | "createdAt">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

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
      .sort((a, b) => {
        const av = sortBy === "name" ? a.name : a.createdAt;
        const bv = sortBy === "name" ? b.name : b.createdAt;
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return sortDir === "asc" ? cmp : -cmp;
      });
  }, [customers, search, status, sortBy, sortDir]);

  const statusCounts = useMemo(() => {
    const counts: Record<CustomerStatus, number> = {
      trial: 0,
      active: 0,
      paused: 0,
      churned: 0,
    };
    for (const c of customers) counts[c.status]++;
    return counts;
  }, [customers]);

  const toggleSort = (field: "name" | "createdAt") => {
    if (sortBy === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortDir("asc");
    }
  };

  const columns: DataTableColumn<Customer>[] = useMemo(
    () => [
      {
        id: "customer",
        header: "Customer",
        className: "min-w-[260px]",
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
        id: "contact",
        header: "Contact",
        cell: (c) => (
          <div className="leading-tight">
            <p className="text-sm">{c.contact}</p>
            <p className="text-muted-foreground text-xs">{c.email}</p>
          </div>
        ),
      },
      {
        id: "status",
        header: "Status",
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
        id: "createdAt",
        header: "Customer since",
        sortable: true,
        cell: (c) => (
          <span className="text-sm">
            {formatDate(c.createdAt)}{" "}
            <span className="text-muted-foreground text-xs">
              · {customerAge(c.createdAt)}
            </span>
          </span>
        ),
      },
      {
        id: "since",
        header: "Seats",
        cell: (c) => (
          <span className="tabular-nums text-sm">
            {repo.getSubscriptions(c.id).reduce(
              (n, s) => (s.status === "active" || s.status === "trialing" ? n + s.seats : n),
              0
            )}
          </span>
        ),
      },
    ],
    [repo]
  );

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

      <StatRow
        items={[
          {
            icon: UsersIcon,
            label: "Total",
            values: [{ value: "all", count: customers.length }],
            accent: "primary",
          },
          {
            icon: Check,
            label: "Active",
            values: [{ value: "active", count: statusCounts.active }],
            accent: "sage",
          },
          {
            icon: ArrowUp,
            label: "Trial",
            values: [{ value: "trial", count: statusCounts.trial }],
            accent: "gold",
          },
          {
            icon: ArrowDown,
            label: "Churned",
            values: [{ value: "churned", count: statusCounts.churned }],
            accent: "muted",
          },
        ]}
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
          {(["all", "active", "trial", "paused", "churned"] as const).map((s) => (
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

function UsersIcon({ className }: { className?: string }) {
  return <UserIcon className={className} />;
}

function UserIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function ResetData() {
  const repo = useRepository();
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
