import { ArrowLeft, Building2, Pencil } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useParams } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/Layout";
import { Avatar, TableFooter } from "@/components/ui/primitives";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable, type DataTableColumn } from "@/data/data-table";
import {
  CUSTOMER_STATUS_LABELS,
  SEED_NOW,
  STATUS_BADGE_CLASS,
} from "@/data/seed-data";
import { useRepository } from "@/data/repository-context";
import { formatDate } from "@/lib/format";
import type {
  AgentAccessGrant,
  AgentProduct,
  CommercialArrangement,
  Customer,
  FeatureEntitlement,
} from "@/domain/types";
import type {
  AgentAccessSnapshot,
  CommercialSnapshot,
} from "@/data/local-storage-repository";
import { cn } from "@/lib/utils";
import {
  CommercialArrangementSheet,
  TerminateArrangementDialog,
  ArrangementRecordDialog,
} from "@/features/customers/components/CommercialArrangementSheet";
import { AgentAccessSheet, RevokeAccessDialog } from "@/features/customers/components/AgentAccessSheet";
import { ActivityTimeline } from "@/features/customers/components/ActivityTimeline";
import {
  formatUsd,
  modelImportantDate,
  modelLabel,
  modelPrimaryValue,
  TOUCH_TARGET,
} from "@/features/customers/components/format";

/**
 * Customer profile screen.
 *
 * Exactly four accessible tabs (Overview, Commercial, Agent Access, Activity)
 * compose the canonical commercial/access projections from the repository.
 * The Commercial and Agent Access tabs open focused drawers for set/change/
 * review/terminate and grant/revoke workflows; Activity is a semantic
 * newest-first timeline.
 */
