import { ArrowLeft, Building2, KeyRound, ShieldCheck } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useParams } from "react-router";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, TableFooter } from "@/components/ui/primitives";
import { PageHeader } from "@/components/layout/Layout";
import {
  DataTable,
  type DataTableColumn,
} from "@/data/data-table";
import {
  CUSTOMER_STATUS_LABELS,
  PLAN_LABELS,
  STATUS_BADGE_CLASS,
} from "@/data/seed-data";
import { useRepository } from "@/data/repository-context";
import { customerAge, formatDate } from "@/lib/format";
import type {
  AgentLicense,
  AgentProduct,
  FeatureEntitlement,
  Subscription,
} from "@/domain/types";
import { cn } from "@/lib/utils";

/**
 * Customer profile screen.
 *
 * Shows a single customer's overview plus their subscriptions, feature
 * entitlements and agent licenses, each in its own tab. All content is read
 * from the repository; nothing on this screen mutates data.
 */
export function CustomerProfilePage() {
  const { customerId = "" } = useParams<{ customerId: string }>();
  const repo = useRepository();

  const customer = useMemo(
    () => repo.getCustomer(customerId),
    [repo, customerId]
  );
  const subscriptions = useMemo(
    () => repo.getSubscriptions(customerId),
    [repo, customerId]
  );
  const entitlements = useMemo(
    () => repo.getFeatureEntitlements(customerId),
    [repo, customerId]
  );
  const licenses = useMemo(
    () => repo.getAgentLicenses(customerId),
    [repo, customerId]
  );
  const products = useMemo(
    () => new Map(repo.listAgentProducts().map((p) => [p.id, p])),
    [repo]
  );

  if (!customer) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <Building2 className="text-muted-foreground size-10" />
        <div>
          <h1 className="text-2xl font-semibold">Customer not found</h1>
          <p className="text-muted-foreground mt-1 max-w-sm text-sm">
            No customer with id <code className="font-mono">{customerId}</code>{" "}
            exists in this store.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <a href="/customers">Back to customers</a>
        </Button>
      </div>
    );
  }

  const productName = (id: string) => products.get(id)?.name ?? id;

  const seatTotal = subscriptions.reduce(
    (n, s) => (s.status === "active" || s.status === "trialing" ? n + s.seats : n),
    0
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={customer.name}
        id="customer-profile-title"
        description={`${customer.domain} · Customer since ${formatDate(customer.createdAt)}`}
      >
        <Button variant="ghost" size="sm" asChild>
          <a href="/customers" data-testid="back-to-customers">
            <ArrowLeft className="size-4" />
            Back to customers
          </a>
        </Button>
      </PageHeader>

      <CustomerOverviewCard customer={customer} seatTotal={seatTotal} />

      <ProfileTabs
        defaultKey="overview"
        tabs={[
          { key: "overview", label: "Overview" },
          {
            key: "subscriptions",
            label: `Subscriptions (${subscriptions.length})`,
          },
          {
            key: "entitlements",
            label: `Entitlements (${entitlements.length})`,
          },
          { key: "licenses", label: `Licenses (${licenses.length})` },
        ]}
        getPanel={(key) => {
          switch (key) {
            case "overview":
              return (
                <OverviewPanel
                  notes={customer.notes}
                  contact={customer.contact}
                  email={customer.email}
                  domain={customer.domain}
                  createdAt={customer.createdAt}
                />
              );
            case "subscriptions":
              return (
                <DataTable
                  columns={subscriptionColumns(productName)}
                  data={subscriptions}
                  getRowId={(s) => s.id}
                  ariaLabel="Subscriptions"
                  emptyMessage="No subscriptions for this customer."
                />
              );
            case "entitlements":
              return (
                <DataTable
                  columns={entitlementColumns}
                  data={entitlements}
                  getRowId={(e) => e.id}
                  ariaLabel="Feature entitlements"
                  emptyMessage="No feature entitlements for this customer."
                />
              );
            case "licenses":
              return (
                <DataTable
                  columns={licenseColumns(productName)}
                  data={licenses}
                  getRowId={(l) => l.id}
                  ariaLabel="Agent licenses"
                  emptyMessage="No agent licenses for this customer."
                />
              );
          }
        }}
      />
    </div>
  );
}

function CustomerOverviewCard({
  customer,
  seatTotal,
}: {
  customer: import("@/domain/types").Customer;
  seatTotal: number;
}) {
  return (
    <Card
      className="border-sage/30 bg-sage-soft/30"
      data-testid="customer-overview"
    >
      <CardContent className="flex flex-wrap items-center gap-4">
        <Avatar name={customer.name} id={customer.id} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
                STATUS_BADGE_CLASS[customer.status]
              )}
            >
              {CUSTOMER_STATUS_LABELS[customer.status]}
            </span>
            <span className="text-muted-foreground text-xs">
              {customerAge(customer.createdAt)}
            </span>
          </div>
          <p className="text-muted-foreground mt-1.5 text-xs">
            {customer.contact} · {customer.email}
          </p>
        </div>
        <div className="flex items-center gap-6">
          <Metric label="Active seats" value={seatTotal} />
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="text-right">
      <p className="text-2xl leading-none font-semibold tabular-nums">{value}</p>
      <p className="text-muted-foreground mt-1 text-xs">{label}</p>
    </div>
  );
}

