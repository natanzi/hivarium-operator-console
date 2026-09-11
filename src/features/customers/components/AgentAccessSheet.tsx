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
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { AgentAccessSnapshot } from "@/data/local-storage-repository";
import { useRepository } from "@/data/repository-context";
import { SEED_NOW } from "@/data/seed-data";
import type { AgentAccessGrant, AgentProduct, Customer } from "@/domain/types";
import { cn } from "@/lib/utils";
import { TOUCH_TARGET } from "./format";

/**
 * Grant / revoke workflow for a customer's agent access.
 *
 * The grant drawer is a searchable catalog list; agents the customer already
 * has active or scheduled access to are disabled with an explanation. The
 * revoke dialog supports immediate and scheduled revocation and always keeps
 * the access record in history.
 */

const SEED_DATE = SEED_NOW.slice(0, 10);

const accessSchema = z
  .object({
    agentProductId: z.string().min(1, "Choose an agent product."),
    effective: z.enum(["now", "scheduled"]),
    startsAt: z.string().optional(),
    endsAt: z.string().optional(),
    reasonForChange: z.string().min(1, "Reason is required."),
  })
  .superRefine((values, ctx) => {
    if (values.effective === "scheduled") {
      if (!values.startsAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["startsAt"],
          message: "Choose a start date.",
        });
      } else if (values.startsAt <= SEED_DATE) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["startsAt"],
          message: "Choose a future start date.",
        });
      }
    }
    if (values.endsAt && values.startsAt && values.endsAt < values.startsAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endsAt"],
        message: "End date must not be earlier than start date.",
      });
    }
  });

type AccessFormValues = z.infer<typeof accessSchema>;

/** Module-level sequence keeps generated grant ids unique per session. */
let grantSequence = 0;