export function CustomerProfilePage() {
  const { customerId = "" } = useParams<{ customerId: string }>();
  const repo = useRepository();
  const [, setRevision] = useState(0);
  const [commercialSheetOpen, setCommercialSheetOpen] = useState(false);
  const [accessSheetOpen, setAccessSheetOpen] = useState(false);

  const customer = useMemo(
    () => repo.getCustomer(customerId),
    [repo, customerId]
  );
  // The repository is synchronous, so snapshots are re-read on every render;
  // `refresh` bumps the revision state to re-render after a mutation.
  const commercialSnapshot = repo.getCommercialSnapshot(customerId, SEED_NOW);
  const accessSnapshot = repo.getAgentAccessSnapshot(customerId, SEED_NOW);
  const activityEvents = repo.listActivityEvents(customerId);
  const entitlements = useMemo(
    () => repo.getFeatureEntitlements(customerId),
    [repo, customerId]
  );
  const products = useMemo(
    () => new Map(repo.listAgentProducts().map((p) => [p.id, p])),
    [repo]
  );

  const refresh = useCallback(() => setRevision((r) => r + 1), []);

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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={customer.name}
        id="customer-profile-title"
        description={`${customer.domain} · Customer since ${formatDate(customer.createdAt)}`}
      >
        <Button variant="outline" size="sm" asChild>
          <a href={`/customers/${customer.id}/edit`} data-testid="edit-customer-button">
            <Pencil className="size-4" />
            Edit customer
          </a>
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <a href="/customers" data-testid="back-to-customers">
            <ArrowLeft className="size-4" />
            Back to customers
          </a>
        </Button>
      </PageHeader>

      <Tabs defaultValue="overview" className="gap-4">
        <TabsList
          aria-label="Customer sections"
          className="h-11 max-w-full overflow-x-auto md:h-9"
        >
          <TabsTrigger value="overview" data-testid="tab-overview">
            Overview
          </TabsTrigger>
          <TabsTrigger value="commercial" data-testid="tab-commercial">
            Commercial
          </TabsTrigger>
          <TabsTrigger value="access" data-testid="tab-agent-access">
            Agent Access
          </TabsTrigger>
          <TabsTrigger value="activity" data-testid="tab-activity">
            Activity
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview" data-testid="panel-overview">
          <OverviewPanel
            customer={customer}
            snapshot={commercialSnapshot}
            activeAgentCount={accessSnapshot.current.length}
            entitlements={entitlements}
            onSetCommercial={() => setCommercialSheetOpen(true)}
          />
        </TabsContent>
        <TabsContent value="commercial" data-testid="panel-commercial">
          <CommercialPanel
            customer={customer}
            snapshot={commercialSnapshot}
            activeGrantCount={accessSnapshot.current.length}
            onChanged={refresh}
            onChangeCommercial={() => setCommercialSheetOpen(true)}
          />
        </TabsContent>
        <TabsContent value="access" data-testid="panel-agent-access">
          <AgentAccessPanel
            customer={customer}
            snapshot={accessSnapshot}
            products={products}
            onChanged={refresh}
            onGrantAccess={() => setAccessSheetOpen(true)}
          />
        </TabsContent>
        <TabsContent value="activity" data-testid="panel-activity">
          <ActivityTimeline events={activityEvents} products={products} />
        </TabsContent>
      </Tabs>

      <CommercialArrangementSheet
        customer={customer}
        snapshot={commercialSnapshot}
        open={commercialSheetOpen}
        onOpenChange={setCommercialSheetOpen}
        onSaved={refresh}
      />
      <AgentAccessSheet
        customer={customer}
        snapshot={accessSnapshot}
        products={products}
        open={accessSheetOpen}
        onOpenChange={setAccessSheetOpen}
        onSaved={refresh}
      />

      <TableFooter backTo="/customers" backLabel="All customers" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------

function OverviewPanel({
  customer,
  snapshot,
  activeAgentCount,
  entitlements,
  onSetCommercial,
}: {
  customer: Customer;
  snapshot: CommercialSnapshot;
  activeAgentCount: number;
  entitlements: FeatureEntitlement[];
  onSetCommercial: () => void;
}) {
  const active = snapshot.active;
  return (
    <div className="flex flex-col gap-4">
      <div
        className="border-border rounded-xl border bg-card p-4"
        data-testid="overview-summary-band"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
              STATUS_BADGE_CLASS[customer.status]
            )}
          >
            {CUSTOMER_STATUS_LABELS[customer.status]}
          </span>
          {active ? (
            <Badge variant="outline" className="border-sage/40 text-sage">
              {modelLabel(active.model)}
            </Badge>
          ) : (
            <Badge variant="outline">No commercial model</Badge>
          )}
        </div>
        <dl className="mt-3 grid gap-3 sm:grid-cols-3">
          <OverviewMetric
            label="Commercial value"
            value={active ? modelPrimaryValue(active) : "—"}
          />
          <OverviewMetric
            label="Important date"
            value={overviewImportantDate(snapshot)}
          />
          <OverviewMetric
            label={activeAgentCount === 1 ? "Active agent" : "Active agents"}
            value={String(activeAgentCount)}
          />
        </dl>
        <div className="mt-4">
          <Button
            onClick={onSetCommercial}
            data-testid="overview-commercial-action"
            className={TOUCH_TARGET}
          >
            {active ? "Change commercial model" : "Set commercial model"}
          </Button>
        </div>
      </div>

      <div className="text-sm max-w-2xl leading-relaxed text-foreground/90">
        {customer.notes || "No operator notes recorded for this customer."}
      </div>

      <dl className="grid gap-4 sm:grid-cols-3">
        <Detail label="Primary contact" value={customer.contact} />
        <Detail label="Email" value={customer.email} />
        <Detail label="Domain" value={customer.domain} />
      </dl>
      <Detail label="Customer since" value={formatDate(customer.createdAt)} />

      <div>
        <h3 className="text-sm font-semibold">Feature entitlements</h3>
        {entitlements.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-2">
            {entitlements.map((entitlement) => (
              <li
                key={entitlement.id}
                className="border-border rounded-lg border px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs">{entitlement.feature}</span>
                  <span className="text-muted-foreground text-xs">
                    {entitlement.expiresAt
                      ? `Expires ${formatDate(entitlement.expiresAt)}`
                      : "No expiry"}
                  </span>
                </div>
                <p className="text-muted-foreground text-sm">
                  {entitlement.description}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground mt-2 text-sm">
            No feature entitlements for this customer.
          </p>
        )}
      </div>
    </div>
  );
}

function overviewImportantDate(snapshot: CommercialSnapshot): string {
  if (snapshot.scheduled) {
    return `Scheduled change ${formatDate(snapshot.scheduled.effectiveFrom)}`;
  }
  if (!snapshot.active) return "—";
  return modelImportantDate(snapshot.active);
}

function OverviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-border rounded-lg border px-3 py-2">
      <dt className="text-muted-foreground text-xs tracking-wide uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-semibold tabular-nums break-words">
        {value}
      </dd>
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

function EmptyState({ heading, body }: { heading: string; body: string }) {
  return (
    <div className="border-border flex flex-col items-center gap-2 rounded-xl border bg-card px-4 py-8 text-center">
      <h3 className="text-sm font-semibold">{heading}</h3>
      <p className="text-muted-foreground max-w-sm text-sm">{body}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Commercial tab
// ---------------------------------------------------------------------------

function CommercialPanel({
  customer,
  snapshot,
  activeGrantCount,
  onChanged,
  onChangeCommercial,
}: {
  customer: Customer;
  snapshot: CommercialSnapshot;
  activeGrantCount: number;
  onChanged: () => void;
  onChangeCommercial: () => void;
}) {
  const [terminateTarget, setTerminateTarget] =
    useState<CommercialArrangement | null>(null);
  const [recordTarget, setRecordTarget] =
    useState<CommercialArrangement | null>(null);

  return (
    <div className="flex flex-col gap-6">
      {snapshot.active ? (
        <ArrangementCard
          arrangement={snapshot.active}
          onChange={onChangeCommercial}
          onTerminate={() => setTerminateTarget(snapshot.active)}
        />
      ) : (
        <EmptyState
          heading="No commercial model is active"
          body="Choose how this customer uses Hivarium before granting agent access."
        />
      )}

      {snapshot.scheduled ? (
        <div
          className="border-gold/40 bg-gold-soft flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3"
          data-testid="scheduled-change"
        >
          <div>
            <p className="text-sm font-medium">Scheduled change</p>
            <p className="text-muted-foreground text-xs">
              Effective {formatDate(snapshot.scheduled.effectiveFrom)} ·{" "}
              {modelLabel(snapshot.scheduled.model)}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onChangeCommercial}
            data-testid="review-scheduled-change"
          >
            Review scheduled change
          </Button>
        </div>
      ) : null}

      {snapshot.history.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold">Arrangement history</h3>
          <div className="mt-2 overflow-x-auto">
            <DataTable
              columns={arrangementHistoryColumns(setRecordTarget)}
              data={snapshot.history}
              getRowId={(a) => a.id}
              ariaLabel="Arrangement history"
              emptyMessage="No prior arrangements for this customer."
            />
          </div>
        </div>
      ) : null}

      {terminateTarget ? (
        <TerminateArrangementDialog
          customer={customer}
          arrangement={terminateTarget}
          activeGrantCount={activeGrantCount}
          open
          onOpenChange={(open) => {
            if (!open) setTerminateTarget(null);
          }}
          onTerminated={onChanged}
        />
      ) : null}

      {recordTarget ? (
        <ArrangementRecordDialog
          arrangement={recordTarget}
          open
          onOpenChange={(open) => {
            if (!open) setRecordTarget(null);
          }}
        />
      ) : null}
    </div>
  );
}

function ArrangementCard({
  arrangement,
  onChange,
  onTerminate,
}: {
  arrangement: CommercialArrangement;
  onChange: () => void;
  onTerminate: () => void;
}) {
  return (
    <div
      className="border-sage/40 bg-sage-soft rounded-xl border p-4"
      data-testid="active-arrangement"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="border-sage/40 bg-sage-soft text-sage">
            {modelLabel(arrangement.model)}
          </Badge>
          <span className="text-muted-foreground text-xs capitalize">
            {arrangement.status}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onChange}
            data-testid="change-commercial-model"
          >
            Change commercial model
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:bg-destructive/10"
            onClick={onTerminate}
            data-testid="terminate-arrangement"
          >
            Terminate arrangement
          </Button>
        </div>
      </div>
      <dl className="mt-3 grid gap-3 sm:grid-cols-3">
        {arrangementTerms(arrangement)}
      </dl>
      {arrangement.reason ? (
        <p className="text-muted-foreground mt-3 text-xs">{arrangement.reason}</p>
      ) : null}
    </div>
  );
}

