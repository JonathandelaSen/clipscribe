"use client"

import * as React from "react"
import { GripVertical } from "lucide-react"
import * as ResizablePrimitive from "react-resizable-panels"

import { cn } from "@/lib/utils"

function ResizablePanelGroup({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Group>) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-group"
      orientation={orientation}
      className={cn(
        "flex h-full min-h-0 min-w-0 w-full overflow-hidden",
        orientation === "vertical" ? "flex-col" : "flex-row",
        className
      )}
      {...props}
    />
  )
}

const ResizablePanel = ResizablePrimitive.Panel

function ResizableHandle({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Separator> & {
  withHandle?: boolean
}) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        "relative flex shrink-0 bg-transparent transition-colors after:absolute after:inset-0 after:bg-[color:var(--composer-border)]/60 after:opacity-0 after:transition-opacity hover:after:opacity-100 aria-[orientation=vertical]:h-2 aria-[orientation=vertical]:w-full aria-[orientation=horizontal]:h-full aria-[orientation=horizontal]:w-2",
        className
      )}
      {...props}
    >
      {withHandle ? (
        <div className="z-10 flex h-full w-full items-center justify-center">
          <div className="flex rounded-md border border-[color:var(--composer-border)] bg-[color:var(--composer-raised)] px-1 py-1 shadow-sm">
            <GripVertical className="size-3.5 text-[color:var(--composer-muted)]" />
          </div>
        </div>
      ) : null}
    </ResizablePrimitive.Separator>
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
