"use client";

import type { ReactNode, RefObject } from "react";
import type { GroupImperativeHandle } from "react-resizable-panels";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import {
  applyComposerHorizontalLayoutToPrefs,
  applyComposerVerticalLayoutToPrefs,
  buildComposerHorizontalLayout,
  buildComposerVerticalLayout,
  type ComposerWorkspacePrefs,
} from "@/lib/composer/core/workspace-prefs";

interface ComposerWorkspaceShellProps {
  prefs: ComposerWorkspacePrefs;
  onPrefsChange: (
    updater:
      | Partial<ComposerWorkspacePrefs>
      | ((previous: ComposerWorkspacePrefs) => ComposerWorkspacePrefs)
  ) => void;
  horizontalGroupRef: RefObject<GroupImperativeHandle | null>;
  leftPanel: ReactNode;
  viewerPanel: ReactNode;
  timelinePanel: ReactNode;
  inspectorPanel: ReactNode;
}

export function ComposerWorkspaceShell({
  prefs,
  onPrefsChange,
  horizontalGroupRef,
  leftPanel,
  viewerPanel,
  timelinePanel,
  inspectorPanel,
}: ComposerWorkspaceShellProps) {
  const horizontalLayout = buildComposerHorizontalLayout(prefs);
  const verticalLayout = buildComposerVerticalLayout(prefs);

  return (
    <div className="hidden min-h-0 flex-1 flex-col lg:flex">
      <ResizablePanelGroup
        id="composer-workspace-horizontal"
        groupRef={horizontalGroupRef}
        orientation="horizontal"
        className="min-h-0"
        defaultLayout={horizontalLayout}
        onLayoutChanged={(layout) =>
          onPrefsChange((previous) => applyComposerHorizontalLayoutToPrefs(layout, previous))
        }
      >
        <ResizablePanel
          id="composer-bin"
          className="min-h-0 h-full"
          minSize="14%"
          maxSize="28%"
          collapsible
          collapsedSize={0}
        >
          {leftPanel}
        </ResizablePanel>

        <ResizableHandle id="composer-handle-left" withHandle />

        <ResizablePanel
          id="composer-center"
          className="min-h-0 h-full"
          minSize="42%"
        >
          <ResizablePanelGroup
            id="composer-workspace-vertical"
            orientation="vertical"
            className="min-h-0"
            defaultLayout={verticalLayout}
            onLayoutChanged={(layout) =>
              onPrefsChange((previous) => applyComposerVerticalLayoutToPrefs(layout, previous))
            }
          >
            <ResizablePanel
              id="composer-viewer"
              className="min-h-0 h-full"
              minSize="26%"
            >
              {viewerPanel}
            </ResizablePanel>

            <ResizableHandle id="composer-handle-center" withHandle />

            <ResizablePanel
              id="composer-timeline"
              className="min-h-0 h-full"
              minSize="24%"
            >
              {timelinePanel}
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>

        <ResizableHandle id="composer-handle-right" withHandle />

        <ResizablePanel
          id="composer-inspector"
          className="min-h-0 h-full"
          minSize="16%"
          maxSize="30%"
          collapsible
          collapsedSize={0}
        >
          {inspectorPanel}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