function arrangementTerms(arrangement: CommercialArrangement) {
  if (arrangement.model === "monthly") {
    return (
      <>
        <Detail
          label="Monthly amount"
          value={formatUsd(arrangement.monthlyAmountCents)}
        />
        <Detail label="Effective" value={formatDate(arrangement.effectiveFrom)} />
        <Detail label="Next renewal" value={formatDate(arrangement.renewsAt)} />
      </>
    );
  }
  if (arrangement.model === "prepaid") {
    return (
      <>
        <Detail label="Balance" value={formatUsd(arrangement.balanceCents)} />
        <Detail label="Effective" value={formatDate(arrangement.effectiveFrom)} />
        <Detail
          label="Expires"
          value={
            arrangement.expiresAt ? formatDate(arrangement.expiresAt) : "No expiry"
          }
        />
        <Detail
          label="Usage accounting"
          value="Added in Phase 2"
        />
      </>
    );
  }
  return (
    <>
      <Detail
        label="Contract value"
        value={formatUsd(arrangement.contractValueCents)}
      />
      <Detail
        label="Term"
        value={`${formatDate(arrangement.startsAt)} – ${formatDate(arrangement.endsAt)}`}
      />
      <Detail
        label="Allowance"
        value={`${arrangement.includedAllowance.toLocaleString()} ${arrangement.allowanceUnit}`}
      />
      <Detail
        label="Overage rate"
        value={`${formatUsd(arrangement.overageRateCentsPerUnit)} / unit`}
      />
      <Detail
        label="Renewal posture"
        value={
          arrangement.renewalStatus === "unknown"
            ? "Not recorded"
            : arrangement.renewalStatus
        }
      />
    </>
  );
}

