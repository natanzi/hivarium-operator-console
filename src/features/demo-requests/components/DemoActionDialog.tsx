import { useState, type ReactNode } from "react";

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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function DemoActionDialog({
  action,
  title,
  description,
  confirmLabel,
  requireNote,
  onConfirm,
  trigger,
  testId,
}: {
  action: string;
  title: string;
  description: string;
  confirmLabel: string;
  requireNote?: boolean;
  onConfirm: (note: string) => Promise<void>;
  trigger: ReactNode;
  testId: string;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function confirm() {
    setSubmitting(true);
    try {
      await onConfirm(note.trim());
      setOpen(false);
      setNote("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && submitting) return;
        setOpen(next);
      }}
    >
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent data-testid={testId}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {requireNote ? (
          <div className="grid gap-2">
            <Label htmlFor={`demo-note-${action}`}>Note</Label>
            <Textarea
              id={`demo-note-${action}`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={4000}
            />
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
          <Button
            type="button"
            onClick={() => void confirm()}
            disabled={submitting}
            data-testid={`${testId}-confirm`}
          >
            {submitting ? "Working…" : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
