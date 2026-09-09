# Phase 1: Customer Commercial Control - Pattern Map

**Mapped:** 2026-09-09
**Files analyzed:** 15 likely new/modified files
**Analogs found:** 14 / 15

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/domain/types.ts` | model | transform / CRUD contract | same file, existing `Customer`, `Subscription`, `AgentLicense`, `DataStore` | exact |
| `src/domain/commercial-rules.ts` | service/utility | deterministic transform | `src/domain/types.ts:138-163` normalization function | role-match |
| `src/data/local-storage-repository.ts` | store/repository | synchronous CRUD + migration | same file, `read`, `write`, customer CRUD and cascade delete | exact |
| `src/data/seed-data.ts` | fixture/config | batch construction | same file, `CustomerSeed` and `buildSeedStore` | exact |
| `src/features/customers/components/CommercialArrangementSheet.tsx` | component/form | request-response mutation | `CreateCustomerPage.tsx` + `components/ui/sheet.tsx` | role-match |
| `src/features/customers/components/AgentAccessSheet.tsx` | component/form | searchable request-response mutation | `CreateCustomerPage.tsx` + `AgentCatalogPage.tsx` + `components/ui/sheet.tsx` | partial |
| `src/features/customers/components/ActivityTimeline.tsx` | component | projection/collection | `CustomerProfilePage.tsx` detail/table panels | partial |
| `src/features/customers/pages/CustomerProfilePage.tsx` | route/component | aggregate read + CRUD actions | same file | exact |
| `src/features/agents/pages/AgentCatalogPage.tsx` | route/component | collection read/navigation | same file | exact |
| `src/features/agents/pages/AgentDetailPage.tsx` | route/component | aggregate read / reverse lookup | `CustomerProfilePage.tsx` | role-match |
| `src/app/router.tsx` | route/config | request-response navigation | same file | exact |
| `src/data/local-storage-repository.test.ts` | test | CRUD/migration contract | `CustomersPage.test.tsx` + `createInMemoryRepository` | role-match |
| `src/domain/commercial-rules.test.ts` | test | pure transform | no pure-domain test exists | no analog |
| `src/features/customers/pages/CustomerProfilePage.test.tsx` | component test | aggregate read + interactions | same file | exact |
| `src/features/agents/pages/AgentCatalogPage.test.tsx` / `AgentDetailPage.test.tsx` | component test | collection/detail navigation | existing catalog/profile tests | exact/role-match |
| `e2e/console.spec.ts` | browser test | end-to-end request-response | same file | exact |

The file names for new feature components are planner-level recommendations, not a requirement to create parallel abstractions. Keep them under the owning feature and do not introduce a second repository or page-only domain model.

## Pattern Assignments

### `src/domain/types.ts` and `src/domain/commercial-rules.ts`

**Analog:** `src/domain/types.ts`

**Serializable union/interface pattern** (`src/domain/types.ts:9-32`, `34-57`, `97-129`):

```ts
export type CustomerStatus = "evaluation" | "active" | "paused" | "churned";

export interface Customer {
  id: string;
  name: string;
  // ...plain JSON-compatible fields...
  createdAt: string;
}

export interface DataStore {
  customers: Customer[];
  subscriptions: Subscription[];
  featureEntitlements: FeatureEntitlement[];
  agentProducts: AgentProduct[];
  agentLicenses: AgentLicense[];
}
```

Copy this shape for discriminated commercial records (`monthly`, `prepaid`, `annual`) and explicit agent-access/activity records. Keep IDs and ISO timestamps as strings, nullable dates explicit, and history as stored records—not labels inferred by the page.

**Pure normalization pattern** (`src/domain/types.ts:138-163`):

```ts
const LEGACY_STATUS_ALIASES: Record<string, CustomerStatus> = { /* ... */ };