function arrangementHistoryColumns(
  onViewRecord: (arrangement: CommercialArrangement) => void
): DataTableColumn<CommercialArrangement>[] {
  return [
    {
      id: "model",
      header: "Model",
      cell: (a) => (
        <span className="text-sm font-medium capitalize">{a.model}</span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (a) => <span className="text-sm capitalize">{a.status}</span>,
    },
    {
      id: "effectiveFrom",
      header: "Effective",
      cell: (a) => <span className="text-sm">{formatDate(a.effectiveFrom)}</span>,
    },
    {
      id: "terms",
      header: "Primary terms",
      cell: (a) => <span className="text-sm">{primaryTerms(a)}</span>,
    },
    {
      id: "reason",
      header: "Reason",
      cell: (a) => (
        <span className="text-muted-foreground text-sm">{a.reason}</span>
      ),
    },
    {
      id: "view",
      header: "",
      cell: (a) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onViewRecord(a)}
          data-testid={`view-record-${a.id}`}
        >
          View record
        </Button>
      ),
    },
  ];
}

function primaryTerms(arrangement: CommercialArrangement): string {
  if (arrangement.model === "monthly") {
    return `${formatUsd(arrangement.monthlyAmountCents)} / month`;
  }
  if (arrangement.model === "prepaid") {
    return `${formatUsd(arrangement.balanceCents)} balance`;
  }
  return `${formatUsd(arrangement.contractValueCents)} · ${arrangement.includedAllowance.toLocaleString()} ${arrangement.allowanceUnit}`;
}

