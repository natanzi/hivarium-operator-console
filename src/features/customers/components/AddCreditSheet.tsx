import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState, type RefObject } from "react";
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
import type { Customer } from "@/domain/types";
import { formatTokens, TOUCH_TARGET } from "./format";

/**
 * Confirmed Add token credit workflow for an active prepaid customer.
 *
 * The sheet collects a positive whole-token amount, a required trimmed
 * reference, and an optional reason, previews the resulting derived balance,
 * and requires a named-customer AlertDialog before any write. The confirmed
 * action appends exactly one immutable `credit_grant` through the repository;
 * the derived balance updates immediately after the page refresh.
 */

const creditSchema = z.object({
  amountTokens: z.string().refine(
    (value) => {
      const n = Number(value);
      return Number.isFinite(n) && Number.isInteger(n) && n > 0;
    },
    { message: "Tokens to add must be a positive whole number." }
  ),
  reference: z
    .string()
    .trim()
    .min(1, "Reference is required."),
  reason: z.string().optional(),
});

type CreditFormValues = z.infer<typeof creditSchema>;

export function AddCreditSheet({
  customer,
  balanceTokens,
  open,
  onOpenChange,
  onSaved,
  addCreditButtonRef,
}: {
  customer: Customer;
  /** Current derived balance in whole tokens. */
  balanceTokens: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  /** Restores keyboard focus to the Add credit control after a success. */
  addCreditButtonRef?: RefObject<HTMLButtonElement | null>;
}) {
  const repo = useRepository();
  const [discardOpen, setDiscardOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<CreditFormValues>({
    resolver: zodResolver(creditSchema),
    defaultValues: { amountTokens: "", reference: "", reason: "" },
    mode: "onChange",
  });

  const amountTokens = form.watch("amountTokens");
  // Reading these in render subscribes React Hook Form to the dirty and
  // validity state, so the values are live rather than a stale snapshot.
  const isDirty = form.formState.isDirty;
  const isValid = form.formState.isValid;

  const amount = Number(amountTokens);
  const amountValid =
    Number.isFinite(amount) && Number.isInteger(amount) && amount > 0;
  const resultingBalance = amountValid ? balanceTokens + amount : balanceTokens;

  // Re-seed the form whenever the sheet opens so a previous session's values
  // never leak into the next one.
  useEffect(() => {
    if (open) {
      form.reset({ amountTokens: "", reference: "", reason: "" });
      setDiscardOpen(false);
      setConfirmOpen(false);
      setSubmitting(false);
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
    form.reset({ amountTokens: "", reference: "", reason: "" });
    setDiscardOpen(false);
    onOpenChange(false);
  }

  async function handleConfirm() {
    setSubmitting(true);
    // Yield one macrotask so the pending verb is observable and the control
    // is disabled before the synchronous repository write.
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      repo.addCreditGrant(
        {
          customerId: customer.id,
          amountTokens: amount,
          reference: form.getValues("reference").trim(),
          reason: form.getValues("reason")?.trim() || undefined,
        },
        SEED_NOW
      );
      toast.success("Token credit added", {
        description: `${customer.name} now has ${formatTokens(resultingBalance)}.`,
      });
      setConfirmOpen(false);
      form.reset({ amountTokens: "", reference: "", reason: "" });
      onSaved();
      onOpenChange(false);
      addCreditButtonRef?.current?.focus();
    } catch {
      toast.error(
        "The token account was not changed. Review the highlighted fields and try again."
      );
      setConfirmOpen(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        className="w-full md:max-w-[520px]"
        data-testid="add-credit-sheet"
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
          <SheetTitle>Add token credit</SheetTitle>
          <SheetDescription>
            Add tokens to the prepaid account for {customer.name}.
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
                Current balance
              </p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums">
                {formatTokens(balanceTokens)}
              </p>
            </div>

            <FormField
              control={form.control}
              name="amountTokens"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tokens to add *</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      placeholder="500"
                      data-testid="credit-amount"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="reference"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reference *</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Source or reference for this credit"
                      data-testid="credit-reference"
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
                  <FormLabel>Reason (optional)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Optional note"
                      data-testid="credit-reason"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div
              className="border-border rounded-lg border bg-muted px-3 py-2"
              data-testid="resulting-balance"
            >
              <p className="text-muted-foreground text-xs tracking-wide uppercase">
                Resulting balance
              </p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums">
                {formatTokens(resultingBalance)}
              </p>
            </div>

            <div className="border-border flex items-center justify-end gap-2 border-t pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={handleDiscard}
                disabled={submitting}
                className={TOUCH_TARGET}
                data-testid="discard-credit-draft"
              >
                Discard credit draft
              </Button>
              <Button
                type="button"
                onClick={() => setConfirmOpen(true)}
                disabled={!isValid || submitting}
                className={TOUCH_TARGET}
                data-testid="review-credit"
              >
                Review credit
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard credit draft?</AlertDialogTitle>
            <AlertDialogDescription>
              Unsaved changes to this credit draft will be lost.
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
              Discard credit draft
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent data-testid="credit-confirmation">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Add {formatTokens(amount)} to {customer.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The balance will change from {formatTokens(balanceTokens)} to{" "}
              {formatTokens(resultingBalance)}. A credit grant will be added to
              the immutable account statement.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              className={TOUCH_TARGET}
            >
              Edit credit
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={!isValid || submitting}
              className={TOUCH_TARGET}
              data-testid="confirm-add-credit"
            >
              {submitting ? "Adding credit…" : "Add token credit"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}