export function normalizeCustomerStatus(value: unknown): CustomerStatus {
  if (typeof value !== "string") return "evaluation";
  return LEGACY_STATUS_ALIASES[value] ?? "evaluation";
}
```

Use a separate pure rules module for effective-date ordering, selecting exactly one current arrangement, validating ranges/money, applying immediate or scheduled transitions, and producing automatic access-revocation plus activity records. Pass an explicit effective timestamp to rules; do not call timers or infer behavior from display labels.

### `src/data/local-storage-repository.ts`

**Analog:** the existing repository contract and implementation.

**Imports and central contract** (`src/data/local-storage-repository.ts:1-53`):

```ts
import type { AgentLicense, AgentProduct, DataStore, Customer } from "@/domain/types";
import { buildSeedStore } from "@/data/seed-data";

export interface HiveRepository {
  listCustomers(): Customer[];
  getCustomer(id: string): Customer | undefined;
  createCustomer(input: CustomerInput): Customer;
  // relationship and catalog methods remain on this boundary
}
```

Extend `HiveRepository` with arrangement, access, activity, and reverse customer-access queries/mutations. Pages must continue to call `useRepository()`; no component may import localStorage or mutate arrays directly.

**Backward-compatible migration/defaulting** (`src/data/local-storage-repository.ts:86-126`):

```ts
const parsed = JSON.parse(raw) as Partial<DataStore>;
const rawCustomers = (parsed.customers ?? []) as Customer[];
const customers = rawCustomers.map((c) => ({
  ...c,
  status: normalizeCustomerStatus(c.status),
}));

return {
  customers,
  subscriptions: parsed.subscriptions ?? [],
  featureEntitlements: parsed.featureEntitlements ?? [],
  agentProducts: parsed.agentProducts?.length ? parsed.agentProducts : buildSeedStore().agentProducts,
  agentLicenses: parsed.agentLicenses ?? [],
};
```

Apply the same load-time pattern to missing Phase 1 collections and legacy subscription/license records: parse as partial, normalize/default without dropping customers, re-persist only when migration changes data, and fall back to deterministic seed data only when JSON is corrupt. Prefer an explicit store schema version/migration function over scattered `?? []` once new collections are added.

**Atomic immutable write** (`src/data/local-storage-repository.ts:156-197`):

```ts
const store = this.read();
this.write({
  ...store,
  customers: store.customers.map((c) => (c.id === id ? updated : c)),
});
```

Commercial replacement, termination, and agent revoke must calculate every affected collection first and persist one complete store write. Follow the existing cascade-delete precedent (`181-197`), but append immutable arrangement/access/activity history instead of deleting it. Termination must revoke current grants and add linked audit events in that same write.

**Test adapter** (`src/data/local-storage-repository.ts:224-250`):

```ts
export function createInMemoryRepository(seedWith = true) {
  const map = new Map<string, string>();
  // StorageLike implementation
  return { repository: new LocalStorageRepository(storage), storage };
}
```

Reuse this adapter for migration, transition, history, and automatic-revocation tests. Add a way for tests to initialize raw legacy JSON without touching browser localStorage.

### `src/data/seed-data.ts`

**Analog:** existing deterministic seed aggregation (`src/data/seed-data.ts:12-38` and current `buildSeedStore`).

```ts
export interface CustomerSeed {
  customer: Customer;
  subscriptions: Subscription[];
  featureEntitlements: FeatureEntitlement[];
  agentLicenses: AgentLicense[];
}

export const CUSTOMER_STATUS_LABELS: Record<CustomerStatus, string> = {
  evaluation: "Evaluation",
  active: "Active",
  paused: "Paused",
  churned: "Archived",
};
```

Extend each fictional customer seed with deterministic arrangement/access/activity records. Include monthly, prepaid, annual, scheduled-change, no-arrangement, active-grant, scheduled-revocation, and historical-revocation examples. Keep presentation labels/maps centralized, but business behavior belongs in domain rules/repository—not seed data.

### `CommercialArrangementSheet.tsx` and `AgentAccessSheet.tsx`

**Analogs:** `src/features/customers/pages/CreateCustomerPage.tsx`, `src/components/ui/sheet.tsx`, and `src/features/agents/pages/AgentCatalogPage.tsx`.

**Form imports/schema/inference** (`CreateCustomerPage.tsx:1-42`, `256-269`):

```ts
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