// ---------------------------------------------------------------------------
// Agent Access tab
// ---------------------------------------------------------------------------

function AgentAccessPanel({
  customer,
  snapshot,
  products,
  onChanged,
  onGrantAccess,
}: {
  customer: Customer;
  snapshot: AgentAccessSnapshot;
  products: Map<string, AgentProduct>;
  onChanged: () => void;
  onGrantAccess: () => void;
}) {
  const [revokeTarget, setRevokeTarget] = useState<AgentAccessGrant | null>(
    null
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Current access</h3>
        <Button
          onClick={onGrantAccess}
          data-testid="grant-agent-access"
          className={TOUCH_TARGET}
        >
          Grant agent access
        </Button>
      </div>
      {snapshot.current.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {snapshot.current.map((grant) => (
            <GrantRow
              key={grant.id}
              grant={grant}
              products={products}
              status="active"
              onRevoke={() => setRevokeTarget(grant)}
            />
          ))}
        </ul>
      ) : (
        <EmptyState
          heading="No agents are available to this customer"
          body="Grant access to an agent from the Hivarium catalog."
        />
      )}

      {snapshot.scheduled.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold">Scheduled access</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {snapshot.scheduled.map((grant) => (
              <GrantRow
                key={grant.id}
                grant={grant}
                products={products}
                status="scheduled"
              />
            ))}
          </ul>
        </div>
      ) : null}

      {snapshot.history.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold">Access history</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {snapshot.history.map((grant) => (
              <GrantRow
                key={grant.id}
                grant={grant}
                products={products}
                status={grant.revokedAt !== null ? "revoked" : "expired"}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {revokeTarget ? (
        <RevokeAccessDialog
          customer={customer}
          grant={revokeTarget}
          product={products.get(revokeTarget.agentProductId)}
          open
          onOpenChange={(open) => {
            if (!open) setRevokeTarget(null);
          }}
          onRevoked={onChanged}
        />
      ) : null}
    </div>
  );
}

function GrantRow({
  grant,
  products,
  status,
  onRevoke,
}: {
  grant: AgentAccessGrant;
  products: Map<string, AgentProduct>;
  status: "active" | "scheduled" | "expired" | "revoked";
  onRevoke?: () => void;
}) {
  const product = products.get(grant.agentProductId);
  const tone =
    status === "active"
      ? "border-sage/40 bg-sage-soft text-sage"
      : status === "scheduled"
        ? "border-gold/40 bg-gold-soft text-gold"
        : status === "revoked"
          ? "text-destructive border-destructive/30 bg-destructive/10"
          : "text-muted-foreground border-border bg-muted";
  return (
    <li
      className="border-border flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3"
      data-testid={`grant-${grant.id}`}
    >
      <div className="min-w-0">
        <p
          className="text-sm font-medium break-words"
          title={product?.name ?? grant.agentProductId}
        >
          {product?.name ?? grant.agentProductId}
        </p>
        <p className="text-muted-foreground font-mono text-xs">
          {grant.agentProductId}
        </p>
      </div>
      <div className="text-muted-foreground flex flex-wrap items-center gap-4 text-xs">
        <span>Granted {formatDate(grant.startsAt)}</span>
        <span>{grant.endsAt ? `Ends ${formatDate(grant.endsAt)}` : "No end date"}</span>
        {grant.scheduledRevokeAt ? (
          <span>Revocation scheduled {formatDate(grant.scheduledRevokeAt)}</span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize",
            tone
          )}
        >
          {status}
        </span>
        {status === "active" && onRevoke ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:bg-destructive/10"
            onClick={onRevoke}
            data-testid={`revoke-${grant.id}`}
          >
            Revoke access
          </Button>
        ) : null}
      </div>
    </li>
  );
}