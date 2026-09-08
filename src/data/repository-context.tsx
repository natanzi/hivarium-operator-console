/**
 * React context wiring the repository through the component tree.
 */

import { createContext, useContext } from "react";

import type { HiveRepository } from "@/data/local-storage-repository";
import { repository } from "@/data/local-storage-repository";

const RepositoryContext = createContext<HiveRepository | null>(null);

export function RepositoryProvider(ctx: {
  repository: HiveRepository;
  children: React.ReactNode;
}) {
  return (
    <RepositoryContext.Provider value={ctx.repository}>
      {ctx.children}
    </RepositoryContext.Provider>
  );
}

export function useRepository(): HiveRepository {
  const ctx = useContext(RepositoryContext);
  if (!ctx) return repository;
  return ctx;
}
