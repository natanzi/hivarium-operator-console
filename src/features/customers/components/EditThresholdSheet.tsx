import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

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
import type {
  Customer,
  PrepaidCommercialArrangement,
} from "@/domain/types";
import { formatTokens, TOUCH_TARGET } from "./format";

/**
 * Compact configuration sheet for the warning threshold of an active prepaid
 * arrangement. Editing the threshold changes arrangement configuration only
 * and never creates a ledger transaction.
 */

const thresholdSchema = z.object({
  thresholdTokens: z.string().refine(
    (value) => {
      const n = Number(value);
      return Number.isFinite(n) && Number.isInteger(n) && n >= 0;
    },
    {
      message:
        "Warning threshold must be a non-negative whole number of tokens.",
    }
  ),
});

type ThresholdFormValues = z.infer<typeof thresholdSchema>;

export function EditThresholdSheet({
  customer,
  arrangement,
  open,
  onOpenChange,
  onSaved,
}: {
  customer: Customer;
  arrangement: PrepaidCommercialArrangement;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const repo = useRepository();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<ThresholdFormValues>({
    resolver: zodResolver(thresholdSchema),
    defaultValues: {
      thresholdTokens: String(arrangement.warningThresholdTokens),
    },
    mode: "onChange",
  });

  // Re-seed the form whenever the sheet opens so a previous session's values
  // never leak into the next one.
  useEffect(() => {
    if (open) {
      form.reset({
        thresholdTokens: String(arrangement.warningThresholdTokens),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function onSubmit(values: ThresholdFormValues) {
    setSubmitting(true);
    // Yield one macrotask so the pending verb is observable and the control
    // is disabled before the synchronous repository write.
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      repo.updateWarningThreshold(customer.id, Number(values.thresholdTokens));
      toast.success("Warning threshold updated");
      onSaved();
      onOpenChange(false);
    } catch {
      toast.error(
        "The warning threshold was not changed. Review the field and try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="w-full md:max-w-[520px]"
        data-testid="edit-threshold-sheet"
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
          <SheetTitle>Edit warning threshold</SheetTitle>
          <SheetDescription>
            Set the balance warning threshold for {customer.name}. This changes
            configuration only and never creates a ledger transaction.
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            noValidate
            className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4"
          >
            <FormField
              control={form.control}
              name="thresholdTokens"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Warning threshold (tokens) *</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      placeholder="100"
                      data-testid="threshold-tokens"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <p className="text-muted-foreground text-xs">
              The account is flagged as low-balance when the derived balance is
              at or below this threshold. Current threshold:{" "}
              <span className="tabular-nums">
                {formatTokens(arrangement.warningThresholdTokens)}
              </span>
              .
            </p>
            <div className="border-border flex items-center justify-end gap-2 border-t pt-4">
              <Button
                type="submit"
                disabled={submitting}
                data-testid="save-threshold"
                className={TOUCH_TARGET}
              >
                {submitting ? "Saving…" : "Save threshold"}
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}