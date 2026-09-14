import { Archive, ArrowLeft, Building2, Pencil } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useParams } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/Layout";
import { Avatar, TableFooter } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
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
  ActivityEvent,
  AgentAccessGrant,
  AgentProduct,
  CommercialArrangement,
  Customer,
  FeatureEntitlement,
  LedgerTransaction,
  AuditEntry,
} from "@/domain/types";
import type { AccountStatementRow } from "@/domain/ledger-rules";
import type {
  AgentAccessSnapshot,
  CommercialSnapshot,
  PrepaidSnapshot,
} from "@/data/local-storage-repository";
import { cn } from "@/lib/utils";
import {
  CommercialArrangementSheet,
  TerminateArrangementDialog,
  ArrangementRecordDialog,
} from "@/features/customers/components/CommercialArrangementSheet";
import { AgentAccessSheet, RevokeAccessDialog } from "@/features/customers/components/AgentAccessSheet";
import { ActivityTimeline } from "@/features/customers/components/ActivityTimeline";
import { OperatorAuditTrail } from "@/features/customers/components/OperatorAuditTrail";
import { TokenStatement } from "@/features/customers/components/TokenStatement";
import { AddCreditSheet } from "@/features/customers/components/AddCreditSheet";
import { AdjustmentSheet } from "@/features/customers/components/AdjustmentSheet";
import { RecordUsageSheet } from "@/features/customers/components/RecordUsageSheet";
import { ReversalSheet } from "@/features/customers/components/ReversalSheet";
import { EditThresholdSheet } from "@/features/customers/components/EditThresholdSheet";
import {
  formatTokens,
  formatUsd,
  modelImportantDate,
  modelLabel,
  modelPrimaryValue,
  TOUCH_TARGET,
} from "@/features/customers/components/format";

/** One asynchronous read of every projection the profile composes. */
interface ProfileData {
  customer: Customer | undefined;
  commercialSnapshot: CommercialSnapshot;
  accessSnapshot: AgentAccessSnapshot;
  prepaidSnapshot: PrepaidSnapshot;
  activityEvents: ActivityEvent[];
  statementRows: AccountStatementRow[];
  entitlements: FeatureEntitlement[];
  products: Map<string, AgentProduct>;
  auditEntries: AuditEntry[];
}

/**
 * Customer profile screen.
 *
 * Exactly four accessible tabs (Overview, Commercial, Agent Access, Activity)
 * compose the canonical commercial/access projections from the repository.
 * The Commercial and Agent Access tabs open focused drawers for set/change/
 * review/terminate and grant/revoke workflows; Activity is a semantic
 * newest-first timeline.
 *
 * Reads flow through the asynchronous {@link HiveRepository}: the page shows
 * a skeleton while loading and a restrained error state with Retry that
 * re-runs the same read. Archived customers render a retention banner and
 * hide every mutation action while keeping all four tabs readable (D-05).
 */
