import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useRepository } from "@/data/repository-context";
import { SEED_NOW } from "@/data/seed-data";
import type { AgentProduct, Customer } from "@/domain/types";
import { formatTokens, TOUCH_TARGET } from "./format";

/**
 * Confirmed Record usage workflow for an active prepaid customer.
 *
 * The sheet collects the consuming agent (only catalog agents the customer
 * may currently use), a positive whole-token quantity, an occurred-at
 * timestamp, and a required trimmed source reference, previews the projected
 * resulting balance, and requires a named-customer AlertDialog before any
 * write. The confirmed action commits one {@link UsageRecord} plus one linked
 * `usage_debit` atomically through the repository. Re-submitting an identical
 * source reference is an idempotent no-op ("Usage already recorded"); reusing
 * the reference with different values preserves the form and shows the
 * source-reference conflict; an insufficient balance blocks the final
 * confirmation with available and attempted tokens.
 */

const usageSchema = z.object({
  agentProductId: z.string().min(1, "Choose an agent product."),
  tokenQuantity: z.string().refine(
    (value) => {
      const n = Number(value);
      return Number.isFinite(n) && Number.isInteger(n) && n > 0;
    },
    { message: "Tokens consumed must be a positive whole number." }
  ),
  occurredAt: z.string().min(1, "Occurred at is required."),
  sourceReference: z
    .string()
    .trim()
    .min(1, "Source reference is required."),
});

type UsageFormValues = z.infer<typeof usageSchema>;

/** Default occurred-at value for the sheet: the deterministic seed instant. */
const DEFAULT_OCCURRED_AT = SEED_NOW.slice(0, 16);

/**
 * Normalize a `datetime-local` value into a canonical ISO-8601 timestamp
 * (`YYYY-MM-DDTHH:mm[:ss].000Z`) so the idempotency fingerprint is stable.
 */
function toCanonicalIso(datetimeLocal: string): string {
  const trimmed = datetimeLocal.trim();
  if (!trimmed) return "";
  const withSeconds = trimmed.length === 16 ? `${trimmed}:00` : trimmed;
  return `${withSeconds}.000Z`;
}