type CustomerFormValues = z.infer<typeof customerSchema>;

const customerSchema = z.object({
  name: z.string().min(2, "Company name must be at least 2 characters."),
  email: z.string().min(1, "Email is required.").email("Enter a valid email address."),
});
```

Define schemas outside components, infer form types, use discriminated unions/super-refinement so only selected-model fields are required, and enforce non-negative USD plus ordered dates. Repository methods remain the final invariant boundary; Zod is UI validation, not the only business validation.

**Form composition and mutation feedback** (`CreateCustomerPage.tsx:52-88`, `111-128`, `235-249`):

```tsx
const form = useForm<CustomerFormValues>({
  resolver: zodResolver(customerSchema),
  defaultValues: { /* explicit values */ },
});

function onSubmit(values: CustomerFormValues) {
  try {
    const created = repo.createCustomer(/* ... */);
    toast.success(`Customer "${created.name}" created`);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Could not create customer.");
  }
}

<Form {...form}>
  <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
    <FormField control={form.control} name="name" render={({ field }) => (
      <FormItem><FormLabel>Company name *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
    )} />
  </form>
</Form>
```

Copy labelled fields, inline `FormMessage`, try/catch toast feedback, explicit default values, and disabled/pending submit behavior. Add dirty-close handling around the controlled sheet state.

**Sheet primitive** (`src/components/ui/sheet.tsx:9-28`, `47-81`, `84-127`):

```tsx
<Sheet open={open} onOpenChange={handleOpenChange}>
  <SheetTrigger asChild>{trigger}</SheetTrigger>
  <SheetContent side="right" className="w-full sm:max-w-[520px]">
    <SheetHeader><SheetTitle>{title}</SheetTitle><SheetDescription>{description}</SheetDescription></SheetHeader>
    {/* scrollable form */}
    <SheetFooter>{actions}</SheetFooter>
  </SheetContent>
</Sheet>
```

The primitive already supplies portal, focus containment, overlay, close affordance, and right-side animation. Override width for the approved 520px desktop/full-width mobile contract. Respect reduced motion. No existing product sheet demonstrates dirty-form confirmation, so implement controlled close plus an `AlertDialog` rather than inventing a custom overlay.

**Searchable catalog projection** (`AgentCatalogPage.tsx:23-49`, `54-77`): read products once through `useRepository`, render human name/category/version/description, and preserve stable product ID separately. Disable already-active/scheduled items with explanatory text rather than filtering them out.

### Confirmation dialogs and toasts

**Analog:** `CustomersPage.tsx:332-383`.

```tsx
const handleDelete = () => {
  repository.deleteCustomer(customer.id);
  onDeleted();
  toast.success("Customer deleted", { description: `${customer.name} ...` });
};

<AlertDialog>
  <AlertDialogTrigger asChild><button type="button">Delete</button></AlertDialogTrigger>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Delete {customer.name}?</AlertDialogTitle>
      <AlertDialogDescription>/* explicit consequence */</AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction onClick={handleDelete} className="bg-destructive ...">Delete customer</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

Copy the named subject, explicit consequence, safe cancel, destructive action, immediate parent refresh, and success toast. For arrangement termination, include the exact active-grant count and call one repository transaction. For revoke, retain the record and confirm whether action is immediate or scheduled.

### `CustomerProfilePage.tsx` and `ActivityTimeline.tsx`

**Analog:** current `CustomerProfilePage.tsx`.

**Aggregate query pattern** (`CustomerProfilePage.tsx:42-65`):

