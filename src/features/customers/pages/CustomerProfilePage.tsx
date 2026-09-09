import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Building2, Pencil } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useParams } from "react-router";
import { toast } from "sonner";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/layout/Layout";
import { Avatar, TableFooter } from "@/components/ui/primitives";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable, type DataTableColumn } from "@/data/data-table";
import {
  CUSTOMER_STATUS_LABELS,
  SEED_NOW,
  STATUS_BADGE_CLASS,
} from "@/data/seed-data";
import { useRepository } from "@/data/repository-context";
import { customerAge, formatDate, formatDateTime } from "@/lib/format";
import type {
  ActivityEvent,
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

/**
 * Customer profile screen.
 *
 * Shows a single customer's overview plus their commercial arrangement,
 * agent access and activity timeline, each in its own tab. The Commercial
 * and Agent Access tabs include validated React Hook Form + Zod forms that
 * write through `saveCommercialArrangement` and `grantAgentAccess` on the
 * repository boundary.
 */
export function CustomerProfilePage() {
  const { customerId = "" } = useParams<{ customerId: string }>();
  const repo = useRepository();
  const [, setRevision] = useState(0);

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

      <CustomerOverviewCard
        customer={customer}
        activeAgentCount={accessSnapshot.current.length}
      />

      <Tabs defaultValue="overview" className="gap-4">
        <TabsList aria-label="Customer sections">
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
            notes={customer.notes}
            contact={customer.contact}
            email={customer.email}
            domain={customer.domain}
            createdAt={customer.createdAt}
            entitlements={entitlements}
          />
        </TabsContent>
        <TabsContent value="commercial" data-testid="panel-commercial">
          <CommercialPanel
            customerId={customer.id}
            snapshot={commercialSnapshot}
            onChanged={refresh}
          />
        </TabsContent>
        <TabsContent value="access" data-testid="panel-agent-access">
          <AgentAccessPanel
            customerId={customer.id}
            snapshot={accessSnapshot}
            products={products}
            onChanged={refresh}
          />
        </TabsContent>
        <TabsContent value="activity" data-testid="panel-activity">
          <ActivityPanel events={activityEvents} products={products} />
        </TabsContent>
      </Tabs>

      <TableFooter backTo="/customers" backLabel="All customers" />
    </div>
  );
}

