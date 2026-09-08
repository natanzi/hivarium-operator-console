import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Sidebar } from "@/components/layout/Sidebar";

interface LayoutProps {
  children: ReactNode;
  className?: string;
}

/**
 * App chrome: fixed sidebar + scrollable main content.
 */
export function Layout({ children, className }: LayoutProps) {
  return (
    <div className="bg-background flex min-h-svh w-full">
      <Sidebar />
      <main className={cn("flex-1 min-w-0", className)}>
        <div className="mx-auto flex min-h-svh w-full max-w-6xl flex-col px-6 py-8 md:px-10">
          {children}
        </div>
      </main>
    </div>
  );
}

/**
 * Standard page header used by every Phase 1 screen.
 */
export function PageHeader({
  title,
  description,
  children,
  id,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
  id?: string;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-1.5">
        <h1
          id={id}
          data-testid="page-title"
          className="tracking-tight text-2xl font-semibold"
        >
          {title}
        </h1>
        {description ? (
          <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
            {description}
          </p>
        ) : null}
      </div>
      {children ? <div className="flex items-center gap-2">{children}</div> : null}
    </header>
  );
}