export function AgentAccessSheet({
  customer,
  snapshot,
  products,
  open,
  onOpenChange,
  onSaved,
}: {
  customer: Customer;
  snapshot: AgentAccessSnapshot;
  products: Map<string, AgentProduct>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const repo = useRepository();
  const [search, setSearch] = useState("");
  const [discardOpen, setDiscardOpen] = useState(false);

  const form = useForm<AccessFormValues>({
    resolver: zodResolver(accessSchema),
    defaultValues: {
      agentProductId: "",
      effective: "now",
      startsAt: "",
      endsAt: "",
      reasonForChange: "",
    },
    mode: "onChange",
  });

  const selectedProductId = form.watch("agentProductId");
  const effective = form.watch("effective");
  // Reading these in render subscribes React Hook Form to the dirty and
  // submitting state, so the values are live rather than a stale snapshot.
  const isDirty = form.formState.isDirty;
  const isSubmitting = form.formState.isSubmitting;

  const blockedProductIds = useMemo(() => {
    const ids = new Set<string>();
    for (const grant of snapshot.current) ids.add(grant.agentProductId);
    for (const grant of snapshot.scheduled) ids.add(grant.agentProductId);
    return ids;
  }, [snapshot]);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return [...products.values()];
    return [...products.values()].filter(
      (product) =>
        product.name.toLowerCase().includes(query) ||
        product.category.toLowerCase().includes(query) ||
        product.description.toLowerCase().includes(query)
    );
  }, [products, search]);

  const selectedProduct = selectedProductId
    ? products.get(selectedProductId)
    : undefined;

  useEffect(() => {
    if (open) {
      form.reset({
        agentProductId: "",
        effective: "now",
        startsAt: "",
        endsAt: "",
        reasonForChange: "",
      });
      setSearch("");
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
    form.reset();
    setDiscardOpen(false);
    onOpenChange(false);
  }

  async function onSubmit(values: AccessFormValues) {
    // Yield one macrotask so the pending verb is observable and the control
    // is disabled before the synchronous repository write.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const occurredAt = SEED_NOW;
    const startsAt =
      values.effective === "now"
        ? occurredAt
        : `${values.startsAt}T00:00:00.000Z`;
    try {
      await repo.grantAgentAccess(
        {
          id: `grant_${customer.id}_${values.agentProductId}_${occurredAt}_${grantSequence++}`,
          customerId: customer.id,
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
      onOpenChange(false);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Agent access was not changed. Review the dates and try again.";
      toast.error(message);
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        className="w-full md:max-w-[520px]"
        data-testid="access-sheet"
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
          <SheetTitle>Grant agent access</SheetTitle>
          <SheetDescription>
            Choose an agent from the Hivarium catalog for {customer.name}.
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            noValidate
            className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4"
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="agent-search">Search agents</Label>
              <Input
                id="agent-search"
                type="search"
                placeholder="Search agents…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                data-testid="agent-search"
              />
            </div>

            <div
              className="flex flex-col gap-2"
              data-testid="agent-catalog-list"
            >
              {filteredProducts.length === 0 ? (
                <div className="border-border flex flex-col items-center gap-2 rounded-xl border bg-card px-4 py-8 text-center">
                  <h3 className="text-sm font-semibold">
                    No catalog agents match this search
                  </h3>
                  <p className="text-muted-foreground max-w-sm text-sm">
                    Clear the search or choose another category.
                  </p>
                </div>
              ) : (
                filteredProducts.map((product) => {
                  const blocked = blockedProductIds.has(product.id);
                  const selected = selectedProductId === product.id;
                  return (
                    <button
                      key={product.id}
                      type="button"
                      disabled={blocked}
                      onClick={() =>
                        form.setValue("agentProductId", product.id, {
                          shouldDirty: true,
                        })
                      }
                      className={cn(
                        "border-border flex flex-col items-start gap-0.5 rounded-lg border bg-card px-3 py-2 text-left transition-colors",
                        "hover:bg-accent hover:text-accent-foreground",
                        selected &&
                        "border-primary bg-primary-soft hover:bg-primary-soft",
                        blocked &&
                        "cursor-not-allowed opacity-50 hover:bg-card hover:text-inherit"
                      )}
                      data-testid={`agent-option-${product.id}`}
                    >
                      <span className="text-sm font-medium">{product.name}</span>
                      <span className="text-muted-foreground text-xs">
                        {product.category} · v{product.version}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {product.description}
                      </span>
                      {blocked ? (
                        <span className="text-xs font-medium">
                          This customer already has access
                        </span>
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>

            {selectedProduct ? (
              <div className="flex flex-col gap-4" data-testid="grant-details">
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
                              id="access-effective-now"
                            />
                            <label
                              htmlFor="access-effective-now"
                              className="text-sm"
                            >
                              Effective now
                            </label>
                          </div>
                          <div className="flex items-center gap-2">
                            <RadioGroupItem
                              value="scheduled"
                              id="access-effective-scheduled"
                            />
                            <label
                              htmlFor="access-effective-scheduled"
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
                        <Input
                          type="date"
                          data-testid="access-end-date"
                          {...field}
                        />
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

                <div
                  className="border-border rounded-lg border bg-muted px-3 py-2"
                  data-testid="access-consequence-summary"
                >
                  <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                    Consequence
                  </p>
                  <p className="mt-0.5 text-sm">
                    Granting {selectedProduct.name} access to {customer.name}.
                  </p>
                </div>
              </div>
            ) : null}

            <div className="border-border flex items-center justify-end gap-2 border-t pt-4">
              <Button
                type="submit"
                disabled={isSubmitting || !selectedProductId}
                data-testid="submit-agent-access"
                className={TOUCH_TARGET}
              >
                {isSubmitting
                  ? effective === "now"
                    ? "Granting access…"
                    : "Scheduling access…"
                  : effective === "now"
                    ? "Grant agent access"
                    : "Schedule agent access"}
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard access changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Unsaved changes to this agent access will be lost.
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
              Discard access changes
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}

/**
 * Revocation confirmation for an active grant. Supports immediate and
 * scheduled revocation; the access record is always retained in history.
 */
export function RevokeAccessDialog({
  customer,
  grant,
  product,
  open,
  onOpenChange,
  onRevoked,
}: {
  customer: Customer;
  grant: AgentAccessGrant;
  product: AgentProduct | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRevoked: () => void;
}) {
  const repo = useRepository();
  const [effective, setEffective] = useState<"now" | "scheduled">("now");
  const [revokeDate, setRevokeDate] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const agentName = product?.name ?? grant.agentProductId;
  const scheduledInvalid = effective === "scheduled" && revokeDate <= SEED_DATE;

  async function handleRevoke() {
    setSubmitting(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const occurredAt = SEED_NOW;
    const effectiveAt =
      effective === "now" ? occurredAt : `${revokeDate}T00:00:00.000Z`;
    try {
      await repo.revokeAgentAccess(
        {
          grantId: grant.id,
          customerId: customer.id,
          reason: reason.trim() || "Revoked by operator.",
          effectiveAt,
        },
        occurredAt
      );
      toast.success(
        effective === "now"
          ? "Agent access revoked"
          : "Agent access revocation scheduled"
      );
      onRevoked();
      onOpenChange(false);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Agent access was not changed. Review the dates and try again.";
      toast.error(message);
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
            Revoke {agentName} access for {customer.name}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            The access record will remain in history.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-4">
          <RadioGroup
            value={effective}
            onValueChange={(value) =>
              setEffective(value as "now" | "scheduled")
            }
            className="flex gap-4"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="now" id="revoke-now" />
              <label htmlFor="revoke-now" className="text-sm">
                Revoke now
              </label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="scheduled" id="revoke-scheduled" />
              <label htmlFor="revoke-scheduled" className="text-sm">
                Schedule for date
              </label>
            </div>
          </RadioGroup>
          {effective === "scheduled" ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="revoke-date">Revocation date *</Label>
              <Input
                id="revoke-date"
                type="date"
                value={revokeDate}
                onChange={(event) => setRevokeDate(event.target.value)}
                data-testid="revoke-date"
              />
              {scheduledInvalid ? (
                <p className="text-destructive text-sm">
                  Choose a future revocation date.
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-col gap-2">
            <Label htmlFor="revoke-reason">Reason *</Label>
            <Input
              id="revoke-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why is access being revoked?"
              data-testid="revoke-reason"
            />
          </div>
        </div>
        <AlertDialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            className={TOUCH_TARGET}
          >
            Keep access
          </Button>
          <Button
            variant="destructive"
            onClick={handleRevoke}
            disabled={submitting || scheduledInvalid}
            className={TOUCH_TARGET}
          >
            {submitting
              ? effective === "now"
                ? "Revoking…"
                : "Scheduling…"
              : effective === "now"
                ? "Revoke agent access"
                : "Schedule revocation"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}