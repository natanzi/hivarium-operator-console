import { useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { HiveRepository } from "@/data/local-storage-repository";
import type { Customer } from "@/domain/types";
import { TOUCH_TARGET } from "./format";

/**
 * Archive confirmation for a customer (D-05, SAFE-01).
 *
 * Replaces the old destructive delete flow: archiving flips the customer's
 * lifecycle status to `"archived"` while every dependent record (contracts,
 * agent-access history, ledger transactions, usage records) is retained and
 * remains readable. The confirmation names the customer, states the retention
 * consequence, and uses neutral/sage emphasis rather than destructive red.
 * The pending verb "Archiving…" disables double submission.
 */
export function ArchiveCustomerDialog({
  customer,
  repository,
  onArchived,
}: {
  customer: Customer;
  repository: HiveRepository;
  onArchived: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleArchive() {
    setSubmitting(true);
    try {
      await repository.archiveCustomer(customer.id);
      toast.success("Customer archived", {
        description: `${customer.name} and all related records were retained.`,
      });
      setOpen(false);
      onArchived();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "The customer was not archived. Try again.";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // Allow opening freely; only block closing while a submission is in
        // flight so the confirmation cannot be dismissed mid-archive.
        if (!next && submitting) return;
        setOpen(next);
      }}
    >
      <AlertDialogTrigger asChild>
        <button
          type="button"
          onClick={(event) => event.stopPropagation()}
          className="text-muted-foreground hover:text-foreground text-sm"
          data-testid={`archive-${customer.id}`}
        >
          Archive customer
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent data-testid="archive-customer-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Archive {customer.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            All contracts, agent-access history, ledger transactions, and usage
            records will be retained and remain available. The customer will
            leave the working list.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
          <Button
            onClick={handleArchive}
            disabled={submitting}
            data-testid={`confirm-archive-${customer.id}`}
            className="border-sage/40 bg-sage-soft text-sage hover:bg-sage-soft/70"
          >
            {submitting ? "Archiving…" : "Archive customer"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}