function OverviewPanel({
  notes,
  contact,
  email,
  domain,
  createdAt,
}: {
  notes: string;
  contact: string;
  email: string;
  domain: string;
  createdAt: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="text-sm max-w-2xl leading-relaxed text-foreground/90">
        {notes || "No operator notes recorded for this customer."}
      </div>
      <dl className="grid gap-4 sm:grid-cols-3">
        <Detail label="Primary contact" value={contact} />
        <Detail label="Email" value={email} />
        <Detail label="Domain" value={domain} />
      </dl>
      <Detail label="Customer since" value={formatDate(createdAt)} />
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-border rounded-lg border px-3 py-2">
      <dt className="text-muted-foreground text-xs tracking-wide uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm break-words">{value}</dd>
    </div>
  );
}

/**
 * Lightweight tab strip backed by local state. The screen stays self-contained
 * (the router supplies no tab segment in Phase 1).
 */
function ProfileTabs({
  defaultKey,
  tabs,
  getPanel,
}: {
  defaultKey: string;
  tabs: { key: string; label: string }[];
  getPanel: (key: string) => ReactNode;
}) {
  const [active, setActive] = useState(defaultKey);
  const current = tabs.find((t) => t.key === active) ?? tabs[0];

  return (
    <div className="flex flex-col gap-4">
      <div
        className="border-border flex w-fit flex-wrap gap-1 rounded-lg border p-1"
        role="tablist"
        aria-label="Customer sections"
      >
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={`tab-${tab.key}`}
            aria-selected={active === tab.key}
            aria-controls={`panel-${tab.key}`}
            data-testid={`tab-${tab.key}`}
            onClick={() => setActive(tab.key)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              active === tab.key
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        className="rounded-xl border bg-card p-4 shadow-sm md:p-6"
        role="tabpanel"
        id={`panel-${current.key}`}
        aria-labelledby={`tab-${current.key}`}
        data-testid={`panel-${current.key}`}
      >
        {getPanel(current.key)}
      </div>
      <TableFooter backTo="/customers" backLabel="All customers" />
    </div>
  );
}

function subscriptionColumns(productName: (id: string) => string): DataTableColumn<Subscription>[] {
  return [
    {
      id: "product",
      header: "Agent product",
      cell: (s) => <span className="text-sm font-medium">{productName(s.agentProductId)}</span>,
    },
    {
      id: "plan",
      header: "Plan",
      cell: (s) => (
        <Badge variant="outline" className="text-xs">
          {PLAN_LABELS[s.plan]}
        </Badge>
      ),
    },
    {
      id: "seats",
      header: "Seats",
      cell: (s) => <span className="tabular-nums text-sm">{s.seats}</span>,
    },
    {
      id: "renewsAt",
      header: "Renews",
      cell: (s) => <span className="text-sm">{formatDate(s.renewsAt)}</span>,
    },
    {
      id: "status",
      header: "Status",
      cell: (s) => <SubscriptionStatusBadge status={s.status} />,
    },
  ];
}

const entitlementColumns: DataTableColumn<FeatureEntitlement>[] = [
  {
    id: "feature",
    header: "Feature",
    cell: (e) => <span className="font-mono text-xs">{e.feature}</span>,
  },
  {
    id: "description",
    header: "Description",
    cell: (e) => (
      <span className="text-muted-foreground text-sm">{e.description}</span>
    ),
  },
  {
    id: "grantedAt",
    header: "Granted",
    cell: (e) => <span className="text-sm">{formatDate(e.grantedAt)}</span>,
  },
  {
    id: "expiresAt",
    header: "Expires",
    cell: (e) => (
      <span className="text-sm">
        {e.expiresAt ? formatDate(e.expiresAt) : "No expiry"}
      </span>
    ),
  },
];

function licenseColumns(
  productName: (id: string) => string
): DataTableColumn<AgentLicense>[] {
  return [
    {
      id: "product",
      header: "Agent product",
      cell: (l) => <span className="text-sm font-medium">{productName(l.agentProductId)}</span>,
    },
    {
      id: "seats",
      header: "Seats",
      cell: (l) => <span className="tabular-nums text-sm">{l.seats}</span>,
    },
    {
      id: "issuedAt",
      header: "Issued",
      cell: (l) => <span className="text-sm">{formatDate(l.issuedAt)}</span>,
    },
    {
      id: "expiresAt",
      header: "Expires",
      cell: (l) => (
        <span className="text-sm">
          {l.expiresAt ? formatDate(l.expiresAt) : "No expiry"}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (l) => <LicenseStatusBadge status={l.status} />,
    },
  ];
}

function SubscriptionStatusBadge({
  status,
}: {
  status: Subscription["status"];
}) {
  const tone =
    status === "active"
      ? "border-sage/40 bg-sage-soft text-sage"
      : status === "trialing"
        ? "border-gold/40 bg-gold-soft text-gold"
        : "text-muted-foreground border-border bg-muted";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize",
        tone
      )}
    >
      {status}
    </span>
  );
}

function LicenseStatusBadge({ status }: { status: AgentLicense["status"] }) {
  const tone =
    status === "active"
      ? "border-sage/40 bg-sage-soft text-sage"
      : status === "expiring"
        ? "border-gold/40 bg-gold-soft text-gold"
        : status === "revoked"
          ? "text-destructive border-destructive/30 bg-destructive/10"
          : "text-muted-foreground border-border bg-muted";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize",
        tone
      )}
    >
      {status === "active" ? (
        <ShieldCheck className="size-3" />
      ) : (
        <KeyRound className="size-3" />
      )}
      {status}
    </span>
  );
}
