import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { AppSidebar } from "@/components/layout/Sidebar";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

interface LayoutProps {
  children: ReactNode;
  className?: string;
}

/**
 * App chrome: collapsible sidebar (off-canvas drawer on desktop, sheet on
 * mobile) + scrollable main content. The `SidebarTrigger` in the top bar lets
 * operators collapse/expand the sidebar from anywhere.
 */
export function Layout({ children, className }: LayoutProps) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <Separator
            orientation="vertical"
            className="mr-2 data-[orientation=vertical]:h-4"
          />
        </header>
        <main className={cn("flex min-w-0 flex-1 flex-col bg-background", className)}>
          <div className="flex w-full max-w-[1440px] flex-1 flex-col px-6 py-8 md:px-10 lg:px-12">
            {children}
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
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
