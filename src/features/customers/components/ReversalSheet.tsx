import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useRepository } from "@/data/repository-context";
import { SEED_NOW } from "@/data/seed-data";
import type { Customer, LedgerTransaction } from "@/domain/types";
import { formatDateTime } from "@/lib/format";
import {
  formatSignedTokens,
  formatTokens,
  TOUCH_TARGET,
  TRANSACTION_KIND_LABELS,
} from "./format";

/**
 * Confirmed single full reversal workflow for an eligible ledger transaction.
 *
 * The compact sheet shows the immutable original transaction beside required
 * Reference and Reason fields, previews the projected resulting balance, and
 * requires a named-customer AlertDialog before any write. The confirmed action
 * appends exactly one `reversal` negating the full target amount; the original
 * record remains visible. A reversal-of-reversal, a second reversal of the
 * same target, or a reversal that would make the derived balance negative is
 * unavailable with the precise reason.
 */

const reversalSchema = z.object({
  reference: z
    .string()
    .trim()
    .min(1, "Reference is required."),
  reason: z
    .string()
    .trim()
    .min(1, "Reason is required."),
});

type ReversalFormValues = z.infer<typeof reversalSchema>;

export function ReversalSheet({
  customer,
  transaction,
  balanceTokens,
  open,
  onOpenChange,
  onSaved,
}: {
  customer: Customer;
  /** The immutable original transaction being reversed. */
  transaction: LedgerTransaction;
  /** Current derived balance in whole tokens. */
  balanceTokens: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const repo = useRepository();
  const [discardOpen, setDiscardOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [blockedMessage, setBlockedMessage] = useState("");

  const form = useForm<ReversalFormValues>({
    resolver: zodResolver(reversalSchema),
    defaultValues: { reference: "", reason: "" },
    mode: "onChange",
  });

  // Reading these in render subscribes React Hook Form to the dirty and
  // validity state, so the values are live rather than a stale snapshot.
  const isDirty = form.formState.isDirty;
  const isValid = form.formState.isValid;

  const reversalAmount = -transaction.amountTokens;
  const resultingBalance = balanceTokens + reversalAmount;

  // Re-seed the form whenever the sheet opens so a previous session's values
  // never leak into the next one.
  useEffect(() => {
    if (open) {
      form.reset({ reference: "", reason: "" });
      setDiscardOpen(false);
      setConfirmOpen(false);
      setSubmitting(false);
      setBlockedMessage("");
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
    form.reset({ reference: "", reason: "" });
    setDiscardOpen(false);
    onOpenChange(false);
  }

  async function handleReview() {
    setBlockedMessage("");
    // A target that has already been reversed is rejected by the repository
    // with the precise reason at confirmation time, so the negative-balance
    // preview must not pre-empt it (the derived balance is already zeroed by
    // the earlier reversal). Only a not-yet-reversed target is blocked
    // client-side when the resulting balance would be negative.
    const transactions = await repo.listLedgerTransactions(customer.id);
    const alreadyReversed = transactions.some(
      (t) =>
        t.kind === "reversal" && t.reversesTransactionId === transaction.id
    );
    if (!alreadyReversed && resultingBalance < 0) {
      setBlockedMessage(
        "Transaction cannot be reversed because the resulting balance would be negative."
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
    try {
      await repo.reverseTransaction(
        {
          customerId: customer.id,
          transactionId: transaction.id,
          reference: form.getValues("reference").trim(),
          reason: form.getValues("reason").trim(),
        },
        SEED_NOW
      );
      toast.success("Transaction reversed");
      setConfirmOpen(false);
      form.reset({ reference: "", reason: "" });
      onSaved();
      onOpenChange(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setConfirmOpen(false);
      if (message.includes("Insufficient token balance")) {
        setBlockedMessage(
          "Transaction cannot be reversed because the resulting balance would be negative."
        );
      } else if (message.includes("is a reversal and cannot be reversed")) {
        setBlockedMessage("A reversal transaction cannot be reversed.");
      } else if (message.includes("has already been reversed")) {
        setBlockedMessage("This transaction has already been reversed.");
      } else {
        setBlockedMessage(message);
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
        data-testid="reversal-sheet"
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
          <SheetTitle>Reverse transaction</SheetTitle>
          <SheetDescription>
            Reverse an immutable transaction for {customer.name}.
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            onSubmit={(event) => event.preventDefault()}
            noValidate
            className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4"
          >
            <div
              className="border-border rounded-lg border bg-muted px-3 py-2"
              data-testid="reversal-original-transaction"
            >
              <p className="text-muted-foreground text-xs tracking-wide uppercase">
                Original transaction
              </p>
              <dl className="mt-2 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground text-xs">
                    {TRANSACTION_KIND_LABELS[transaction.kind]}
                  </dt>
                  <dd className="text-sm font-semibold tabular-nums">
                    {formatSignedTokens(transaction.amountTokens)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground text-xs">Occurred at</dt>
                  <dd className="text-sm tabular-nums">
                    {formatDateTime(transaction.occurredAt)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground text-xs">Reference</dt>
                  <dd className="font-mono text-xs break-all">
                    {transaction.reference}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground text-xs">Reason</dt>
                  <dd className="text-sm text-right break-words">
                    {transaction.reason}
                  </dd>
                </div>
              </dl>
            </div>

            <FormField
              control={form.control}
              name="reference"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reference *</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Source or reference for this reversal"
                      data-testid="reversal-reference"
                      {...field}
                    />
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
                      placeholder="Why is this transaction being reversed?"
                      data-testid="reversal-reason"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div
              className="border-border rounded-lg border bg-muted px-3 py-2"
              data-testid="reversal-resulting-balance"
            >
              <p className="text-muted-foreground text-xs tracking-wide uppercase">
                Resulting balance
              </p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums">
                {formatTokens(resultingBalance)}
              </p>
            </div>

            {blockedMessage ? (
              <p
                className="text-destructive text-sm"
                data-testid="reversal-blocked-message"
              >
                {blockedMessage}
              </p>
            ) : null}

            <div className="border-border flex items-center justify-end gap-2 border-t pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={handleDiscard}
                disabled={submitting}
                className={TOUCH_TARGET}
                data-testid="discard-reversal-draft"
              >
                Discard reversal draft
              </Button>
              <Button
                type="button"
                onClick={handleReview}
                disabled={!isValid || submitting}
                className={TOUCH_TARGET}
                data-testid="review-reversal"
              >
                Review reversal
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard reversal draft?</AlertDialogTitle>
            <AlertDialogDescription>
              Unsaved changes to this reversal draft will be lost.
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
              Discard reversal draft
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent data-testid="reversal-confirmation">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Reverse this transaction for {customer.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The original transaction of{" "}
              {formatSignedTokens(transaction.amountTokens)} will be reversed
              by {formatSignedTokens(reversalAmount)}. The balance will change
              from {formatTokens(balanceTokens)} to{" "}
              {formatTokens(resultingBalance)}. The original record will remain
              visible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              className={TOUCH_TARGET}
            >
              Edit reversal
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirm}
              disabled={!isValid || submitting}
              className={TOUCH_TARGET}
              data-testid="confirm-reverse-transaction"
            >
              {submitting ? "Reversing transaction…" : "Reverse transaction"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}