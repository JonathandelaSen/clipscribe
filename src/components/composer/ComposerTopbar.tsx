"use client";

import Link from "next/link";
import {
  ArrowLeft,
  HardDriveDownload,
  Keyboard,
  LayoutPanelLeft,
  LayoutPanelTop,
  Loader2,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
} from "lucide-react";

import type { ComposerQuality, ComposerRatio } from "@/lib/composer/types";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type RatioOption = { value: ComposerRatio; label: string };
type QualityOption = { value: ComposerQuality; label: string; helper: string };

interface ComposerTopbarProps {
  projectName: string;
  onProjectNameChange: (value: string) => void;
  projectStatusLabel: string;
  exportRatio: ComposerRatio;
  exportQuality: ComposerQuality;
  ratioOptions: RatioOption[];
  qualityOptions: QualityOption[];
  onExportRatioChange: (value: ComposerRatio) => void;
  onExportQualityChange: (value: ComposerQuality) => void;
  onExport: () => void;
  canExport: boolean;
  isExporting: boolean;
  exportProgressPct: number;
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  onToggleLeftPanel: () => void;
  onToggleRightPanel: () => void;
  onOpenShortcuts: () => void;
  onNewDraft: () => void;
  onResetLayout: () => void;
}

export function ComposerTopbar({
  projectName,
  onProjectNameChange,
  projectStatusLabel,
  exportRatio,
  exportQuality,
  ratioOptions,
  qualityOptions,
  onExportRatioChange,
  onExportQualityChange,
  onExport,
  canExport,
  isExporting,
  exportProgressPct,
  leftPanelCollapsed,
  rightPanelCollapsed,
  onToggleLeftPanel,
  onToggleRightPanel,
  onOpenShortcuts,
  onNewDraft,
  onResetLayout,
}: ComposerTopbarProps) {
  return (
    <header className="flex h-16 items-center justify-between gap-4 border-b border-[color:var(--composer-border)] bg-[color:var(--composer-panel)] px-4 lg:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <Link
          href="/creator"
          className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-[color:var(--composer-muted)] transition hover:text-[color:var(--composer-text)]"
        >
          <ArrowLeft className="size-3.5" />
          Creator
        </Link>
        <div className="hidden h-6 w-px bg-[color:var(--composer-border)] md:block" />
        <div className="hidden items-center gap-2 md:flex">
          <div className="flex size-8 items-center justify-center rounded-md border border-[color:var(--composer-border)] bg-[color:var(--composer-raised)]">
            <LayoutPanelTop className="size-4 text-[color:var(--composer-accent)]" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.26em] text-[color:var(--composer-muted)]">
              Timeline Composer
            </div>
            <div className="text-sm font-medium text-[color:var(--composer-text)]">
              Workstation
            </div>
          </div>
        </div>
        <div className="min-w-[220px] max-w-[360px] flex-1">
          <Input
            value={projectName}
            onChange={(event) => onProjectNameChange(event.target.value)}
            placeholder="Untitled timeline"
            className="h-10 border-[color:var(--composer-border)] bg-[color:var(--composer-raised)] text-[color:var(--composer-text)] placeholder:text-[color:var(--composer-muted)]"
          />
        </div>
        <div className="hidden rounded-md border border-[color:var(--composer-border)] bg-[color:var(--composer-raised)] px-2.5 py-1.5 text-[11px] uppercase tracking-[0.22em] text-[color:var(--composer-muted)] xl:block">
          {projectStatusLabel}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          className="border border-[color:var(--composer-border)] bg-[color:var(--composer-raised)] text-[color:var(--composer-text)] hover:bg-[color:var(--composer-raised)]/80"
          onClick={onToggleLeftPanel}
          title={leftPanelCollapsed ? "Open project bin" : "Collapse project bin"}
        >
          <PanelLeft className={leftPanelCollapsed ? "opacity-40" : ""} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="border border-[color:var(--composer-border)] bg-[color:var(--composer-raised)] text-[color:var(--composer-text)] hover:bg-[color:var(--composer-raised)]/80"
          onClick={onToggleRightPanel}
          title={rightPanelCollapsed ? "Open inspector" : "Collapse inspector"}
        >
          <PanelRight className={rightPanelCollapsed ? "opacity-40" : ""} />
        </Button>

        <div className="hidden items-center gap-2 lg:flex">
          <Select value={exportRatio} onValueChange={(value) => onExportRatioChange(value as ComposerRatio)}>
            <SelectTrigger className="h-10 w-[148px] border-[color:var(--composer-border)] bg-[color:var(--composer-raised)] text-[color:var(--composer-text)]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-[color:var(--composer-border)] bg-[color:var(--composer-panel)] text-[color:var(--composer-text)]">
              {ratioOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={exportQuality} onValueChange={(value) => onExportQualityChange(value as ComposerQuality)}>
            <SelectTrigger className="h-10 w-[156px] border-[color:var(--composer-border)] bg-[color:var(--composer-raised)] text-[color:var(--composer-text)]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-[color:var(--composer-border)] bg-[color:var(--composer-panel)] text-[color:var(--composer-text)]">
              {qualityOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label} • {option.helper}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="border border-[color:var(--composer-border)] bg-[color:var(--composer-raised)] text-[color:var(--composer-text)] hover:bg-[color:var(--composer-raised)]/80"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Workspace</DropdownMenuLabel>
            <DropdownMenuItem onClick={onOpenShortcuts}>
              <Keyboard className="size-4" />
              Shortcuts
              <DropdownMenuShortcut>Space</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onResetLayout}>
              <LayoutPanelLeft className="size-4" />
              Reset layout
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onNewDraft}>
              <ArrowLeft className="size-4 rotate-180" />
              New draft
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          onClick={onExport}
          disabled={!canExport}
          className="h-10 border border-[#8f6a2b] bg-[color:var(--composer-accent)] px-4 text-black hover:bg-[#ffbc5c]"
        >
          {isExporting ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <HardDriveDownload className="mr-2 size-4" />
          )}
          {isExporting ? `Export ${exportProgressPct}%` : "Export"}
        </Button>
      </div>
    </header>
  );
}

