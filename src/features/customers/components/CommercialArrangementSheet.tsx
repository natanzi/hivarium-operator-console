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
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
import type { CommercialSnapshot } from "@/data/local-storage-repository";
import { useRepository } from "@/data/repository-context";
import { SEED_NOW } from "@/data/seed-data";
import type {
  AllowanceUnit,
  CommercialArrangement,
  Customer,
} from "@/domain/types";
import type { CommercialArrangementInput } from "@/domain/commercial-rules";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { formatUsd, modelLabel, TOUCH_TARGET } from "./format";

/**
 * Set / change / review / terminate workflow for a customer's commercial
 * arrangement.
 *
 * The drawer exposes exactly one model at a time, an effective-now or
 * scheduled choice, model-exclusive fields, a consequence review, and a
 * model-specific commit verb. Dirty drawers require an explicit discard
 * confirmation, and committing disables the submit control so a mutation can
 * never be submitted twice.
 */

const COMMERCIAL_MODELS = ["monthly", "prepaid", "annual"] as const;
type CommercialModel = (typeof COMMERCIAL_MODELS)[number];

const MODEL_DESCRIPTIONS: Record<CommercialModel, string> = {
  monthly: "Fixed recurring monthly amount",
  prepaid: "USD balance for usage",
  annual: "Term contract with allowance",
};

const ALLOWANCE_UNITS: AllowanceUnit[] = [
  "tokens",
  "seats",
  "requests",
  "usd",
  "other",
];

const SEED_DATE = SEED_NOW.slice(0, 10);

const commercialSchema = z
  .object({
    model: z.enum(["monthly", "prepaid", "annual"]),
    effective: z.enum(["now", "scheduled"]),
    effectiveDate: z.string().optional(),
    monthlyAmountDollars: z.string().optional(),
    renewsAt: z.string().optional(),
    balanceDollars: z.string().optional(),
    expiresAt: z.string().optional(),
    contractValueDollars: z.string().optional(),
    startsAt: z.string().optional(),
    endsAt: z.string().optional(),
    includedAllowance: z.string().optional(),
    allowanceUnit: z.string().optional(),
    overageRateDollars: z.string().optional(),
    reason: z.string().min(1, "Reason is required."),
  })
  .superRefine((values, ctx) => {
    if (values.effective === "scheduled") {
      if (!values.effectiveDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["effectiveDate"],
          message: "Choose an effective date.",
        });
      } else if (values.effectiveDate <= SEED_DATE) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["effectiveDate"],
          message: "Choose a future effective date.",
        });
      }
    }
    if (values.model === "monthly") {
      if (
        !values.monthlyAmountDollars ||
        Number(values.monthlyAmountDollars) <= 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["monthlyAmountDollars"],
          message: "Monthly amount must be greater than zero.",
        });
      }
      if (!values.renewsAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["renewsAt"],
          message: "Next renewal date is required.",
        });
      }
    }
    if (values.model === "prepaid") {
      if (!values.balanceDollars || Number(values.balanceDollars) <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["balanceDollars"],
          message: "Balance must be greater than zero.",
        });
      }
    }
    if (values.model === "annual") {
      if (!values.contractValueDollars || Number(values.contractValueDollars) <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["contractValueDollars"],
          message: "Contract value must be greater than zero.",
        });
      }
      if (!values.startsAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["startsAt"],
          message: "Start date is required.",
        });
      }
      if (!values.endsAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["endsAt"],
          message: "End date is required.",
        });
      }
      if (values.startsAt && values.endsAt && values.endsAt < values.startsAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["endsAt"],
          message: "End date must not be earlier than start date.",
        });
      }
      if (
        values.includedAllowance === undefined ||
        values.includedAllowance === "" ||
        Number(values.includedAllowance) < 0 ||
        !Number.isInteger(Number(values.includedAllowance))
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["includedAllowance"],
          message: "Included allowance must be a non-negative whole number.",
        });
      }
      if (!values.allowanceUnit) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["allowanceUnit"],
          message: "Choose an allowance unit.",
        });
      }
      if (
        values.overageRateDollars === undefined ||
        values.overageRateDollars === "" ||
        Number(values.overageRateDollars) < 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["overageRateDollars"],
          message: "Overage rate must be zero or greater.",
        });
      }
    }
  });