```tsx
const customer = useMemo(() => repo.getCustomer(customerId), [repo, customerId]);
const products = useMemo(
  () => new Map(repo.listAgentProducts().map((p) => [p.id, p])),
  [repo]
);
```

Read all profile relationships from repository methods, create product/customer lookup maps once, and compute current/scheduled/history projections in `useMemo`. After a mutation, use a small revision counter or re-read state so the summary, tab, and counts update together.

**Existing empty/error state** (`CustomerProfilePage.tsx:67-83`): preserve the dedicated missing-customer state and add exact UI-SPEC empty/error copy inside each new tab.

**Do not copy the custom tabs implementation unchanged.** The local `ProfileTabs` (`CustomerProfilePage.tsx:266-321`) has correct `tablist`, `tab`, `tabpanel`, `aria-selected`, and `aria-controls`, but it lacks arrow-key and Home/End behavior. Use the existing Radix wrapper instead (`src/components/ui/tabs.tsx:8-66`):

```tsx
<Tabs value={active} onValueChange={setActive}>
  <TabsList aria-label="Customer sections">
    <TabsTrigger value="overview">Overview</TabsTrigger>
    <TabsTrigger value="commercial">Commercial</TabsTrigger>
    <TabsTrigger value="access">Agent Access</TabsTrigger>
    <TabsTrigger value="activity">Activity</TabsTrigger>
  </TabsList>
  <TabsContent value="overview">...</TabsContent>
</Tabs>
```

Keep the existing document/card language (`CustomerProfilePage.tsx:178-264`) and `DataTable` patterns for history. Activity must be a semantic ordered list/timeline, newest first, with automatic revocations as separate events linked by a cause/event ID; do not use a chart.

### `AgentCatalogPage.tsx`, `AgentDetailPage.tsx`, and router

**Catalog analog** (`AgentCatalogPage.tsx:23-77`): preserve read-only cards, empty state, product title/category/version/capability, and stable test IDs. Make the card/title a semantic link to `/agents/:agentProductId`; do not add catalog editing.

**Detail analog:** `CustomerProfilePage.tsx:42-83`, `92-175`. Resolve route ID with `useParams`, read `getAgentProduct`, query reverse current/scheduled customer access through repository, render a dedicated not-found state, and provide customer-profile links.

**Route registration** (`src/app/router.tsx:38-103`):

```tsx
{
  path: "/agents/:agentProductId",
  element: (
    <RepositoryProvider repository={repository}>
      {withLayout(<AgentDetailPage />)}
    </RepositoryProvider>
  ),
},
```

Follow the existing centralized route/provider/layout/toaster composition. Place detail after `/agents`; static and parameter routes do not conflict in React Router, but keep ordering readable.

## Test Pattern Assignments

### Repository and domain tests

**Analog:** `createInMemoryRepository` plus `CustomersPage.test.tsx:8-42`.

```ts
const { repository } = createInMemoryRepository();
const customer = repository.listCustomers().find(/* deterministic condition */)!;

repository.deleteCustomer(customer.id);

expect(repository.getCustomer(customer.id)).toBeUndefined();
expect(repository.getSubscriptions(customer.id)).toHaveLength(0);
```

Add repository-level tests for all three arrangement shapes, single-active invariant, immediate/scheduled replacement, prior-history preservation, legacy payload migration, grant duplicate prevention, immediate/scheduled revoke, termination cascade, linked activity records, and non-restoration after a new arrangement. Add table-driven pure rules tests for date boundaries and invalid money/date inputs.

### Component tests

**Analog:** `CustomerProfilePage.test.tsx:9-28`, `32-90` and `AgentCatalogPage.test.tsx:7-27`.

```tsx
const router = createMemoryRouter(
  [{ path: "/customers/:customerId", element: <CustomerProfilePage /> }],
  { initialEntries: [url.pathname] }
);

render(
  <RepositoryProvider repository={repository}>
    <RouterProvider router={router} />
  </RepositoryProvider>
);

const user = userEvent.setup();
await user.click(screen.getByTestId("tab-commercial"));
expect(screen.getByRole("tabpanel")).toHaveTextContent(/* current terms */);
```

