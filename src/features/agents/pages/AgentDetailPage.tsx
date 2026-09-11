import { ArrowLeft, Boxes } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/layout/Layout";
import { Skeleton } from "@/components/ui/skeleton";
import { PLAN_LABELS, SEED_NOW } from "@/data/seed-data";
import { useRepository } from "@/data/repository-context";
import type { AgentCustomerAccessRow } from "@/data/local-storage-repository";
import type { AgentProduct, PlanTier } from "@/domain/types";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Read-only agent detail screen.
 *
 * Shows the agent product identity/capability and the reverse projection of
 * every customer holding current or scheduled access to it. Catalog editing
 * remains out of scope. Reads flow through the asynchronous
 * {@link HiveRepository}: the page shows a skeleton while loading and a
 * restrained error state with Retry that re-runs the same read.
 */
export function AgentDetailPage() {
  const { agentProductId = "" } = useParams<{ agentProductId: string }>();
  const repo = useRepository();
  // `undefined` means still loading; `null` means the agent does not exist.
  const [product, setProduct] = useState<AgentProduct | null | undefined>(
    undefined
  );
  const [accessRows, setAccessRows] = useState<AgentCustomerAccessRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [found, rows] = await Promise.all([
        repo.getAgentProduct(agentProductId),
        repo.listCustomersWithAgentAccess(agentProductId, SEED_NOW),
      ]);
      // The repository reports a missing agent as `undefined`; the page
      // reserves `undefined` for the loading state, so map to `null` to
      // reach the not-found state.
      setProduct(found ?? null);
      setAccessRows(rows);
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Could not load agent."
      );
    }
  }, [repo, agentProductId]);

  useEffect(() => {
    void load();
  }, [load]);

  const currentRows = accessRows.filter((row) => row.status === "active");
  const scheduledRows = accessRows.filter((row) => row.status === "scheduled");

  if (loadError) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Agent detail"
          id="agent-detail-title"
          description="Agent product identity, capability and customer access."
        />
        <div
          className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center"
          data-testid="agent-detail-error"
        >
          <Boxes className="text-muted-foreground size-10" />
          <h2 className="text-lg font-semibold">Unable to load agent</h2>
          <p className="text-muted-foreground max-w-sm text-sm">{loadError}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            data-testid="retry-agent-detail"
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (product === undefined) {
    return (
      <div className="flex flex-col gap-6" data-testid="agent-detail-loading">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-8 w-28" />
        </div>
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <Boxes className="text-muted-foreground size-10" />
        <div>
          <h1 className="text-2xl font-semibold">Agent not found</h1>
          <p className="text-muted-foreground mt-1 max-w-sm text-sm">
            No agent product with id{" "}
            <code className="font-mono">{agentProductId}</code> exists in this
            catalog.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/agents" data-testid="back-to-agents">
            <ArrowLeft className="size-4" />
            Back to agent catalog
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={product.name}
        id="agent-detail-title"
        description={`${product.category} · v${product.version}`}
      >
        <Button variant="ghost" size="sm" asChild>
          <Link to="/agents" data-testid="back-to-agents">
            <ArrowLeft className="size-4" />
            Back to agent catalog
          </Link>
        </Button>
      </PageHeader>

      <Card data-testid="agent-detail-card">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>Capability</CardTitle>
            <Badge variant="secondary" className="tabular-nums text-xs">
              v{product.version}
            </Badge>
          </div>
          <CardDescription className="font-mono text-xs">
            {product.id}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-foreground/90 text-sm leading-relaxed">
            {product.description}
          </p>
          <div
            className="flex flex-wrap gap-1.5"
            data-testid="agent-detail-plans"
          >
            {product.plans.map((plan) => (
              <PlanBadge key={plan} plan={plan} />
            ))}
          </div>
        </CardContent>
      </Card>

      <section
        className="flex flex-col gap-4"
        data-testid="agent-customer-access"
        aria-labelledby="agent-customer-access-heading"
      >
        <div>
          <h2
            id="agent-customer-access-heading"
            className="text-[17px] font-semibold"
          >
            Customer access
          </h2>
          <p className="text-muted-foreground text-sm">
            Customers with current or scheduled access to this agent.
          </p>
        </div>

        {accessRows.length === 0 ? (
          <div
            className="border-border text-muted-foreground flex min-h-[20vh] flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center"
            data-testid="agent-customer-access-empty"
          >
            <Boxes className="size-6" />
            <p className="text-sm">
              No customers have current or scheduled access to this agent.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <AccessGroup
              heading="Current access"
              rows={currentRows}
              emptyMessage="No customer currently has access to this agent."
            />
            <AccessGroup
              heading="Scheduled access"
              rows={scheduledRows}
              emptyMessage="No scheduled access is pending for this agent."
            />
          </div>
        )}
      </section>
    </div>
  );
}

function AccessGroup({
  heading,
  rows,
  emptyMessage,
}: {
  heading: string;
  rows: AgentCustomerAccessRow[];
  emptyMessage: string;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{heading}</h3>
      {rows.length === 0 ? (
        <p className="text-muted-foreground mt-2 text-sm">{emptyMessage}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {rows.map((row) => (
            <CustomerAccessRow key={row.grantId} row={row} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CustomerAccessRow({ row }: { row: AgentCustomerAccessRow }) {
  const tone =
    row.status === "active"
      ? "border-sage/40 bg-sage-soft text-sage"
      : "border-gold/40 bg-gold-soft text-gold";

  return (
    <li
      className="border-border bg-card flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3"
      data-testid={`agent-access-${row.grantId}`}
    >
      <div className="min-w-0">
        <Link
          to={`/customers/${row.customerId}`}
          className="text-sm font-medium break-words underline-offset-4 hover:underline"
          data-testid={`agent-access-link-${row.grantId}`}
        >
          {row.customerName}
        </Link>
        <p className="text-muted-foreground font-mono text-xs">
          {row.customerId}
        </p>
      </div>
      <div className="text-muted-foreground flex flex-wrap items-center gap-4 text-xs">
        <span>
          {row.status === "active"
            ? `Effective ${formatDate(row.startsAt)}`
            : `Scheduled for ${formatDate(row.startsAt)}`}
        </span>
        <span>
          {row.endsAt ? `Ends ${formatDate(row.endsAt)}` : "No end date"}
        </span>
        {row.scheduledRevokeAt ? (
          <span>Revocation scheduled {formatDate(row.scheduledRevokeAt)}</span>
        ) : null}
      </div>
      <span
        className={cn(
          "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize",
          tone
        )}
      >
        {row.status}
      </span>
    </li>
  );
}

function PlanBadge({ plan }: { plan: PlanTier }) {
  return (
    <span className="text-muted-foreground border-border bg-muted inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium">
      {PLAN_LABELS[plan]}
    </span>
  );
}
