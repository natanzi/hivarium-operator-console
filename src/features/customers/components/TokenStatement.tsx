import { useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable, type DataTableColumn } from "@/data/data-table";
import { useRepository } from "@/data/repository-context";
import type { UsageSummary } from "@/data/local-storage-repository";
import type { AccountStatementRow } from "@/domain/ledger-rules";
import type {
  AgentProduct,
  Customer,
  LedgerTransaction,
  LedgerTransactionKind,
} from "@/domain/types";
import { formatDateTime } from "@/lib/format";
import {
  formatSignedTokens,
  formatTokens,
  TOUCH_TARGET,
  TRANSACTION_KIND_LABELS,
} from "./format";

/** Sentinel value for the Agent select meaning "no agent filter". */
const ALL_AGENTS = "all";
/** Sentinel value for the Transaction type select meaning "no type filter". */
const ALL_TYPES = "all";

const TRANSACTION_TYPE_OPTIONS: LedgerTransactionKind[] = [
  "credit_grant",
  "usage_debit",
  "manual_adjustment",
  "reversal",
];

/** Semantic badge tones per transaction kind (UI-SPEC Color contract). */
const TYPE_BADGE_CLASS: Record<LedgerTransactionKind, string> = {
  credit_grant: "border-sage/40 bg-sage-soft text-sage",
  usage_debit: "border-border bg-muted text-muted-foreground",
  manual_adjustment: "border-gold/40 bg-gold-soft text-gold",
  reversal: "border-border bg-muted text-muted-foreground",
};

/**
 * Signed net value with a clean zero: "0 tokens" instead of "+0 tokens".
 * Negative means net consumption, positive means net restoration.
 */
function formatNetTokens(net: number): string {
  if (net === 0) return "0 tokens";
  return formatSignedTokens(net);
}

/**
 * Token account statement — the first section of the existing Activity tab
 * when prepaid ledger history exists (D-13, UI-SPEC Activity tab).
 *
 * Renders the statement header (current full-account balance and, for active
 * prepaid arrangements only, the Record usage action), one compact filter row
 * (From/To dates, Agent select, Transaction type select, Clear filters), a
 * restrained selected-period summary band (Net tokens consumed plus compact
 * per-agent rows ordered highest consumption first), and a newest-first
 * semantic statement table whose rows always carry full-account resulting
 * balances — filters never recalculate them (LEDG-05, Pattern 4).
 *
 * All filtering and aggregation happens in the repository through
 * `getUsageSummary`; this component never re-implements statement arithmetic
 * (D-16). An inverted date range keeps the last valid result and shows the
 * documented error copy (USGE-03, A1).
 */