type CommercialFormValues = z.infer<typeof commercialSchema>;

/** Module-level sequence keeps generated arrangement ids unique per session. */
let arrangementSequence = 0;

function defaultValuesFor(
  snapshot: CommercialSnapshot
): CommercialFormValues {
  const source = snapshot.scheduled ?? snapshot.active;
  const empty: CommercialFormValues = {
    model: "monthly",
    effective: "now",
    effectiveDate: "",
    monthlyAmountDollars: "",
    renewsAt: "",
    balanceDollars: "",
    expiresAt: "",
    contractValueDollars: "",
    startsAt: "",
    endsAt: "",
    includedAllowance: "",
    allowanceUnit: "tokens",
    overageRateDollars: "",
    reason: "",
  };
  if (!source) return empty;
  const base = { ...empty, model: source.model, reason: "" };
  switch (source.model) {
    case "monthly":
      return {
        ...base,
        monthlyAmountDollars: (source.monthlyAmountCents / 100).toFixed(2),
        renewsAt: source.renewsAt.slice(0, 10),
      };
    case "prepaid":
      return {
        ...base,
        balanceDollars: (source.balanceCents / 100).toFixed(2),
        expiresAt: source.expiresAt ? source.expiresAt.slice(0, 10) : "",
      };
    case "annual":
      return {
        ...base,
        contractValueDollars: (source.contractValueCents / 100).toFixed(2),
        startsAt: source.startsAt.slice(0, 10),
        endsAt: source.endsAt.slice(0, 10),
        includedAllowance: String(source.includedAllowance),
        allowanceUnit: source.allowanceUnit,
        overageRateDollars: (source.overageRateCentsPerUnit / 100).toFixed(2),
      };
  }
}

function sheetTitle(snapshot: CommercialSnapshot): string {
  if (snapshot.scheduled) return "Review scheduled change";
  if (snapshot.active) return "Change commercial model";
  return "Set commercial model";
}

function consequenceSummary(
  snapshot: CommercialSnapshot,
  values: CommercialFormValues
): string {
  if (snapshot.scheduled) {
    return `The scheduled ${modelLabel(snapshot.scheduled.model)} change will be replaced by the new arrangement.`;
  }
  if (snapshot.active) {
    if (values.effective === "now") {
      return `The current ${modelLabel(snapshot.active.model)} arrangement will move to history.`;
    }
    return `The current ${modelLabel(snapshot.active.model)} arrangement stays active until ${formatDate(`${values.effectiveDate}T00:00:00.000Z`)}.`;
  }
  return "This will be the customer's first commercial arrangement.";
}

function ctaLabel(values: CommercialFormValues, submitting: boolean): string {
  if (submitting) {
    if (values.effective === "scheduled") return "Scheduling change…";
    switch (values.model) {
      case "monthly":
        return "Starting monthly subscription…";
      case "prepaid":
        return "Activating prepaid balance…";
      case "annual":
        return "Starting annual contract…";
    }
  }
  if (values.effective === "scheduled") return "Schedule commercial change";
  switch (values.model) {
    case "monthly":
      return "Start monthly subscription";
    case "prepaid":
      return "Activate prepaid balance";
    case "annual":
      return "Start annual contract";
  }
}