Use a fresh in-memory repository per test instead of the shared singleton used by the old profile helper. Query headings, labels, buttons, tabs, and dialogs by accessible role/name first; reserve `data-testid` for stable product entities/records. Cover exact empty copy, partial `Not recorded`, zero/one/many labels, drawer validation, dirty-close confirmation, destructive confirmation, toast-visible mutation effects, and reverse agent-to-customer links.

### Browser tests

**Analog:** `e2e/console.spec.ts:3-64`.

Keep `page.goto`, role/label queries, and explicit visible-state assertions. Do **not** copy conditional assertions such as `if (await input.isVisible())`; required acceptance flows must fail when controls are absent. Isolate each scenario by resetting deterministic local data before use. Cover one complete flow for each commercial model, scheduled change, grant, scheduled/immediate revoke, termination auto-revoke, Activity evidence, and reverse relationship from agent detail.

## Shared Patterns

### Repository injection

**Source:** `src/data/repository-context.tsx:5-26`

Apply to all feature pages/components. Accept the repository through `RepositoryProvider`; call `useRepository()` inside the feature. Do not access storage from components.

### Error handling

**Source:** `CreateCustomerPage.tsx:77-87`

Repository methods throw descriptive `Error`s; UI catches them, retains form state, and shows `toast.error`. Business rule failures should use stable, human-readable errors and should not partially persist.

### Accessible overlays

**Source:** `components/ui/sheet.tsx:47-127`, `components/ui/alert-dialog.tsx:47-142`

Use Radix-owned portal/focus/escape behavior and semantic titles/descriptions. Never implement a hand-rolled fixed overlay. Return focus via controlled trigger/open state; block closing only while a mutation is committing.

### Status, labels, and visual tone

**Source:** `seed-data.ts:26-44`, `CustomerProfilePage.tsx:423-469`

Centralize status labels/classes, pair every color with text, use `tabular-nums` for dates/money/counts, keep IDs monospace and subordinate to human names, and retain warm card/border tokens rather than literal feature colors.

### Deterministic ordering

**Source:** `CustomersPage.tsx:58-70`, `83-99`

Compute filtered/joined projections with `useMemo`, sort explicitly, and construct lookup maps before rendering. Current first, scheduled second, history newest first; never depend on insertion order for user-visible history.

## No Analog Found

| File | Role | Data Flow | Reason / Planner Guidance |
|---|---|---|---|
| `src/domain/commercial-rules.test.ts` | test | pure transform | No pure-domain test exists. Use Vitest table-driven tests with explicit timestamps and no rendered UI. |

There is also no existing product-level dirty-sheet confirmation flow. Compose the existing controlled `Sheet` and `AlertDialog` primitives; do not use the unrelated Refine-generated forms/layouts.

## Anti-Patterns to Avoid

- Do not keep legacy `Subscription`/`AgentLicense` concepts visible alongside new commercial/access records as competing truths; migrate/default them at the repository boundary.
- Do not make the UI calculate active arrangement, access status, or auto-revocation independently from domain/repository rules.
- Do not mutate prepaid balance or calculate detailed usage/overage in Phase 1; those are Phase 2.
- Do not hard-delete arrangement/access/activity history.
- Do not use the custom current tab strip without adding full keyboard behavior; prefer existing Radix Tabs.
- Do not copy the E2E suite's conditional skip behavior.
- Do not introduce backend/API, async cache, chart library, or a second design system.

## Metadata

**Analog search scope:** `src/domain`, `src/data`, `src/features/customers`, `src/features/agents`, `src/components/ui`, `src/app`, `src/test`, `e2e`

**Primary files read:** 15 planning/source/test files plus 4 local UI primitives

**Pattern extraction date:** 2026-09-09