export function RecordUsageSheet({
  customer,
  balanceTokens,
  products,
  availableAgentIds,
  open,
  onOpenChange,
  onSaved,
}: {
  customer: Customer;
  /** Current derived balance in whole tokens. */
  balanceTokens: number;
  /** Catalog agent products (used to resolve names for the select). */
  products: Map<string, AgentProduct>;
  /** Agent product ids the customer may currently use (active access). */
  availableAgentIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const repo = useRepository();
  const [discardOpen, setDiscardOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [conflictMessage, setConflictMessage] = useState("");
  const [insufficientMessage, setInsufficientMessage] = useState("");

  const form = useForm<UsageFormValues>({
    resolver: zodResolver(usageSchema),
    defaultValues: {
      agentProductId: "",
      tokenQuantity: "",
      occurredAt: DEFAULT_OCCURRED_AT,
      sourceReference: "",
    },
    mode: "onChange",
  });

  const tokenQuantity = form.watch("tokenQuantity");
  const sourceReference = form.watch("sourceReference");
  const agentProductId = form.watch("agentProductId");
  // Reading these in render subscribes React Hook Form to the dirty and
  // validity state, so the values are live rather than a stale snapshot.
  const isDirty = form.formState.isDirty;
  const isValid = form.formState.isValid;

  const availableAgents = useMemo(
    () =>
      availableAgentIds
        .map((id) => products.get(id))
        .filter((product): product is AgentProduct => product !== undefined),
    [availableAgentIds, products]
  );
  const selectedAgent = agentProductId
    ? products.get(agentProductId)
    : undefined;

  const quantity = Number(tokenQuantity);
  const quantityValid =
    Number.isFinite(quantity) && Number.isInteger(quantity) && quantity > 0;
  const resultingBalance = quantityValid
    ? balanceTokens - quantity
    : balanceTokens;

  // Re-seed the form whenever the sheet opens so a previous session's values
  // never leak into the next one.
  useEffect(() => {
    if (open) {
      form.reset({
        agentProductId: "",
        tokenQuantity: "",
        occurredAt: DEFAULT_OCCURRED_AT,
        sourceReference: "",
      });
      setDiscardOpen(false);
      setConfirmOpen(false);
      setSubmitting(false);
      setConflictMessage("");
      setInsufficientMessage("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleOpenChange(next: boolean) {
    if (!next && isDirty && !submitting) {
      setDiscardOpen(true);
      return;
    }
    onOpenChange(next);
  }

  function handleDiscard() {
    if (isDirty) {
      setDiscardOpen(true);
      return;
    }
    onOpenChange(false);
  }

  function handleDiscardConfirmed() {
    form.reset({
      agentProductId: "",
      tokenQuantity: "",
      occurredAt: DEFAULT_OCCURRED_AT,
      sourceReference: "",
    });
    setDiscardOpen(false);
    onOpenChange(false);
  }

  function handleReview() {
    setConflictMessage("");
    setInsufficientMessage("");
    if (resultingBalance < 0) {
      setInsufficientMessage(
        `Usage was not recorded. ${customer.name} has ${formatTokens(
          balanceTokens
        )} available, but this debit requires ${formatTokens(quantity)}.`
      );
      return;
    }
    setConfirmOpen(true);
  }

  async function handleConfirm() {
    setSubmitting(true);
    // Yield one macrotask so the pending verb is observable and the control
    // is disabled before the synchronous repository write.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const occurredAt = toCanonicalIso(form.getValues("occurredAt"));
    const reference = form.getValues("sourceReference").trim();
    // Capture the ledger before the call so an idempotent replay (which
    // performs no write) can be distinguished from a fresh debit.
    const existingTransactionIds = new Set(
      repo.listLedgerTransactions(customer.id).map((t) => t.id)
    );
    try {
      const result = repo.recordUsageDebit(
        {
          customerId: customer.id,
          agentProductId: form.getValues("agentProductId"),
          tokenQuantity: quantity,
          sourceReference: reference,
        },
        occurredAt
      );
      const isReplay = existingTransactionIds.has(result.transaction.id);
      if (isReplay) {
        toast.success("Usage already recorded", {
          description: "No additional tokens were deducted.",
        });
      } else {
        toast.success("Usage recorded", {
          description: `${formatTokens(quantity)} were deducted for ${
            selectedAgent?.name ?? form.getValues("agentProductId")
          }.`,
        });
      }
      setConfirmOpen(false);
      form.reset({
        agentProductId: "",
        tokenQuantity: "",
        occurredAt: DEFAULT_OCCURRED_AT,
        sourceReference: "",
      });
      onSaved();
      onOpenChange(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setConfirmOpen(false);
      if (message.includes("already assigned to different usage")) {
        setConflictMessage(
          `Source reference "${reference}" is already assigned to different usage. Enter a unique source reference or restore the original values.`
        );
      } else if (message.includes("Insufficient token balance")) {
        setInsufficientMessage(
          `Usage was not recorded. ${customer.name} has ${formatTokens(
            balanceTokens
          )} available, but this debit requires ${formatTokens(quantity)}.`
        );
      }
      toast.error(
        "The token account was not changed. Review the highlighted fields and try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        className="w-full md:max-w-[520px]"
        data-testid="record-usage-sheet"
        onEscapeKeyDown={(event) => {
          if (submitting) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (submitting) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (submitting) event.preventDefault();
        }}
      >
        <SheetHeader>
          <SheetTitle>Record usage</SheetTitle>
          <SheetDescription>
            Record agent usage against the prepaid account for {customer.name}.
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            onSubmit={(event) => event.preventDefault()}
            noValidate
            className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4"
          >
            <div className="border-border rounded-lg border bg-muted px-3 py-2">
              <p className="text-muted-foreground text-xs tracking-wide uppercase">
                Customer
              </p>
              <p className="mt-0.5 text-sm font-medium">{customer.name}</p>
            </div>

            <div className="border-border rounded-lg border bg-muted px-3 py-2">
              <p className="text-muted-foreground text-xs tracking-wide uppercase">
                Available balance
              </p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums">
                {formatTokens(balanceTokens)}
              </p>
            </div>

            <FormField
              control={form.control}
              name="agentProductId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Agent product *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="usage-agent-trigger">
                        <SelectValue placeholder="Choose an agent" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {availableAgents.map((product) => (
                        <SelectItem
                          key={product.id}
                          value={product.id}
                          data-testid={`usage-agent-option-${product.id}`}
                        >
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
              name="tokenQuantity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tokens consumed *</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      placeholder="250"
                      data-testid="usage-tokens"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="occurredAt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Occurred at *</FormLabel>
                  <FormControl>
                    <Input
                      type="datetime-local"
                      data-testid="usage-occurred-at"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="sourceReference"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Source reference *</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Unique source reference for this usage"
                      data-testid="usage-source-reference"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                  {conflictMessage ? (
                    <p
                      className="text-destructive text-sm"
                      data-testid="usage-conflict-message"
                    >
                      {conflictMessage}
                    </p>
                  ) : null}
                </FormItem>
              )}
            />

            <div
              className="border-border rounded-lg border bg-muted px-3 py-2"
              data-testid="usage-resulting-balance"
            >
              <p className="text-muted-foreground text-xs tracking-wide uppercase">
                Resulting balance
              </p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums">
                {formatTokens(resultingBalance)}
              </p>
            </div>

            {insufficientMessage ? (
              <p
                className="text-destructive text-sm"
                data-testid="usage-insufficient-message"
              >
                {insufficientMessage}
              </p>
            ) : null}

            <div className="border-border flex items-center justify-end gap-2 border-t pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={handleDiscard}
                disabled={submitting}
                className={TOUCH_TARGET}
                data-testid="discard-usage-draft"
              >
                Discard usage draft
              </Button>
              <Button
                type="button"
                onClick={handleReview}
                disabled={!isValid || submitting}
                className={TOUCH_TARGET}
                data-testid="review-usage"
              >
                Review usage
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard usage draft?</AlertDialogTitle>
            <AlertDialogDescription>
              Unsaved changes to this usage draft will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="outline"
              onClick={() => setDiscardOpen(false)}
              className={TOUCH_TARGET}
            >
              Continue editing
            </Button>
            <Button
              variant="destructive"
              onClick={handleDiscardConfirmed}
              className={TOUCH_TARGET}
            >
              Discard usage draft
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent data-testid="usage-confirmation">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Record {formatTokens(quantity)} of usage for {customer.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {selectedAgent?.name ?? "The selected agent"} will consume{" "}
              {formatTokens(quantity)}. Source reference:{" "}
              <span className="font-mono text-xs">{sourceReference}</span>. The
              balance will change from {formatTokens(balanceTokens)} to{" "}
              {formatTokens(resultingBalance)}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              className={TOUCH_TARGET}
            >
              Edit usage
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={!isValid || submitting}
              className={TOUCH_TARGET}
              data-testid="confirm-record-usage"
            >
              {submitting ? "Recording usage…" : "Record usage debit"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}