export function CommercialArrangementSheet({
  customer,
  snapshot,
  open,
  onOpenChange,
  onSaved,
}: {
  customer: Customer;
  snapshot: CommercialSnapshot;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const repo = useRepository();
  const [discardOpen, setDiscardOpen] = useState(false);

  const form = useForm<CommercialFormValues>({
    resolver: zodResolver(commercialSchema),
    defaultValues: defaultValuesFor(snapshot),
    mode: "onChange",
  });

  const model = form.watch("model");
  const effective = form.watch("effective");
  const values = form.watch();
  // Reading these in render subscribes React Hook Form to the dirty and
  // submitting state, so the values are live rather than a stale snapshot.
  const isDirty = form.formState.isDirty;
  const isSubmitting = form.formState.isSubmitting;

  // Re-seed the form whenever the drawer opens so a previous session's values
  // never leak into the next one.
  useEffect(() => {
    if (open) {
      form.reset(defaultValuesFor(snapshot));
      setDiscardOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleOpenChange(next: boolean) {
    if (!next && isDirty && !isSubmitting) {
      setDiscardOpen(true);
      return;
    }
    onOpenChange(next);
  }

  function handleDiscard() {
    form.reset(defaultValuesFor(snapshot));
    setDiscardOpen(false);
    onOpenChange(false);
  }

  async function onSubmit(submitted: CommercialFormValues) {
    // Yield one macrotask so the pending verb is observable and the control
    // is disabled before the synchronous repository write.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const occurredAt = SEED_NOW;
    const effectiveFrom =
      submitted.effective === "now"
        ? occurredAt
        : `${submitted.effectiveDate}T00:00:00.000Z`;
    const input: CommercialArrangementInput = {
      id: `arr_${customer.id}_${occurredAt}_${submitted.model}_${arrangementSequence++}`,
      customerId: customer.id,
      model: submitted.model,
      status: submitted.effective === "now" ? "active" : "scheduled",
      effectiveFrom,
      effectiveTo: null,
      createdAt: occurredAt,
      reason: submitted.reason,
      currency: "USD",
    };
    if (submitted.model === "monthly") {
      input.billingCadence = "monthly";
      input.monthlyAmountCents = Math.round(
        Number(submitted.monthlyAmountDollars) * 100
      );
      input.renewsAt = `${submitted.renewsAt}T00:00:00.000Z`;
    } else if (submitted.model === "prepaid") {
      input.balanceCents = Math.round(Number(submitted.balanceDollars) * 100);
      input.expiresAt = submitted.expiresAt
        ? `${submitted.expiresAt}T00:00:00.000Z`
        : null;
    } else {
      input.contractValueCents = Math.round(
        Number(submitted.contractValueDollars) * 100
      );
      input.startsAt = `${submitted.startsAt}T00:00:00.000Z`;
      input.endsAt = `${submitted.endsAt}T00:00:00.000Z`;
      input.includedAllowance = Number(submitted.includedAllowance);
      input.allowanceUnit = submitted.allowanceUnit as AllowanceUnit;
      input.overageRateCentsPerUnit = Math.round(
        Number(submitted.overageRateDollars) * 100
      );
    }
    try {
      repo.saveCommercialArrangement(input, occurredAt);
      toast.success(
        submitted.effective === "now"
          ? "Commercial model started"
          : "Commercial model scheduled"
      );
      form.reset(defaultValuesFor(snapshot));
      onSaved();
      onOpenChange(false);
    } catch {
      toast.error(
        "Commercial changes were not saved. Review the highlighted fields and try again."
      );
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        className="w-full md:max-w-[520px]"
        data-testid="commercial-sheet"
        onEscapeKeyDown={(event) => {
          if (isSubmitting) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (isSubmitting) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (isSubmitting) event.preventDefault();
        }}
      >
        <SheetHeader>
          <SheetTitle>{sheetTitle(snapshot)}</SheetTitle>
          <SheetDescription>
            {snapshot.active
              ? `Change the commercial arrangement for ${customer.name}.`
              : `Set the first commercial arrangement for ${customer.name}.`}
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
              name="model"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Commercial model *</FormLabel>
                  <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      value={field.value}
                      className="grid gap-2 sm:grid-cols-3"
                    >
                      {COMMERCIAL_MODELS.map((modelOption) => (
                        <div key={modelOption}>
                          <RadioGroupItem
                            value={modelOption}
                            id={`commercial-model-${modelOption}`}
                            className="peer sr-only"
                          />
                          <label
                            htmlFor={`commercial-model-${modelOption}`}
                            className={cn(
                              "border-border flex h-full cursor-pointer flex-col gap-1 rounded-lg border bg-card px-3 py-2 transition-colors",
                              "peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary-soft",
                              "peer-focus-visible:ring-ring peer-focus-visible:ring-[3px]"
                            )}
                          >
                            <span className="text-sm font-semibold">
                              {modelLabel(modelOption)}
                            </span>
                            <span className="text-muted-foreground text-xs">
                              {MODEL_DESCRIPTIONS[modelOption]}
                            </span>
                          </label>
                        </div>
                      ))}
                    </RadioGroup>
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
                        <RadioGroupItem
                          value="now"
                          id="commercial-effective-now"
                        />
                        <label
                          htmlFor="commercial-effective-now"
                          className="text-sm"
                        >
                          Effective now
                        </label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem
                          value="scheduled"
                          id="commercial-effective-scheduled"
                        />
                        <label
                          htmlFor="commercial-effective-scheduled"
                          className="text-sm"
                        >
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

            {model === "monthly" ? (
              <>
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
                  name="renewsAt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Next renewal date *</FormLabel>
                      <FormControl>
                        <Input
                          type="date"
                          data-testid="renews-at"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            ) : null}

            {model === "prepaid" ? (
              <>
                <FormField
                  control={form.control}
                  name="balanceDollars"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Balance (USD) *</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="2500.00"
                          data-testid="prepaid-balance"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="expiresAt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Expiry date (optional)</FormLabel>
                      <FormControl>
                        <Input
                          type="date"
                          data-testid="prepaid-expiry"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <p className="text-muted-foreground text-xs">
                  Detailed usage accounting is added in Phase 2.
                </p>
              </>
            ) : null}

            {model === "annual" ? (
              <>
                <FormField
                  control={form.control}
                  name="contractValueDollars"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contract value (USD) *</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          data-testid="annual-value"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="startsAt"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Start date *</FormLabel>
                        <FormControl>
                          <Input
                            type="date"
                            data-testid="annual-start"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="endsAt"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>End date *</FormLabel>
                        <FormControl>
                          <Input
                            type="date"
                            data-testid="annual-end"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="includedAllowance"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Included allowance *</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min="0"
                            step="1"
                            data-testid="annual-allowance"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="allowanceUnit"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Allowance unit *</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="allowance-unit-trigger">
                              <SelectValue placeholder="Choose a unit" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {ALLOWANCE_UNITS.map((unit) => (
                              <SelectItem key={unit} value={unit}>
                                {unit}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="overageRateDollars"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Overage rate (USD per unit) *</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          data-testid="annual-overage"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            ) : null}

            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason *</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Why is this arrangement being created or changed?"
                      data-testid="arrangement-reason"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div
              className="border-border rounded-lg border bg-muted px-3 py-2"
              data-testid="consequence-summary"
            >
              <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Consequence
              </p>
              <p className="mt-0.5 text-sm">{consequenceSummary(snapshot, values)}</p>
            </div>

            <div className="border-border flex items-center justify-end gap-2 border-t pt-4">
              <Button
                type="submit"
                disabled={isSubmitting}
                data-testid="submit-commercial-arrangement"
                className={TOUCH_TARGET}
              >
                {ctaLabel(values, isSubmitting)}
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard commercial changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Unsaved changes to this commercial arrangement will be lost.
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
              onClick={handleDiscard}
              className={TOUCH_TARGET}
            >
              Discard commercial changes
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}

/**
 * Destructive confirmation for terminating the active arrangement. Names the
 * exact model and customer and discloses how many active grants will be
 * revoked before the mutation is committed.
 */
export function TerminateArrangementDialog({
  customer,
  arrangement,
  activeGrantCount,
  open,
  onOpenChange,
  onTerminated,
}: {
  customer: Customer;
  arrangement: CommercialArrangement;
  activeGrantCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTerminated: () => void;
}) {
  const repo = useRepository();
  const [submitting, setSubmitting] = useState(false);
  const [reason, setReason] = useState("");

  async function handleTerminate() {
    setSubmitting(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      repo.terminateCommercialArrangement(
        {
          arrangementId: arrangement.id,
          customerId: customer.id,
          reason: reason.trim() || "Terminated by operator.",
        },
        SEED_NOW
      );
      toast.success("Commercial arrangement terminated");
      onTerminated();
      onOpenChange(false);
    } catch {
      toast.error(
        "Commercial changes were not saved. Review the highlighted fields and try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !submitting) onOpenChange(next);
      }}
    >
      <AlertDialogContent
        onEscapeKeyDown={(event) => {
          if (submitting) event.preventDefault();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            Terminate {modelLabel(arrangement.model)} for {customer.name}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {activeGrantCount} active agent access{" "}
            {activeGrantCount === 1 ? "grant" : "grants"} will be revoked and
            recorded in Activity.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="terminate-reason">Reason *</Label>
          <Input
            id="terminate-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why is this arrangement being terminated?"
            data-testid="terminate-reason"
          />
        </div>
        <AlertDialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            className={TOUCH_TARGET}
          >
            Keep arrangement
          </Button>
          <Button
            variant="destructive"
            onClick={handleTerminate}
            disabled={submitting}
            className={TOUCH_TARGET}
          >
            {submitting ? "Terminating…" : "Terminate and revoke access"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Read-only record view for a historical arrangement. Historical records are
 * immutable; this dialog only presents the stored terms.
 */
export function ArrangementRecordDialog({
  arrangement,
  open,
  onOpenChange,
}: {
  arrangement: CommercialArrangement;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="arrangement-record-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {modelLabel(arrangement.model)} arrangement record
          </AlertDialogTitle>
          <AlertDialogDescription>
            Historical record · {arrangement.status}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <dl className="grid gap-3 sm:grid-cols-2">
          <RecordDetail label="Effective" value={formatDate(arrangement.effectiveFrom)} />
          <RecordDetail
            label="Ended"
            value={
              arrangement.effectiveTo
                ? formatDate(arrangement.effectiveTo)
                : "Not recorded"
            }
          />
          {arrangement.model === "monthly" ? (
            <>
              <RecordDetail
                label="Monthly amount"
                value={formatUsd(arrangement.monthlyAmountCents)}
              />
              <RecordDetail
                label="Next renewal"
                value={formatDate(arrangement.renewsAt)}
              />
            </>
          ) : arrangement.model === "prepaid" ? (
            <>
              <RecordDetail
                label="Balance"
                value={formatUsd(arrangement.balanceCents)}
              />
              <RecordDetail
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
              <RecordDetail
                label="Contract value"
                value={formatUsd(arrangement.contractValueCents)}
              />
              <RecordDetail
                label="Term"
                value={`${formatDate(arrangement.startsAt)} – ${formatDate(arrangement.endsAt)}`}
              />
              <RecordDetail
                label="Allowance"
                value={`${arrangement.includedAllowance.toLocaleString()} ${arrangement.allowanceUnit}`}
              />
              <RecordDetail
                label="Overage rate"
                value={`${formatUsd(arrangement.overageRateCentsPerUnit)} / unit`}
              />
            </>
          )}
          <RecordDetail
            label="Reason"
            value={arrangement.reason || "Not recorded"}
          />
          <RecordDetail label="Record ID" value={arrangement.id} mono />
        </dl>
        <AlertDialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className={TOUCH_TARGET}
          >
            Close
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RecordDetail({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="border-border rounded-lg border px-3 py-2">
      <dt className="text-muted-foreground text-xs tracking-wide uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-0.5 text-sm break-words",
          mono && "font-mono text-xs"
        )}
      >
        {value}
      </dd>
    </div>
  );
}