export function CustomerProfilePage() {
  const { customerId = "" } = useParams<{ customerId: string }>();
  const repo = useRepository();
  const [data, setData] = useState<ProfileData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [commercialSheetOpen, setCommercialSheetOpen] = useState(false);
  const [accessSheetOpen, setAccessSheetOpen] = useState(false);
  const [addCreditOpen, setAddCreditOpen] = useState(false);
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [reversalOpen, setReversalOpen] = useState(false);
  const [reversalTarget, setReversalTarget] =
    useState<LedgerTransaction | null>(null);
  const [editThresholdOpen, setEditThresholdOpen] = useState(false);
  const addCreditButtonRef = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const customer = await repo.getCustomer(customerId);
      if (!customer) {
        setData({
          customer: undefined,
          commercialSnapshot: {
            customerId,
            asOf: SEED_NOW,
            active: null,
            scheduled: null,
            history: [],
          },
          accessSnapshot: {
            customerId,
            asOf: SEED_NOW,
            current: [],
            scheduled: [],
            history: [],
          },
          prepaidSnapshot: {
            customerId,
            asOf: SEED_NOW,
            arrangement: null,
            balanceTokens: 0,
            transactionCount: 0,
            lowBalance: false,
          },
          activityEvents: [],
          statementRows: [],
          entitlements: [],
          products: new Map(),
          auditEntries: [],
        });
        return;
      }
      const [
        commercialSnapshot,
        accessSnapshot,
        prepaidSnapshot,
        activityEvents,
        statementRows,
        entitlements,
        products,
        auditEntries,
      ] = await Promise.all([
        repo.getCommercialSnapshot(customerId, SEED_NOW),
        repo.getAgentAccessSnapshot(customerId, SEED_NOW),
        repo.getPrepaidSnapshot(customerId, SEED_NOW),
        repo.listActivityEvents(customerId),
        repo.getAccountStatement(customerId),
        repo.getFeatureEntitlements(customerId),
        repo.listAgentProducts(),
        repo.listAuditEntries(customerId),
      ]);
      setData({
        customer,
        commercialSnapshot,
        accessSnapshot,
        prepaidSnapshot,
        activityEvents,
        statementRows,
        entitlements,
        products: new Map(products.map((p) => [p.id, p])),
        auditEntries,
      });
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Could not load customer."
      );
    }
  }, [repo, customerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  if (loadError) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Customer profile"
          id="customer-profile-title"
          description="Commercial arrangement, agent access, balance and activity for one customer."
        />
        <div
          className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center"
          data-testid="profile-error"
        >
          <Building2 className="text-muted-foreground size-10" />
          <h2 className="text-lg font-semibold">Unable to load customer</h2>
          <p className="text-muted-foreground max-w-sm text-sm">{loadError}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            data-testid="retry-profile"
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-6" data-testid="profile-loading">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-8 w-28" />
        </div>
        <Skeleton className="h-28 w-full rounded-xl" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-24" />
        </div>
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  const { customer } = data;
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

  const isArchived = customer.status === "archived";
  const { commercialSnapshot, accessSnapshot, prepaidSnapshot } = data;
  // The statement section appears when prepaid ledger history exists: any
  // prepaid arrangement (active or historical) or any ledger transactions.
  const hasPrepaidLedger =
    data.statementRows.length > 0 ||
    commercialSnapshot.history.some(
      (arrangement) => arrangement.model === "prepaid"
    );
  // Agent products the customer may currently use, for the Record usage sheet.
  const availableAgentIds = accessSnapshot.current.map(
    (grant) => grant.agentProductId
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={customer.name}
        id="customer-profile-title"
        description={`${customer.domain} · Customer since ${formatDate(customer.createdAt)}`}
      >
        {!isArchived ? (
          <Button variant="outline" size="sm" asChild>
            <a href={`/customers/${customer.id}/edit`} data-testid="edit-customer-button">
              <Pencil className="size-4" />
              Edit customer
            </a>
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" asChild>
          <a href="/customers" data-testid="back-to-customers">
            <ArrowLeft className="size-4" />
            Back to customers
          </a>
        </Button>
      </PageHeader>

      {isArchived ? (
        <section
          aria-labelledby="archived-banner-heading"
          className="border-border bg-muted flex items-start gap-2 rounded-xl border px-4 py-3"
          data-testid="archived-banner"
        >
          <Archive
            className="text-muted-foreground mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />
          <div>
            <h2
              id="archived-banner-heading"
              className="text-sm font-semibold"
            >
              This customer is archived.
            </h2>
            <p className="text-muted-foreground text-sm">
              Records are retained and read-only.
            </p>
          </div>
        </section>
      ) : null}

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
            prepaidSnapshot={prepaidSnapshot}
            activeAgentCount={accessSnapshot.current.length}
            entitlements={data.entitlements}
            readOnly={isArchived}
            onSetCommercial={() => setCommercialSheetOpen(true)}
          />
        </TabsContent>
        <TabsContent value="commercial" data-testid="panel-commercial">
          <CommercialPanel
            customer={customer}
            snapshot={commercialSnapshot}
            prepaidSnapshot={prepaidSnapshot}
            activeGrantCount={accessSnapshot.current.length}
            readOnly={isArchived}
            onChanged={refresh}
            onChangeCommercial={() => setCommercialSheetOpen(true)}
            onAddCredit={() => setAddCreditOpen(true)}
            onAdjustBalance={() => setAdjustmentOpen(true)}
            onEditThreshold={() => setEditThresholdOpen(true)}
            addCreditButtonRef={addCreditButtonRef}
          />
        </TabsContent>
        <TabsContent value="access" data-testid="panel-agent-access">
          <AgentAccessPanel
            customer={customer}
            snapshot={accessSnapshot}
            products={data.products}
            readOnly={isArchived}
            onChanged={refresh}
            onGrantAccess={() => setAccessSheetOpen(true)}
          />
        </TabsContent>
        <TabsContent value="activity" data-testid="panel-activity">
          {hasPrepaidLedger ? (
            <TokenStatement
              customer={customer}
              balanceTokens={prepaidSnapshot.balanceTokens}
              statementRows={data.statementRows}
              products={data.products}
              activePrepaid={prepaidSnapshot.arrangement !== null}
              readOnly={isArchived}
              onRecordUsage={() => setUsageOpen(true)}
              onAddCredit={() => setAddCreditOpen(true)}
              onReverseTransaction={(transaction) => {
                setReversalTarget(transaction);
                setReversalOpen(true);
              }}
            />
          ) : null}
          <ActivityTimeline events={data.activityEvents} products={data.products} />
          <OperatorAuditTrail
            entries={data.auditEntries}
            customerName={data.customer?.name ?? ""}
          />
        </TabsContent>
      </Tabs>

      {!isArchived ? (
        <>
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
            products={data.products}
            open={accessSheetOpen}
            onOpenChange={setAccessSheetOpen}
            onSaved={refresh}
          />
          <AddCreditSheet
            customer={customer}
            balanceTokens={prepaidSnapshot.balanceTokens}
            open={addCreditOpen}
            onOpenChange={setAddCreditOpen}
            onSaved={refresh}
            addCreditButtonRef={addCreditButtonRef}
          />
          <AdjustmentSheet
            customer={customer}
            balanceTokens={prepaidSnapshot.balanceTokens}
            open={adjustmentOpen}
            onOpenChange={setAdjustmentOpen}
            onSaved={refresh}
          />
          <RecordUsageSheet
            customer={customer}
            balanceTokens={prepaidSnapshot.balanceTokens}
            products={data.products}
            availableAgentIds={availableAgentIds}
            open={usageOpen}
            onOpenChange={setUsageOpen}
            onSaved={refresh}
          />
          {reversalTarget ? (
            <ReversalSheet
              customer={customer}
              transaction={reversalTarget}
              balanceTokens={prepaidSnapshot.balanceTokens}
              open={reversalOpen}
              onOpenChange={setReversalOpen}
              onSaved={refresh}
            />
          ) : null}
          {prepaidSnapshot.arrangement ? (
            <EditThresholdSheet
              customer={customer}
              arrangement={prepaidSnapshot.arrangement}
              open={editThresholdOpen}
              onOpenChange={setEditThresholdOpen}
              onSaved={refresh}
            />
          ) : null}
        </>
      ) : null}

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
  prepaidSnapshot,
  activeAgentCount,
  entitlements,
  readOnly,
  onSetCommercial,
}: {
  customer: Customer;
  snapshot: CommercialSnapshot;
  prepaidSnapshot: PrepaidSnapshot;
  activeAgentCount: number;
  entitlements: FeatureEntitlement[];
  readOnly: boolean;
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
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="border-sage/40 text-sage">
                {modelLabel(active.model)}
              </Badge>
              {active.model === "prepaid" && prepaidSnapshot.lowBalance ? (
                <Badge
                  variant="outline"
                  className="border-gold text-gold"
                  data-testid="low-balance-badge"
                >
                  <span className="sr-only">
                    Low balance: {formatTokens(prepaidSnapshot.balanceTokens)}{" "}
                    remaining; warning threshold{" "}
                    {formatTokens(active.warningThresholdTokens)}
                  </span>
                  <span aria-hidden="true">Low balance</span>
                </Badge>
              ) : null}
            </div>
          ) : (
            <Badge variant="outline">No commercial model</Badge>
          )}
        </div>
        <dl className="mt-3 grid gap-3 sm:grid-cols-3">
          <OverviewMetric
            label="Commercial value"
            value={
              active
                ? modelPrimaryValue(active, prepaidSnapshot.balanceTokens)
                : "—"
            }
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
        {!readOnly ? (
          <div className="mt-4">
            <Button
              onClick={onSetCommercial}
              data-testid="overview-commercial-action"
              className={TOUCH_TARGET}
            >
              {active ? "Change commercial model" : "Set commercial model"}
            </Button>
          </div>
        ) : null}
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
  prepaidSnapshot,
  activeGrantCount,
  readOnly,
  onChanged,
  onChangeCommercial,
  onAddCredit,
  onAdjustBalance,
  onEditThreshold,
  addCreditButtonRef,
}: {
  customer: Customer;
  snapshot: CommercialSnapshot;
  prepaidSnapshot: PrepaidSnapshot;
  activeGrantCount: number;
  readOnly: boolean;
  onChanged: () => void;
  onChangeCommercial: () => void;
  onAddCredit: () => void;
  onAdjustBalance: () => void;
  onEditThreshold: () => void;
  addCreditButtonRef: RefObject<HTMLButtonElement | null>;
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
          prepaidSnapshot={prepaidSnapshot}
          readOnly={readOnly}
          onChange={onChangeCommercial}
          onTerminate={() => setTerminateTarget(snapshot.active)}
          onAddCredit={onAddCredit}
          onAdjustBalance={onAdjustBalance}
          onEditThreshold={onEditThreshold}
          addCreditButtonRef={addCreditButtonRef}
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
          {!readOnly ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onChangeCommercial}
              data-testid="review-scheduled-change"
            >
              Review scheduled change
            </Button>
          ) : null}
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
  prepaidSnapshot,
  readOnly,
  onChange,
  onTerminate,
  onAddCredit,
  onAdjustBalance,
  onEditThreshold,
  addCreditButtonRef,
}: {
  arrangement: CommercialArrangement;
  prepaidSnapshot: PrepaidSnapshot;
  readOnly: boolean;
  onChange: () => void;
  onTerminate: () => void;
  onAddCredit: () => void;
  onAdjustBalance: () => void;
  onEditThreshold: () => void;
  addCreditButtonRef: React.RefObject<HTMLButtonElement | null>;
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
          {arrangement.model === "prepaid" && prepaidSnapshot.lowBalance ? (
            <Badge
              variant="outline"
              className="border-gold text-gold"
              data-testid="low-balance-badge"
            >
              <span className="sr-only">
                Low balance: {formatTokens(prepaidSnapshot.balanceTokens)}{" "}
                remaining; warning threshold{" "}
                {formatTokens(arrangement.warningThresholdTokens)}
              </span>
              <span aria-hidden="true">Low balance</span>
            </Badge>
          ) : null}
          <span className="text-muted-foreground text-xs capitalize">
            {arrangement.status}
          </span>
        </div>
        {!readOnly ? (
          <div className="flex flex-wrap items-center gap-2">
            {arrangement.model === "prepaid" ? (
              <>
                <Button
                  variant="default"
                  size="sm"
                  className="bg-[#9A4B23] text-white hover:bg-[#9A4B23]/90"
                  onClick={onAddCredit}
                  ref={addCreditButtonRef}
                >
                  Add credit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onAdjustBalance}
                  data-testid="adjust-balance"
                >
                  Adjust balance
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onEditThreshold}
                >
                  Edit threshold
                </Button>
              </>
            ) : null}
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
        ) : null}
      </div>
      <dl className="mt-3 grid gap-3 sm:grid-cols-3">
        {arrangementTerms(arrangement, prepaidSnapshot)}
      </dl>
      {arrangement.reason ? (
        <p className="text-muted-foreground mt-3 text-xs">{arrangement.reason}</p>
      ) : null}
    </div>
  );
}

