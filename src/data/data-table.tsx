import {
  createColumnHelper,
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type Row,
} from "@tanstack/react-table";
import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface DataTableColumn<TData> {
  id: string;
  header: string;
  cell: (row: TData) => ReactNode;
  sortable?: boolean;
  sortFn?: (a: TData, b: TData) => number;
  className?: string;
}

export interface DataTableProps<TData> {
  columns: DataTableColumn<TData>[];
  data: TData[];
  getRowId: (row: TData) => string;
  /** If set, rows become click-through to the provided path (full nav). */
  rowLink?: (row: TData) => string;
  rowTestId?: (row: TData) => string;
  emptyMessage?: string;
  pageSize?: number;
  ariaLabel?: string;
  /**
   * When provided, the table delegates all data control to the consumer
   * (sorting, filtering, pagination). This is what the Phase 1 screens use:
   * the screen component owns the derived data and passes it in.
   * When omitted, internal sorting + pagination are applied to `data`.
   */
  managedByConsumer?: {
    sorting: SortingState;
    data: TData[];
    pageIndex: number;
    pageCount: number;
    onSortToggle: (columnId: string) => void;
    onPrevPage: () => void;
    onNextPage: () => void;
  };
}

/**
 * Minimal TanStack-backed data table with sorting and pagination.
 *
 * The component is intentionally small: it renders a single `<table>` with
 * shadcn primitives and delegates sorting / pagination to TanStack. Screens
 * can either (a) let the table manage sorting, or (b) pass
 * `managedByConsumer` to drive both sorting and pagination from screen state
 * so that the visible columns always line up with the filtered data.
 */
export function DataTable<TData>({
  columns,
  data,
  getRowId,
  rowLink,
  rowTestId,
  emptyMessage = "No records to display.",
  pageSize = 10,
  ariaLabel,
  managedByConsumer,
}: DataTableProps<TData>) {
  const [internalSorting, setInternalSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data: managedByConsumer ? managedByConsumer.data : data,
    columns: buildColumns<TData>(columns, managedByConsumer) as ColumnDef<TData>[],
    getRowId,
    manualSorting: true,
    state: {
      sorting: managedByConsumer ? managedByConsumer.sorting : internalSorting,
    },
    onSortingChange: (updater) => {
      const next =
        typeof updater === "function"
          ? (updater as (s: SortingState) => SortingState)(managedByConsumer ? managedByConsumer.sorting : internalSorting)
          : (updater as SortingState);
      if (managedByConsumer) {
        const first = (next ?? []).find(Boolean);
        if (first) managedByConsumer.onSortToggle(first.id);
      } else {
        setInternalSorting(next ?? []);
      }
    },
    manualPagination: true,
    pageCount: managedByConsumer ? managedByConsumer.pageCount : -1,
    getCoreRowModel: getCoreRowModel(),
    initialState: { pagination: { pageIndex: 0, pageSize } },
  });

  return (
    <div className="space-y-3">
      <div className="rounded-xl border bg-card shadow-sm">
        <Table>
          {ariaLabel ? (
            <caption className="sr-only">{ariaLabel}</caption>
          ) : null}
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((header) => {
                  const column = header.column;
                  const isSorted = column.getIsSorted();
                  const sortable = column.getCanSort();
                  return (
                    <TableHead key={header.id} className="px-3 py-2.5">
                      <button
                        type="button"
                        onClick={() => column.toggleSorting()}
                        disabled={!sortable}
                        aria-sort={
                          isSorted === "asc"
                            ? "ascending"
                            : isSorted === "desc"
                              ? "descending"
                              : undefined
                        }
                        className={cn(
                          "inline-flex items-center gap-1.5 text-left text-sm font-semibold tracking-wider uppercase",
                          !sortable && "cursor-default"
                        )}
                        data-testid={`header-${column.id}`}
                      >
                        <span>
                          {typeof column.columnDef.header === "string"
                            ? column.columnDef.header
                            : flexRender(
                                column.columnDef.header,
                                header.getContext()
                              )}
                        </span>
                        {sortable ? (
                          <SortGlyph
                            state={isSorted}
                          />
                        ) : null}
                      </button>
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="text-muted-foreground h-32 border-0 text-center"
                  data-testid="empty-row"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <DataRow
                  key={row.id}
                  row={row}
                  link={rowLink ? rowLink(row.original) : undefined}
                  testId={rowTestId ? rowTestId(row.original) : undefined}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <PaginationFooter
        totalCount={
          managedByConsumer ? managedByConsumer.data.length : data.length
        }
        onPrev={
          managedByConsumer ? managedByConsumer.onPrevPage : () => table.previousPage()
        }
        onNext={
          managedByConsumer ? managedByConsumer.onNextPage : () => table.nextPage()
        }
        page={
          managedByConsumer
            ? managedByConsumer.pageIndex
            : table.getState().pagination.pageIndex
        }
        pageCount={
          managedByConsumer
            ? managedByConsumer.pageCount
            : table.getPageCount()
        }
        canPrev={managedByConsumer ? table.getCanPreviousPage() : true}
        canNext={managedByConsumer ? table.getCanNextPage() : true}
        itemsFrom={
          managedByConsumer
            ? Math.min(
                managedByConsumer.pageIndex * pageSize + 1,
                managedByConsumer.data.length
              )
            : table.getRowModel().rows.length === 0
              ? 0
              : table.getState().pagination.pageIndex * pageSize + 1
        }
        itemsTo={
          managedByConsumer
            ? Math.min(
                (managedByConsumer.pageIndex + 1) * pageSize,
                managedByConsumer.data.length
              )
            : table.getRowModel().rows.length
        }
      />
    </div>
  );
}

function SortGlyph({ state }: { state?: false | "asc" | "desc" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "text-muted-foreground",
        state && "text-foreground"
      )}
    >
      {state === "asc" ? "↑" : state === "desc" ? "↓" : "↕"}
    </span>
  );
}

