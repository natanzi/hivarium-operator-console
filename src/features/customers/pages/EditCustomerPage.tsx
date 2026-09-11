import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Save } from "lucide-react";
import { useNavigate, useParams } from "react-router";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/layout/Layout";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { CUSTOMER_STATUS_LABELS } from "@/data/seed-data";
import { useRepository } from "@/data/repository-context";
import type { Customer, CustomerStatus } from "@/domain/types";

/** Form values produced by {@link customerSchema} (id is preserved on submit). */
type CustomerFormValues = z.infer<typeof customerSchema>;

/**
 * Edit-customer screen.
 *
 * Loads the customer by id through the asynchronous {@link HiveRepository}
 * (skeleton while loading), pre-fills the form, and on submit persists the
 * changes through the repository's `updateCustomer` before navigating back to
 * the customer's profile. The id is preserved from the route so edits never
 * clobber a different record.
 */
export function EditCustomerPage() {
  const { customerId = "" } = useParams<{ customerId: string }>();
  const repo = useRepository();
  const navigate = useNavigate();
  // `undefined` means still loading; `null` means the customer does not exist.
  const [customer, setCustomer] = useState<Customer | null | undefined>(
    undefined
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      // `undefined` means still loading; `null` means the customer does not
      // exist. Normalize the repository's `undefined` miss to `null` so the
      // state change actually triggers a re-render into the not-found state.
      setCustomer((await repo.getCustomer(customerId)) ?? null);
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Could not load customer."
      );
    }
  }, [repo, customerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const form = useForm<CustomerFormValues>({
    resolver: zodResolver(customerSchema),
    values: customer ? {
      name: customer.name ?? "",
      domain: customer.domain ?? "",
      contact: customer.contact ?? "",
      email: customer.email ?? "",
      status: customer.status ?? "evaluation",
      notes: customer.notes ?? "",
    } : undefined,
    defaultValues: {
      name: "",
      domain: "",
      contact: "",
      email: "",
      status: "evaluation",
      notes: "",
    },
  });

  if (loadError) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <div>
          <h1 className="text-2xl font-semibold">Unable to load customer</h1>
          <p className="text-muted-foreground mt-1 max-w-sm text-sm">
            {loadError}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load()}
          data-testid="retry-edit-customer"
        >
          Retry
        </Button>
      </div>
    );
  }

  if (customer === undefined) {
    return (
      <div className="flex flex-col gap-6" data-testid="edit-customer-loading">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-8 w-28" />
        </div>
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
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

  const onSubmit = async (values: CustomerFormValues) => {
    try {
      const updated = await repo.updateCustomer(customer.id, {
        ...values,
        id: customer.id,
      });
      toast.success(`Customer "${updated.name}" updated`);
      navigate(`/customers/${updated.id}`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not update customer.";
      toast.error(message);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <PageHeader
        title={`Edit ${customer.name}`}
        id="edit-customer-page-title"
        description="Update the account details for this customer. Changes are saved immediately."
      >
        <Button variant="ghost" size="sm" asChild>
          <a href={`/customers/${customer.id}`} data-testid="back-to-profile">
            <ArrowLeft className="size-4" />
            Back to profile
          </a>
        </Button>
      </PageHeader>

      <Card data-testid="edit-customer-card">
        <CardHeader>
          <CardTitle>Account details</CardTitle>
          <CardDescription>Fields marked with an asterisk are required.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form
              className="flex flex-col gap-5"
              onSubmit={form.handleSubmit(onSubmit, (errs) => console.log('EDIT VALIDATION ERRORS:', errs))}
              noValidate
            >
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Company name *</FormLabel>
                    <FormControl>
                      <Input placeholder="Acme Analytics" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid gap-5 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="domain"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email domain *</FormLabel>
                      <FormControl>
                        <Input placeholder="acme.com" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="status-trigger">
                            <SelectValue placeholder="Select a status" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {(
                            Object.keys(CUSTOMER_STATUS_LABELS) as CustomerStatus[]
                          ).map((status) => (
                            <SelectItem key={status} value={status}>
                              {CUSTOMER_STATUS_LABELS[status]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="contact"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact name *</FormLabel>
                      <FormControl>
                        <Input placeholder="Jane Doe" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact email *</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="jane@acme.com" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea
                        className="min-h-[80px] resize-y"
                        placeholder="Optional context for the operator team…"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Free-form operator notes. Leave blank if not applicable.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="border-border flex items-center justify-end gap-2 border-t pt-4">
                <Button type="button" variant="ghost" asChild>
                  <a href={`/customers/${customer.id}`}>Cancel</a>
                </Button>
                <Button type="submit" data-testid="submit-customer">
                  <Save className="size-4" />
                  Save changes
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}

const customerSchema = z.object({
  name: z.string().min(2, "Company name must be at least 2 characters."),
  domain: z
    .string()
    .min(1, "Email domain is required.")
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, "Enter a valid email domain."),
  contact: z.string().min(2, "Contact name must be at least 2 characters."),
  email: z
    .string()
    .min(1, "Email is required.")
    .email("Enter a valid email address."),
  status: z.enum(["evaluation", "active", "paused", "churned", "archived"]),
  notes: z.string().max(2000, "Notes must be under 2000 characters."),
});