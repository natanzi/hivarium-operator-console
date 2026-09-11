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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
import { formatSignedTokens, formatTokens, TOUCH_TARGET } from "./format";

/**
 * Confirmed manual adjustment workflow for an active prepaid customer.
 *
 * The sheet collects an adjustment direction (Add tokens / Remove tokens), a
 * positive whole-token amount, a required reference, and a required reason,
 * previews the resulting derived balance, and requires a named-customer
 * AlertDialog before any write. An adjustment that would make the derived
 * balance negative is blocked before the confirmation with the available and
 * attempted token values.
 */

const adjustmentSchema = z.object({
  direction: z.enum(["add", "remove"]),
  amountTokens: z.string().refine(
    (value) => {
      const n = Number(value);
      return Number.isFinite(n) && Number.isInteger(n) && n > 0;
    },
    { message: "Token amount must be a positive whole number." }
  ),
  reference: z
    .string()
    .trim()
    .min(1, "Reference is required."),
  reason: z
    .string()
    .trim()
    .min(1, "Reason is required."),
});

type AdjustmentFormValues = z.infer<typeof adjustmentSchema>;

export function AdjustmentSheet({
  customer,
  balanceTokens,
  open,
  onOpenChange,
  onSaved,
}: {
  customer: Customer;
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

  const form = useForm<AdjustmentFormValues>({
    resolver: zodResolver(adjustmentSchema),
    defaultValues: {
      direction: "add",
      amountTokens: "",
      reference: "",
      reason: "",
    },
    mode: "onChange",
  });

  const direction = form.watch("direction");
  const amountTokens = form.watch("amountTokens");
  // Reading these in render subscribes React Hook Form to the dirty and
  // validity state, so the values are live rather than a stale snapshot.
  const isDirty = form.formState.isDirty;
  const isValid = form.formState.isValid;

  const amount = Number(amountTokens);
  const amountValid =
    Number.isFinite(amount) && Number.isInteger(amount) && amount > 0;
  const signedAmount = amountValid
    ? direction === "add"
      ? amount
      : -amount
    : 0;
  const resultingBalance = amountValid
    ? balanceTokens + signedAmount
    : balanceTokens;

  // Re-seed the form whenever the sheet opens so a previous session's values
  // never leak into the next one.
  useEffect(() => {
    if (open) {
      form.reset({
        direction: "add",
        amountTokens: "",
        reference: "",
        reason: "",
      });
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
    form.reset({
      direction: "add",
      amountTokens: "",
      reference: "",
      reason: "",
    });
    setDiscardOpen(false);
    onOpenChange(false);
  }

  function handleReview() {
    setBlockedMessage("");
    if (resultingBalance < 0) {
      setBlockedMessage(
        `Adjustment was not applied. Removing ${formatTokens(
          amount
        )} would exceed the available balance of ${formatTokens(
          balanceTokens
        )}.`
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
      await repo.addManualAdjustment(
        {
          customerId: customer.id,
          amountTokens: signedAmount,
          reference: form.getValues("reference").trim(),
          reason: form.getValues("reason").trim(),
        },
        SEED_NOW
      );
      toast.success("Balance adjustment recorded");
      setConfirmOpen(false);
      form.reset({
        direction: "add",
        amountTokens: "",
        reference: "",
        reason: "",
      });
      onSaved();
      onOpenChange(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setConfirmOpen(false);
      if (message.includes("Insufficient token balance")) {
        setBlockedMessage(
          `Adjustment was not applied. Removing ${formatTokens(
            amount
          )} would exceed the available balance of ${formatTokens(
            balanceTokens
          )}.`
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
        data-testid="adjustment-sheet"
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
          <SheetTitle>Adjust balance</SheetTitle>
          <SheetDescription>
            Apply a manual balance adjustment for {customer.name}.
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
              name="direction"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Adjustment direction *</FormLabel>
                  <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      value={field.value}
                      className="flex gap-4"
                    >
                      <div className="flex items-center gap-2">
                        <RadioGroupItem
                          value="add"
                          id="adjustment-direction-add"
                        />
                        <label
                          htmlFor="adjustment-direction-add"
                          className="text-sm"
                        >
                          Add tokens
                        </label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem
                          value="remove"
                          id="adjustment-direction-remove"
                        />
                        <label
                          htmlFor="adjustment-direction-remove"
                          className="text-sm"
                        >
                          Remove tokens
                        </label>
                      </div>
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="amountTokens"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Token amount *</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      placeholder="500"
                      data-testid="adjustment-amount"
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
                      placeholder="Source or reference for this adjustment"
                      data-testid="adjustment-reference"
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
                      placeholder="Why is this adjustment being applied?"
                      data-testid="adjustment-reason"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div
              className="border-border rounded-lg border bg-muted px-3 py-2"
              data-testid="adjustment-resulting-balance"
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
                data-testid="adjustment-blocked-message"
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
                data-testid="discard-adjustment-draft"
              >
                Discard adjustment draft
              </Button>
              <Button
                type="button"
                onClick={handleReview}
                disabled={!isValid || submitting}
                className={TOUCH_TARGET}
                data-testid="review-adjustment"
              >
                Review adjustment
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard adjustment draft?</AlertDialogTitle>
            <AlertDialogDescription>
              Unsaved changes to this adjustment draft will be lost.
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
              Discard adjustment draft
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent data-testid="adjustment-confirmation">
          <AlertDialogHeader>
            <AlertDialogTitle>Adjust {customer.name}'s balance?</AlertDialogTitle>
            <AlertDialogDescription>
              {formatSignedTokens(signedAmount)} will be applied. The balance
              will change from {formatTokens(balanceTokens)} to{" "}
              {formatTokens(resultingBalance)}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              className={TOUCH_TARGET}
            >
              Edit adjustment
            </Button>
            <Button
              variant={direction === "remove" ? "destructive" : "default"}
              onClick={handleConfirm}
              disabled={!isValid || submitting}
              className={TOUCH_TARGET}
              data-testid="confirm-apply-adjustment"
            >
              {submitting ? "Applying adjustment…" : "Apply balance adjustment"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}