export function TokenStatement({
  customer,
  balanceTokens,
  statementRows,
  products,
  activePrepaid,
  onRecordUsage,
  onAddCredit,
  onReverseTransaction,
}: {
  customer: Customer;
  /** Current derived full-account balance in whole tokens. */
  balanceTokens: number;
  /** Newest-first statement rows from `getAccountStatement`. */
  statementRows: AccountStatementRow[];
  /** Catalog agent products used to resolve agent names. */
  products: Map<string, AgentProduct>;
  /** Whether the customer currently has an active prepaid arrangement. */
  activePrepaid: boolean;
  onRecordUsage: () => void;
  onAddCredit: () => void;
  onReverseTransaction: (transaction: LedgerTransaction) => void;
}) {
  const repo = useRepository();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [agentProductId, setAgentProductId] = useState(ALL_AGENTS);
  const [type, setType] = useState(ALL_TYPES);

  const hasActiveFilters =
    from.trim() !== "" ||
    to.trim() !== "" ||
    agentProductId !== ALL_AGENTS ||
    type !== ALL_TYPES;

  // The filtered statement + selected-period summary always come from the
  // repository (D-16). An inverted range throws, so the last valid result is
  // kept in a ref and the documented error is shown instead (USGE-03, A1).
  // The query runs on every render so mutations (which re-render the page and
  // pass fresh `statementRows`) always refresh the filtered view.
  let summary: UsageSummary | null = null;
  try {
    summary = repo.getUsageSummary(
      customer.id,
      {
        from: from.trim() || undefined,
        to: to.trim() || undefined,
      },
      agentProductId === ALL_AGENTS ? undefined : agentProductId,
      type === ALL_TYPES ? undefined : (type as LedgerTransactionKind)
    );
  } catch {
    summary = null;
  }

  const lastValidSummaryRef = useRef<UsageSummary | null>(null);
  if (summary !== null) {
    lastValidSummaryRef.current = summary;
  }
  const visibleSummary = summary ?? lastValidSummaryRef.current;
  const rangeError =
    summary === null ? "From date must be on or before To date." : "";
  const visibleRows = visibleSummary?.rows ?? statementRows;
  const isEmptyAccount = statementRows.length === 0;
  const isEmptyFiltered = !isEmptyAccount && visibleRows.length === 0;

  // Lookup maps over the full statement (never the filtered rows) so reversal
  // detail and eligibility always reflect the immutable ledger.
  const transactionsById = useMemo(
    () =>
      new Map(
        statementRows.map((row) => [row.transaction.id, row.transaction])
      ),
    [statementRows]
  );
  const reversedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of statementRows) {
      if (row.transaction.kind === "reversal") {
        ids.add(row.transaction.reversesTransactionId);
      }
    }
    return ids;
  }, [statementRows]);
  const reversalByTarget = useMemo(() => {
    const map = new Map<string, LedgerTransaction>();
    for (const row of statementRows) {
      if (row.transaction.kind === "reversal") {
        map.set(row.transaction.reversesTransactionId, row.transaction);
      }
    }
    return map;
  }, [statementRows]);

  const agentOptions = useMemo(
    () => [...products.values()].sort((a, b) => a.name.localeCompare(b.name)),
    [products]
  );

  function clearFilters() {
    setFrom("");
    setTo("");
    setAgentProductId(ALL_AGENTS);
    setType(ALL_TYPES);
  }

  const columns: DataTableColumn<AccountStatementRow>[] = [
    {
      id: "date",
      header: "Date",
      cell: (row) => (
        <span className="text-sm tabular-nums whitespace-nowrap">
          {formatDateTime(row.transaction.occurredAt)}
        </span>
      ),
    },
    {
      id: "type",
      header: "Type",
      cell: (row) => (
        <div className="flex items-center gap-2">
          <span className="text-sm">
            {TRANSACTION_KIND_LABELS[row.transaction.kind]}
          </span>
          <Badge
            variant="outline"
            className={TYPE_BADGE_CLASS[row.transaction.kind]}
          >
            {TRANSACTION_KIND_LABELS[row.transaction.kind]}
          </Badge>
        </div>
      ),
    },
    {
      id: "detail",
      header: "Agent / detail",
      cell: (row) => {
        const transaction = row.transaction;
        if (transaction.kind === "usage_debit") {
          return (
            <span className="text-sm">
              {products.get(transaction.agentProductId)?.name ??
                transaction.agentProductId}
            </span>
          );
        }
        if (transaction.kind === "reversal") {
          const original = transactionsById.get(
            transaction.reversesTransactionId
          );
          return (
            <span className="text-sm">
              Reverses{" "}
              <code className="font-mono text-xs">
                {original?.reference ?? transaction.reversesTransactionId}
              </code>
            </span>
          );
        }
        return <span className="text-sm">{transaction.reason}</span>;
      },
    },
    {
      id: "amount",
      header: "Amount",
      cell: (row) => {
        const amount = row.transaction.amountTokens;
        const accessible =
          amount < 0
            ? `debit ${Math.abs(amount)} tokens`
            : `credit ${amount} tokens`;
        return (
          <span className="text-sm font-medium tabular-nums whitespace-nowrap">
            <span className="sr-only">{accessible}</span>
            <span aria-hidden="true">{formatSignedTokens(amount)}</span>
          </span>
        );
      },
    },
    {
      id: "balance",
      header: "Resulting balance",
      cell: (row) => (
        <span className="text-sm tabular-nums whitespace-nowrap">
          {formatTokens(row.resultingBalanceTokens)}
        </span>
      ),
    },
    {
      id: "reference",
      header: "Reference",
      cell: (row) => (
        <code
          className="font-mono text-xs break-all line-clamp-2 max-w-[180px]"
          title={row.transaction.reference}
        >
          {row.transaction.reference}
        </code>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      cell: (row) => {
        const transaction = row.transaction;
        if (transaction.kind === "reversal") return null;
        if (reversedIds.has(transaction.id)) {
          const reversal = reversalByTarget.get(transaction.id);
          const reversalReference = reversal
            ? `Reversed by ${reversal.reference}`
            : "Reversed";
          return (
            <Badge
              variant="outline"
              className="border-border bg-muted text-muted-foreground"
              data-testid={`reversed-${transaction.id}`}
              title={reversalReference}
            >
              <span className="sr-only">{reversalReference}</span>
              <span aria-hidden="true">Reversed</span>
            </Badge>
          );
        }
        return (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onReverseTransaction(transaction)}
            data-testid={`reverse-${transaction.id}`}
          >
            Reverse transaction
          </Button>
        );
      },
    },
  ];

  return (
    <section
      className="flex flex-col gap-4"
      data-testid="token-statement"
      aria-label={`Token account statement for ${customer.name}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Token account statement</h3>
          <p className="text-muted-foreground text-xs">
            Balance {formatTokens(balanceTokens)}
          </p>
        </div>
        {activePrepaid ? (
          <Button
            onClick={onRecordUsage}
            data-testid="record-usage"
            className={TOUCH_TARGET}
          >
            Record usage
          </Button>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
        <div className="flex flex-col gap-1.5 md:min-w-[150px]">
          <Label htmlFor="statement-from">From</Label>
          <Input
            id="statement-from"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            data-testid="statement-from"
          />
        </div>
        <div className="flex flex-col gap-1.5 md:min-w-[150px]">
          <Label htmlFor="statement-to">To</Label>
          <Input
            id="statement-to"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            data-testid="statement-to"
          />
        </div>
        <div className="flex flex-col gap-1.5 md:min-w-[180px]">
          <Label htmlFor="statement-agent">Agent</Label>
          <Select value={agentProductId} onValueChange={setAgentProductId}>
            <SelectTrigger
              id="statement-agent"
              className="w-full md:w-[180px]"
              data-testid="statement-agent-trigger"
            >
              <SelectValue placeholder="All agents" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_AGENTS}>All agents</SelectItem>
              {agentOptions.map((product) => (
                <SelectItem
                  key={product.id}
                  value={product.id}
                  data-testid={`statement-agent-option-${product.id}`}
                >
                  {product.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5 md:min-w-[200px]">
          <Label htmlFor="statement-type">Transaction type</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger
              id="statement-type"
              className="w-full md:w-[200px]"
              data-testid="statement-type-trigger"
            >
              <SelectValue placeholder="All transaction types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_TYPES}>All transaction types</SelectItem>
              {TRANSACTION_TYPE_OPTIONS.map((kind) => (
                <SelectItem
                  key={kind}
                  value={kind}
                  data-testid={`statement-type-option-${kind}`}
                >
                  {TRANSACTION_KIND_LABELS[kind]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={clearFilters}
          disabled={!hasActiveFilters}
          data-testid="clear-statement-filters"
          className={TOUCH_TARGET}
        >
          Clear filters
        </Button>
      </div>

      {rangeError ? (
        <p
          className="text-destructive text-sm"
          data-testid="statement-range-error"
        >
          {rangeError}
        </p>
      ) : null}

      {isEmptyAccount ? (
        <div
          className="border-border flex flex-col items-center gap-2 rounded-xl border bg-card px-4 py-8 text-center"
          data-testid="statement-empty"
        >
          <h3 className="text-sm font-semibold">No token transactions yet</h3>
          <p className="text-muted-foreground max-w-sm text-sm">
            Add token credit to create this customer&apos;s first immutable
            statement entry.
          </p>
          {activePrepaid ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onAddCredit}
              data-testid="statement-add-credit"
              className={TOUCH_TARGET}
            >
              Add credit
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          <div
            className="border-border rounded-lg border bg-card px-4 py-3"
            data-testid="statement-summary"
          >
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <div>
                <p className="text-muted-foreground text-xs tracking-wide uppercase">
                  Net tokens consumed
                </p>
                <p
                  className="text-sm font-semibold tabular-nums"
                  data-testid="statement-net-consumed"
                >
                  {formatNetTokens(visibleSummary?.netTokensConsumed ?? 0)}
                </p>
              </div>
              {visibleSummary && visibleSummary.perAgent.length > 0 ? (
                <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  {visibleSummary.perAgent.map((row) => (
                    <li
                      key={row.agentProductId}
                      className="text-sm"
                      data-testid={`statement-agent-${row.agentProductId}`}
                    >
                      {row.agentName} —{" "}
                      {formatTokens(Math.abs(row.netTokensConsumed))}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">
                  No token usage in this period
                </p>
              )}
            </div>
          </div>

          {isEmptyFiltered ? (
            <div
              className="border-border flex flex-col items-center gap-2 rounded-xl border bg-card px-4 py-8 text-center"
              data-testid="statement-empty-filtered"
            >
              <h3 className="text-sm font-semibold">
                No transactions match these filters
              </h3>
              <p className="text-muted-foreground max-w-sm text-sm">
                Clear one or more filters to review the full token account
                statement.
              </p>
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={visibleRows}
              getRowId={(row) => row.transaction.id}
              ariaLabel={`Token account statement for ${customer.name}`}
              emptyMessage="No transactions match these filters."
            />
          )}
        </>
      )}
    </section>
  );
}