function arrangementTerms(
  arrangement: CommercialArrangement,
  prepaidSnapshot: PrepaidSnapshot
) {
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
        <Detail
          label="Balance"
          value={formatTokens(prepaidSnapshot.balanceTokens)}
        />
        <Detail
          label="Warning threshold"
          value={formatTokens(arrangement.warningThresholdTokens)}
        />
        <Detail label="Effective" value={formatDate(arrangement.effectiveFrom)} />
        <Detail
          label="Expires"
          value={
            arrangement.expiresAt ? formatDate(arrangement.expiresAt) : "No expiry"
          }
        />
        <Detail
          label="Balance source"
          value={`Derived from ${prepaidSnapshot.transactionCount} immutable transactions`}
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
    return `Warning at ${formatTokens(arrangement.warningThresholdTokens)} or below`;
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
  readOnly,
  onChanged,
  onGrantAccess,
}: {
  customer: Customer;
  snapshot: AgentAccessSnapshot;
  products: Map<string, AgentProduct>;
  readOnly: boolean;
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
        {!readOnly ? (
          <Button
            onClick={onGrantAccess}
            data-testid="grant-agent-access"
            className={TOUCH_TARGET}
          >
            Grant agent access
          </Button>
        ) : null}
      </div>
      {snapshot.current.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {snapshot.current.map((grant) => (
            <GrantRow
              key={grant.id}
              grant={grant}
              products={products}
              status="active"
              readOnly={readOnly}
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
                readOnly={readOnly}
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
                readOnly={readOnly}
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
  readOnly,
  onRevoke,
}: {
  grant: AgentAccessGrant;
  products: Map<string, AgentProduct>;
  status: "active" | "scheduled" | "expired" | "revoked";
  readOnly: boolean;
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
        {status === "active" && !readOnly && onRevoke ? (
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