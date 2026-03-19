"use client";

import { TooltipProvider } from "@/components/ui/tooltip";
import { BackgroundTaskProvider } from "@/components/tasks/BackgroundTaskProvider";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider>
      <BackgroundTaskProvider>{children}</BackgroundTaskProvider>
    </TooltipProvider>
  );
}