function CustomerOverviewCard({
  customer,
  activeAgentCount,
}: {
  customer: Customer;
  activeAgentCount: number;
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
          <Metric label="Active agents" value={activeAgentCount} />
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
  entitlements,
}: {
  notes: string;
  contact: string;
  email: string;
  domain: string;
  createdAt: string;
  entitlements: FeatureEntitlement[];
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
      <div>
        <h3 className="text-sm font-semibold">Feature entitlements</h3>
        {entitlements.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-2">
            {entitlements.map((entitlement) => (
              <li
                key={entitlement.id}
                className="border-border rounded-lg border px-3 py-2"
              >
                <span className="font-mono text-xs">{entitlement.feature}</span>
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
  customerId,
  snapshot,
  onChanged,
}: {
  customerId: string;
  snapshot: CommercialSnapshot;
  onChanged: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      {snapshot.active ? (
        <ArrangementCard arrangement={snapshot.active} />
      ) : (
        <EmptyState
          heading="No commercial model is active"
          body="Choose how this customer uses Hivarium before granting agent access."
        />
      )}

      {snapshot.scheduled ? (
        <div
          className="border-gold/40 bg-gold-soft flex items-center justify-between gap-3 rounded-lg border px-4 py-3"
          data-testid="scheduled-change"
        >
          <div>
            <p className="text-sm font-medium">Scheduled change</p>
            <p className="text-muted-foreground text-xs">
              Effective {formatDate(snapshot.scheduled.effectiveFrom)} ·{" "}
              {modelLabel(snapshot.scheduled.model)}
            </p>
          </div>
          <Badge variant="outline" className="border-gold/40 text-gold">
            Scheduled
          </Badge>
        </div>
      ) : null}

      <MonthlyArrangementForm customerId={customerId} onSaved={onChanged} />

      {snapshot.history.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold">Arrangement history</h3>
          <div className="mt-2">
            <DataTable
              columns={arrangementHistoryColumns}
              data={snapshot.history}
              getRowId={(a) => a.id}
              ariaLabel="Arrangement history"
              emptyMessage="No prior arrangements for this customer."
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ArrangementCard({
  arrangement,
}: {
  arrangement: CommercialArrangement;
}) {
  return (
    <div
      className="border-sage/40 bg-sage-soft rounded-xl border p-4"
      data-testid="active-arrangement"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="border-sage/40 bg-sage-soft text-sage">
          {modelLabel(arrangement.model)}
        </Badge>
        <span className="text-muted-foreground text-xs capitalize">
          {arrangement.status}
        </span>
      </div>
      <dl className="mt-3 grid gap-3 sm:grid-cols-3">
        {arrangement.model === "monthly" ? (
          <>
            <Detail
              label="Monthly amount"
              value={formatUsd(arrangement.monthlyAmountCents)}
            />
            <Detail label="Effective" value={formatDate(arrangement.effectiveFrom)} />
            <Detail label="Next renewal" value={formatDate(arrangement.renewsAt)} />
          </>
        ) : arrangement.model === "prepaid" ? (
          <>
            <Detail label="Balance" value={formatUsd(arrangement.balanceCents)} />
            <Detail label="Effective" value={formatDate(arrangement.effectiveFrom)} />
            <Detail
              label="Expires"
              value={
                arrangement.expiresAt
                  ? formatDate(arrangement.expiresAt)
                  : "No expiry"
              }
            />
          </>
        ) : (
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
          </>
        )}
      </dl>
      {arrangement.reason ? (
        <p className="text-muted-foreground mt-3 text-xs">{arrangement.reason}</p>
      ) : null}
    </div>
  );
}

const arrangementHistoryColumns: DataTableColumn<CommercialArrangement>[] = [
  {
    id: "model",
    header: "Model",
    cell: (a) => <span className="text-sm font-medium capitalize">{a.model}</span>,
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
];

function primaryTerms(arrangement: CommercialArrangement): string {
  if (arrangement.model === "monthly") {
    return `${formatUsd(arrangement.monthlyAmountCents)} / month`;
  }
  if (arrangement.model === "prepaid") {
    return `${formatUsd(arrangement.balanceCents)} balance`;
  }
  return `${formatUsd(arrangement.contractValueCents)} · ${arrangement.includedAllowance.toLocaleString()} ${arrangement.allowanceUnit}`;
}

function modelLabel(model: CommercialArrangement["model"]): string {
  switch (model) {
    case "monthly":
      return "Monthly";
    case "prepaid":
      return "Prepaid";
    case "annual":
      return "Annual contract";
  }
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const monthlyArrangementSchema = z
  .object({
    monthlyAmountDollars: z
      .string()
      .min(1, "Monthly amount is required.")
      .refine((value) => Number(value) > 0, {
        message: "Monthly amount must be greater than zero.",
      }),
    effective: z.enum(["now", "scheduled"]),
    effectiveDate: z.string().optional(),
    renewsAt: z.string().min(1, "Next renewal date is required."),
    reason: z.string().min(1, "Reason is required."),
  })
  .superRefine((values, ctx) => {
    if (values.effective === "scheduled" && !values.effectiveDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["effectiveDate"],
        message: "Choose an effective date.",
      });
    }
  });

type MonthlyArrangementFormValues = z.infer<typeof monthlyArrangementSchema>;

function MonthlyArrangementForm({
  customerId,
  onSaved,
}: {
  customerId: string;
  onSaved: () => void;
}) {
  const repo = useRepository();
  const form = useForm<MonthlyArrangementFormValues>({
    resolver: zodResolver(monthlyArrangementSchema),
    defaultValues: {
      monthlyAmountDollars: "",
      effective: "now",
      effectiveDate: "",
      renewsAt: "",
      reason: "",
    },
  });

  const effective = form.watch("effective");

  function onSubmit(values: MonthlyArrangementFormValues) {
    const occurredAt = SEED_NOW;
    const effectiveFrom =
      values.effective === "now"
        ? occurredAt
        : `${values.effectiveDate}T00:00:00.000Z`;
    try {
      repo.saveCommercialArrangement(
        {
          id: `arr_${customerId}_${occurredAt}`,
          customerId,
          model: "monthly",
          status: values.effective === "now" ? "active" : "scheduled",
          effectiveFrom,
          effectiveTo: null,
          createdAt: occurredAt,
          reason: values.reason,
          currency: "USD",
          billingCadence: "monthly",
          monthlyAmountCents: Math.round(Number(values.monthlyAmountDollars) * 100),
          renewsAt: `${values.renewsAt}T00:00:00.000Z`,
        },
        occurredAt
      );
      toast.success(
        values.effective === "now"
          ? "Commercial model started"
          : "Commercial model scheduled"
      );
      form.reset();
      onSaved();
    } catch {
      toast.error(
        "Commercial changes were not saved. Review the highlighted fields and try again."
      );
    }
  }

  return (
    <Card data-testid="monthly-arrangement-form">
      <CardHeader>
        <CardTitle>Start monthly subscription</CardTitle>
        <CardDescription>
          Create a recurring monthly commercial arrangement for this customer.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form
            className="flex flex-col gap-5"
            onSubmit={form.handleSubmit(onSubmit)}
            noValidate
          >
            <FormField
              control={form.control}
              name="monthlyAmountDollars"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Monthly amount (USD) *</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="149.00"
                      data-testid="monthly-amount"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="effective"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Effective *</FormLabel>
                  <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      value={field.value}
                      className="flex gap-4"
                    >
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="now" id="effective-now" />
                        <label htmlFor="effective-now" className="text-sm">
                          Effective now
                        </label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="scheduled" id="effective-scheduled" />
                        <label htmlFor="effective-scheduled" className="text-sm">
                          Schedule for date
                        </label>
                      </div>
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {effective === "scheduled" ? (
              <FormField
                control={form.control}
                name="effectiveDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Effective date *</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        data-testid="effective-date"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}
            <FormField
              control={form.control}
              name="renewsAt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Next renewal date *</FormLabel>
                  <FormControl>
                    <Input type="date" data-testid="renews-at" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason *</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Why is this arrangement being created?"
                      data-testid="arrangement-reason"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="border-border flex items-center justify-end gap-2 border-t pt-4">
              <Button type="submit" data-testid="submit-monthly-arrangement">
                {effective === "now"
                  ? "Start monthly subscription"
                  : "Schedule commercial change"}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Agent Access tab
// ---------------------------------------------------------------------------

function AgentAccessPanel({
  customerId,
  snapshot,
  products,
  onChanged,
}: {
  customerId: string;
  snapshot: AgentAccessSnapshot;
  products: Map<string, AgentProduct>;
  onChanged: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-sm font-semibold">Current access</h3>
        {snapshot.current.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-2">
            {snapshot.current.map((grant) => (
              <GrantRow
                key={grant.id}
                grant={grant}
                products={products}
                status="active"
              />
            ))}
          </ul>
        ) : (
          <div className="mt-2">
            <EmptyState
              heading="No agents are available to this customer"
              body="Grant access to an agent from the Hivarium catalog."
            />
          </div>
        )}
      </div>

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

      <AgentAccessForm customerId={customerId} products={products} onSaved={onChanged} />

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
    </div>
  );
}

function GrantRow({
  grant,
  products,
  status,
}: {
  grant: AgentAccessGrant;
  products: Map<string, AgentProduct>;
  status: "active" | "scheduled" | "expired" | "revoked";
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
        <p className="text-sm font-medium">{product?.name ?? grant.agentProductId}</p>
        <p className="text-muted-foreground font-mono text-xs">
          {grant.agentProductId}
        </p>
      </div>
      <div className="text-muted-foreground flex flex-wrap items-center gap-4 text-xs">
        <span>
          Granted {formatDate(grant.startsAt)}
        </span>
        <span>
          {grant.endsAt ? `Ends ${formatDate(grant.endsAt)}` : "No end date"}
        </span>
      </div>
      <span
        className={cn(
          "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize",
          tone
        )}
      >
        {status}
      </span>
    </li>
  );
}

const agentAccessSchema = z
  .object({
    agentProductId: z.string().min(1, "Choose an agent product."),
    effective: z.enum(["now", "scheduled"]),
    startsAt: z.string().optional(),
    endsAt: z.string().optional(),
    reasonForChange: z.string().min(1, "Reason is required."),
  })
  .superRefine((values, ctx) => {
    if (values.effective === "scheduled" && !values.startsAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startsAt"],
        message: "Choose a start date.",
      });
    }
  });

type AgentAccessFormValues = z.infer<typeof agentAccessSchema>;

function AgentAccessForm({
  customerId,
  products,
  onSaved,
}: {
  customerId: string;
  products: Map<string, AgentProduct>;
  onSaved: () => void;
}) {
  const repo = useRepository();
  const form = useForm<AgentAccessFormValues>({
    resolver: zodResolver(agentAccessSchema),
    defaultValues: {
      agentProductId: "",
      effective: "now",
      startsAt: "",
      endsAt: "",
      reasonForChange: "",
    },
  });

  const effective = form.watch("effective");

  function onSubmit(values: AgentAccessFormValues) {
    const occurredAt = SEED_NOW;
    const startsAt =
      values.effective === "now"
        ? occurredAt
        : `${values.startsAt}T00:00:00.000Z`;
    try {
      repo.grantAgentAccess(
        {
          customerId,
          agentProductId: values.agentProductId,
          startsAt,
          endsAt: values.endsAt ? `${values.endsAt}T00:00:00.000Z` : null,
          createdAt: occurredAt,
          reasonForChange: values.reasonForChange,
        },
        occurredAt
      );
      toast.success(
        values.effective === "now"
          ? "Agent access granted"
          : "Agent access scheduled"
      );
      form.reset();
      onSaved();
    } catch {
      toast.error(
        "Agent access was not changed. Review the dates and try again."
      );
    }
  }

  return (
    <Card data-testid="agent-access-form">
      <CardHeader>
        <CardTitle>Grant agent access</CardTitle>
        <CardDescription>
          Grant this customer access to an agent from the Hivarium catalog.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form
            className="flex flex-col gap-5"
            onSubmit={form.handleSubmit(onSubmit)}
            noValidate
          >
            <FormField
              control={form.control}
              name="agentProductId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Agent product *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="agent-product-trigger">
                        <SelectValue placeholder="Choose an agent product" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {[...products.values()].map((product) => (
                        <SelectItem key={product.id} value={product.id}>
                          {product.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="effective"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Effective *</FormLabel>
                  <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      value={field.value}
                      className="flex gap-4"
                    >
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="now" id="access-now" />
                        <label htmlFor="access-now" className="text-sm">
                          Effective now
                        </label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="scheduled" id="access-scheduled" />
                        <label htmlFor="access-scheduled" className="text-sm">
                          Schedule for date
                        </label>
                      </div>
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {effective === "scheduled" ? (
              <FormField
                control={form.control}
                name="startsAt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start date *</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        data-testid="access-start-date"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}
            <FormField
              control={form.control}
              name="endsAt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>End date (optional)</FormLabel>
                  <FormControl>
                    <Input type="date" data-testid="access-end-date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="reasonForChange"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason *</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Why is access being granted?"
                      data-testid="access-reason"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="border-border flex items-center justify-end gap-2 border-t pt-4">
              <Button type="submit" data-testid="submit-agent-access">
                {effective === "now"
                  ? "Grant agent access"
                  : "Schedule agent access"}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Activity tab
// ---------------------------------------------------------------------------

function ActivityPanel({
  events,
  products,
}: {
  events: ActivityEvent[];
  products: Map<string, AgentProduct>;
}) {
  if (events.length === 0) {
    return (
      <EmptyState
        heading="No activity recorded"
        body="No commercial or access changes have been recorded yet."
      />
    );
  }
  return (
    <ol className="flex flex-col gap-3">
      {events.map((event) => (
        <li
          key={event.id}
          className="border-border rounded-lg border bg-card px-4 py-3"
          data-testid={`activity-${event.id}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground text-xs tabular-nums">
              {formatDateTime(event.occurredAt)}
            </span>
            <Badge variant="outline" className="text-xs">
              {event.type}
            </Badge>
            <span className="text-muted-foreground text-xs capitalize">
              {event.source}
            </span>
          </div>
          <p className="mt-1 text-sm">{event.label}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Result: <span className="capitalize">{event.resultingState}</span>
            {event.subjectId2 ? (
              <>
                {" "}
                · {products.get(event.subjectId2)?.name ?? event.subjectId2}
              </>
            ) : null}
          </p>
        </li>
      ))}
    </ol>
  );
}