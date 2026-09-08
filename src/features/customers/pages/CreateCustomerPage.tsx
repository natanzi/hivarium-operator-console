import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, UserPlus } from "lucide-react";
import { useNavigate } from "react-router";
import { useMemo } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { CUSTOMER_STATUS_LABELS } from "@/data/seed-data";
import { useRepository } from "@/data/repository-context";
import { makeCustomerId } from "@/lib/format";
import type { CustomerStatus } from "@/domain/types";

/** Form values produced by {@link customerSchema} (id is derived on submit). */
type CustomerFormValues = z.infer<typeof customerSchema>;

/**
 * Create-customer screen.
 *
 * A small validated form. Submitting writes a new customer through the
 * repository and navigates to the freshly-created customer's profile. The
 * generated id is derived from the company name, so a duplicate name surfaces
 * a clear error rather than clobbering an existing record.
 */
export function CreateCustomerPage() {
  const repo = useRepository();
  const navigate = useNavigate();

  const form = useForm<CustomerFormValues>({
    resolver: zodResolver(customerSchema),
    defaultValues: {
      name: "",
      domain: "",
      contact: "",
      email: "",
      status: "evaluation",
      notes: "",
    },
  });

  const name = form.watch("name");

  const submitId = useMemo(
    () => (name.trim().length > 0 ? makeCustomerId(name) : ""),
    [name]
  );
  const duplicateId =
    submitId.length > 0 && repo.getCustomer(submitId) !== undefined;

  function onSubmit(values: CustomerFormValues) {
    const id = makeCustomerId(values.name);
    try {
      const created = repo.createCustomer({ ...values, id });
      toast.success(`Customer "${created.name}" created`);
      navigate(`/customers/${created.id}`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not create customer.";
      toast.error(message);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <PageHeader
        title="New customer"
        id="create-customer-page-title"
        description="Onboard a new account to Hivarium. Subscriptions and entitlements are managed separately."
      >
        <Button variant="ghost" size="sm" asChild>
          <a href="/customers" data-testid="back-to-customers">
            <ArrowLeft className="size-4" />
            Back to customers
          </a>
        </Button>
      </PageHeader>

      <Card data-testid="create-customer-card">
        <CardHeader>
          <CardTitle>Account details</CardTitle>
          <CardDescription>Fields marked with an asterisk are required.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form
              className="flex flex-col gap-5"
              onSubmit={form.handleSubmit(onSubmit)}
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

              {duplicateId ? (
                <p
                  className="text-destructive border-destructive/30 bg-destructive/10 rounded-md border px-3 py-2 text-sm"
                  data-testid="duplicate-note"
                >
                  A customer with the derived id <code>{submitId}</code> already
                  exists. Use a different company name.
                </p>
              ) : null}

              <div className="border-border flex items-center justify-end gap-2 border-t pt-4">
                <Button type="button" variant="ghost" asChild>
                  <a href="/customers">Cancel</a>
                </Button>
                <Button
                  type="submit"
                  data-testid="submit-customer"
                  disabled={duplicateId}
                >
                  <UserPlus className="size-4" />
                  Create customer
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
  status: z.enum(["evaluation", "active", "paused", "churned"]),
  notes: z.string().max(2000, "Notes must be under 2000 characters."),
});