function buildColumns<TData>(
  columns: DataTableColumn<TData>[],
  managed: DataTableProps<TData>["managedByConsumer"]
): ColumnDef<TData>[] {
  // `managed` is part of the signature (and previously drove the `sortingFn`)
  // but no longer affects column construction: ordering is applied upstream in
  // both modes (see `manualSorting` on the `useReactTable` call below).
  void managed;
  const helper = createColumnHelper<TData>();
  return columns.map(
    (c) =>
      helper.display({
        id: c.id,
        header: c.header,
        cell: ({ row }: { row: Row<TData> }) => c.cell(row.original),
        // The header button is only interactive for marked-sortable columns.
        // Actual ordering is applied upstream: in "managed by consumer" mode the
        // screen re-sorts and re-supplies `data`, and in internal mode the
        // table runs with `manualSorting`, so TanStack never re-orders rows.
        enableSorting: c.sortable ?? false,
      })
  );
}

function DataRow<TData>({
  row,
  link,
  testId,
}: {
  row: Row<TData>;
  link?: string;
  testId?: string;
}) {
  return (
    <TableRow
      data-row-id={row.id}
      data-testid={testId}
      className={cn(link && "cursor-pointer")}
      onClick={link ? () => window.location.assign(link) : undefined}
    >
      {row.getVisibleCells().map((cell) => (
        <TableCell
          key={cell.id}
          className={cn("px-3 py-3")}
        >
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </TableCell>
      ))}
    </TableRow>
  );
}

function PaginationFooter({
  totalCount,
  onPrev,
  onNext,
  page,
  pageCount,
  canPrev,
  canNext,
  itemsFrom,
  itemsTo,
}: {
  totalCount: number;
  onPrev: () => void;
  onNext: () => void;
  page: number;
  pageCount: number;
  canPrev: boolean;
  canNext: boolean;
  itemsFrom: number;
  itemsTo: number;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <p className="text-muted-foreground">
        Showing{" "}
        <span className="tabular-nums font-medium text-foreground">{itemsFrom}</span>–
        <span className="tabular-nums font-medium text-foreground">{itemsTo}</span>{" "}
        of{" "}
        <span className="tabular-nums font-medium text-foreground">{totalCount}</span>
      </p>
      <div className="flex items-center gap-1">
        <PagerButton label="Previous page" disabled={!canPrev} onClick={onPrev}>
          ←
        </PagerButton>
        <span className="text-muted-foreground tabular-nums px-2 text-sm">
          Page <span className="text-foreground">{page + 1}</span> of{" "}
          {Math.max(1, pageCount)}
        </span>
        <PagerButton label="Next page" disabled={!canNext} onClick={onNext}>
          →
        </PagerButton>
      </div>
    </div>
  );
}

function PagerButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "text-foreground size-8 rounded-md border bg-card shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground",
        "disabled:pointer-events-none disabled:opacity-40"
      )}
    >
      {children}
    </button>
  );
}
