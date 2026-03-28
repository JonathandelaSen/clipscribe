"use client";

import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRightLeft,
  BarChart3,
  Braces,
  CircleAlert,
  Copy,
  Download,
  FileCode2,
  Filter,
  Hash,
  Layers3,
  RefreshCcw,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { useCreatorLlmRuns } from "@/hooks/useCreatorLlmRuns";
import { useProjectLibrary } from "@/hooks/useProjectLibrary";
import type { CreatorLLMRunRecord } from "@/lib/creator/types";
import {
  collectAiRunDiffItems,
  computeAiRunsWorkbenchMetrics,
  filterAiRunsWorkbenchRecords,
  type AiRunsWorkbenchSort,
} from "@/lib/creator/llm-runs-workbench";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Toaster } from "@/components/ui/sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type InspectorTab = "overview" | "parsed" | "request" | "response" | "diff";

type QueryFilterState = {
  projectId: string;
  feature: "all" | CreatorLLMRunRecord["feature"];
  status: "all" | CreatorLLMRunRecord["status"];
  model: string;
};

function copyText(text: string, label: string) {
  navigator.clipboard.writeText(text);
  toast.success(`${label} copied`);
}

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatDurationMs(durationMs?: number | null): string {
  if (!Number.isFinite(durationMs) || durationMs == null) return "n/a";
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
  return `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 0 : 1)} s`;
}

function formatCompactNumber(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatUsd(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  if (value === 0) return "$0.00";
  return `$${value.toFixed(value >= 0.01 ? 4 : 6)}`;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatStartedAt(value: number): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function stringifyForDebug(value: unknown): string {
  if (value == null) return "null";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function extractAssistantText(payload: unknown): string | null {
  const record = asRecord(payload);
  if (!record) return null;
  const choices = record.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const firstChoice = asRecord(choices[0]);
  const message = asRecord(firstChoice?.message);
  const content = message?.content;

  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;

  const parts = content
    .map((part) => {
      const item = asRecord(part);
      if (!item || item.type !== "text") return "";
      return typeof item.text === "string" ? item.text : "";
    })
    .filter(Boolean);

  return parts.length > 0 ? parts.join("\n") : null;
}

function typeLabel(value: unknown): string {
  if (value == null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function previewPrimitive(value: unknown): string {
  if (value == null) return "null";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function ErrorSpotlight({ run }: { run: CreatorLLMRunRecord }) {
  if (run.status === "success" || run.status === "queued" || run.status === "processing") return null;

  const title =
    run.status === "provider_error"
      ? "Provider failure"
      : run.status === "parse_error"
        ? "Malformed or unreadable JSON"
        : "Validation failed after parsing";

  const body =
    run.status === "provider_error"
      ? "The provider rejected the request or returned a transport-level failure before a usable JSON payload could be accepted."
      : run.status === "parse_error"
        ? "The provider answered, but the assistant content did not resolve into valid JSON for the current flow."
        : "A JSON payload was produced, but it did not satisfy the schema or downstream expectations for this run.";

  const nextStep =
    run.status === "provider_error"
      ? "Review request envelope, auth/quota status, and provider payload."
      : run.status === "parse_error"
        ? "Compare request instructions against the assistant content and the raw provider envelope."
        : "Inspect the parsed output and compare against a successful run using the same prompt family.";

  return (
    <Alert className="border-amber-300/20 bg-amber-500/10 text-amber-50">
      <CircleAlert className="h-4 w-4" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="space-y-2 text-amber-50/80">
        <p>{body}</p>
        <p>Error code: {run.errorCode ?? "n/a"}</p>
        {run.errorMessage ? <p>Message: {run.errorMessage}</p> : null}
        <p>Next step: {nextStep}</p>
      </AlertDescription>
    </Alert>
  );
}

function MetricCard({
  label,
  value,
  caption,
  accent,
}: {
  label: string;
  value: string;
  caption?: string;
  accent?: "cyan" | "amber" | "emerald";
}) {
  return (
    <div
      className={cn(
        "rounded-[1.4rem] border bg-black/30 p-4 shadow-[0_18px_50px_rgba(0,0,0,0.26)]",
        accent === "amber"
          ? "border-amber-300/15"
          : accent === "emerald"
            ? "border-emerald-300/15"
            : "border-cyan-300/15"
      )}
    >
      <div className="text-[11px] uppercase tracking-[0.28em] text-white/38">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-white">{value}</div>
      {caption ? <div className="mt-1 text-xs text-white/45">{caption}</div> : null}
    </div>
  );
}

function KeyValue({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.025] px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-[0.24em] text-white/40">{label}</div>
      <div className={cn("mt-1 text-sm text-white/90 break-all", mono && "font-mono text-[12px]")}>{value}</div>
    </div>
  );
}

function WorkbenchControlBlock({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[1.25rem] border border-white/8 bg-[linear-gradient(180deg,rgba(11,16,24,0.96),rgba(6,10,16,0.98))] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
      <div className="mb-2 flex items-center justify-between gap-3">
        <label className="text-[11px] uppercase tracking-[0.24em] text-white/56">{label}</label>
        {hint ? <span className="text-[10px] uppercase tracking-[0.18em] text-white/30">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

function JsonNode({
  name,
  value,
  depth = 0,
  defaultExpandedDepth = 1,
}: {
  name?: string;
  value: unknown;
  depth?: number;
  defaultExpandedDepth?: number;
}) {
  const isArray = Array.isArray(value);
  const isObject = value != null && typeof value === "object" && !isArray;

  if (!isArray && !isObject) {
    return (
      <div className="flex flex-wrap items-start gap-2 py-1 text-sm">
        {name ? <span className="font-mono text-cyan-200/90">{name}:</span> : null}
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-white/45">
          {typeLabel(value)}
        </span>
        <span className="min-w-0 break-all font-mono text-[12px] text-white/78">{previewPrimitive(value)}</span>
      </div>
    );
  }

  const entries = isArray
    ? (value as unknown[]).map((item, index) => [String(index), item] as const)
    : Object.entries(value as Record<string, unknown>);
  const summaryLabel = isArray ? `Array(${entries.length})` : `Object(${entries.length})`;

  return (
    <details
      open={depth < defaultExpandedDepth}
      className="rounded-2xl border border-white/8 bg-black/20 px-3 py-2.5"
    >
      <summary className="cursor-pointer list-none">
        <div className="flex flex-wrap items-center gap-2">
          {name ? <span className="font-mono text-[12px] text-cyan-200/90">{name}</span> : null}
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-white/45">
            {summaryLabel}
          </span>
        </div>
      </summary>
      <div className="mt-3 space-y-2 border-l border-white/8 pl-3">
        {entries.length === 0 ? (
          <div className="py-1 text-sm text-white/45">Empty</div>
        ) : (
          entries.map(([entryName, entryValue]) => (
            <JsonNode
              key={`${name ?? "root"}-${entryName}`}
              name={entryName}
              value={entryValue}
              depth={depth + 1}
              defaultExpandedDepth={defaultExpandedDepth}
            />
          ))
        )}
      </div>
    </details>
  );
}

function JsonPanel({
  title,
  value,
  emptyLabel,
}: {
  title: string;
  value: unknown;
  emptyLabel: string;
}) {
  return (
    <section className="rounded-[1.6rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.015))] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Braces className="h-4 w-4 text-cyan-300" />
          <h3 className="text-sm font-semibold text-white">{title}</h3>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 rounded-xl border border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/10 hover:text-white"
          onClick={() => copyText(stringifyForDebug(value), `${title} JSON`)}
        >
          <Copy className="mr-2 h-3.5 w-3.5" />
          Copy JSON
        </Button>
      </div>
      <div className="max-h-[58vh] overflow-auto rounded-[1.2rem] border border-white/8 bg-black/30 p-3">
        {value == null ? <div className="text-sm text-white/45">{emptyLabel}</div> : <JsonNode value={value} />}
      </div>
    </section>
  );
}

function DiffList({
  title,
  items,
  emptyLabel,
}: {
  title: string;
  items: ReturnType<typeof collectAiRunDiffItems>;
  emptyLabel: string;
}) {
  return (
    <section className="rounded-[1.6rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.015))] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ArrowRightLeft className="h-4 w-4 text-cyan-300" />
          <h3 className="text-sm font-semibold text-white">{title}</h3>
        </div>
        <Badge variant="outline" className="border-white/12 bg-white/5 text-white/70">
          {items.length} change{items.length === 1 ? "" : "s"}
        </Badge>
      </div>
      <div className="space-y-2">
        {items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-5 text-sm text-white/45">
            {emptyLabel}
          </div>
        ) : (
          items.map((item) => (
            <div key={`${title}-${item.path}`} className="rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className={cn(
                    "border-white/12 text-white/85",
                    item.kind === "added"
                      ? "bg-emerald-400/10 text-emerald-100"
                      : item.kind === "removed"
                        ? "bg-red-400/10 text-red-100"
                        : "bg-cyan-400/10 text-cyan-100"
                  )}
                >
                  {item.kind}
                </Badge>
                <span className="font-mono text-[12px] text-white/78">{item.path}</span>
              </div>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-white/40">Before · {item.beforeType}</div>
                  <div className="mt-1 font-mono text-[12px] text-white/72 break-all">{item.beforePreview}</div>
                </div>
                <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-white/40">After · {item.afterType}</div>
                  <div className="mt-1 font-mono text-[12px] text-white/72 break-all">{item.afterPreview}</div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function RequestMessages({ run }: { run: CreatorLLMRunRecord }) {
  const request = asRecord(run.requestPayloadRaw);
  const messages = Array.isArray(request?.messages) ? request.messages : [];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <KeyValue label="Model" value={run.model} />
        <KeyValue label="Temperature" value={String(run.temperature)} />
        <KeyValue label="Response Format" value={String(asRecord(request?.response_format)?.type ?? "n/a")} />
      </div>
      <div className="space-y-3">
        {messages.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-5 text-sm text-white/45">
            No structured message list was stored for this request.
          </div>
        ) : (
          messages.map((message, index) => {
            const item = asRecord(message);
            return (
              <div key={`request-message-${index}`} className="rounded-[1.4rem] border border-white/8 bg-black/20 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Badge variant="outline" className="border-white/12 bg-white/5 text-white/80">
                    {String(item?.role ?? `message ${index + 1}`)}
                  </Badge>
                  <span className="text-xs text-white/40">Message {index + 1}</span>
                </div>
                <pre className="overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-6 text-white/76">
                  {String(item?.content ?? "")}
                </pre>
              </div>
            );
          })
        )}
      </div>
      <JsonPanel title="Raw request envelope" value={run.requestPayloadRaw} emptyLabel="No request payload stored." />
    </div>
  );
}

function ResponseInspector({ run }: { run: CreatorLLMRunRecord }) {
  const response = asRecord(run.responsePayloadRaw);
  const usage = asRecord(response?.usage);
  const assistantText = extractAssistantText(run.responsePayloadRaw);
  const choiceCount = Array.isArray(response?.choices) ? response.choices.length : 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <KeyValue label="Run Status" value={run.status} />
        <KeyValue label="Choices" value={String(choiceCount)} />
        <KeyValue label="Prompt Tokens" value={String(usage?.prompt_tokens ?? run.usage?.promptTokens ?? "n/a")} />
        <KeyValue label="Completion Tokens" value={String(usage?.completion_tokens ?? run.usage?.completionTokens ?? "n/a")} />
      </div>
      <div className="rounded-[1.4rem] border border-white/8 bg-black/20 p-4">
        <div className="mb-2 flex items-center gap-2">
          <FileCode2 className="h-4 w-4 text-cyan-300" />
          <h3 className="text-sm font-semibold text-white">Assistant content</h3>
        </div>
        <pre className="overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-6 text-white/76">
          {assistantText || "No assistant text extracted from the provider envelope."}
        </pre>
      </div>
      <JsonPanel title="Raw provider response" value={run.responsePayloadRaw} emptyLabel="No provider response stored." />
    </div>
  );
}

function OverviewInspector({
  run,
  projectName,
}: {
  run: CreatorLLMRunRecord;
  projectName?: string;
}) {
  const inputSummary = run.inputSummary;

  return (
    <div className="space-y-4">
      <ErrorSpotlight run={run} />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <KeyValue label="Project" value={projectName ?? run.projectId ?? "Global"} />
        <KeyValue label="Feature" value={run.feature === "video_info" ? "Video Info" : "Shorts"} />
        <KeyValue label="Operation" value={run.operation} mono />
        <KeyValue label="Prompt Version" value={run.promptVersion} mono />
        <KeyValue label="Duration" value={formatDurationMs(run.durationMs)} />
        <KeyValue label="Fetch" value={formatDurationMs(run.fetchDurationMs)} />
        <KeyValue label="Parse" value={formatDurationMs(run.parseDurationMs)} />
        <KeyValue label="Started" value={formatStartedAt(run.startedAt)} />
        <KeyValue label="Model" value={run.model} mono />
        <KeyValue label="Tokens" value={formatCompactNumber(run.usage?.totalTokens)} />
        <KeyValue label="Estimated Cost" value={formatUsd(run.estimatedCostUsd)} />
        <KeyValue label="Fingerprint" value={run.requestFingerprint} mono />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <section className="rounded-[1.6rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.015))] p-4">
          <div className="mb-3 flex items-center gap-2">
            <Layers3 className="h-4 w-4 text-cyan-300" />
            <h3 className="text-sm font-semibold text-white">Input summary</h3>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <KeyValue label="Transcript Chars" value={formatCompactNumber(inputSummary.transcriptCharCount)} />
            <KeyValue label="Transcript Chunks" value={formatCompactNumber(inputSummary.transcriptChunkCount)} />
            <KeyValue label="Subtitle Chunks" value={formatCompactNumber(inputSummary.subtitleChunkCount)} />
            <KeyValue label="Transcript Version" value={inputSummary.transcriptVersionLabel ?? "n/a"} />
            <KeyValue label="Subtitle Version" value={inputSummary.subtitleVersionLabel ?? "n/a"} />
            <KeyValue label="Source Asset" value={inputSummary.sourceAssetId ?? "n/a"} mono />
            {inputSummary.niche ? <KeyValue label="Niche" value={inputSummary.niche} /> : null}
            {inputSummary.audience ? <KeyValue label="Audience" value={inputSummary.audience} /> : null}
            {inputSummary.tone ? <KeyValue label="Tone" value={inputSummary.tone} /> : null}
            {inputSummary.videoInfoBlocks?.length ? (
              <KeyValue label="Video Blocks" value={inputSummary.videoInfoBlocks.join(", ")} />
            ) : null}
            <KeyValue label="Prompt Mode" value={inputSummary.promptCustomizationMode ?? "default"} />
            {inputSummary.promptCustomizationHash ? (
              <KeyValue label="Prompt Hash" value={inputSummary.promptCustomizationHash} mono />
            ) : null}
            {inputSummary.promptEditedSections?.length ? (
              <KeyValue label="Edited Sections" value={inputSummary.promptEditedSections.join(", ")} />
            ) : null}
          </div>
        </section>

        <section className="rounded-[1.6rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.015))] p-4">
          <div className="mb-3 flex items-center gap-2">
            <Hash className="h-4 w-4 text-cyan-300" />
            <h3 className="text-sm font-semibold text-white">Trace posture</h3>
          </div>
          <div className="space-y-3">
            <KeyValue label="Status" value={run.status} />
            <KeyValue label="Exportable" value={run.exportable ? "yes" : "no"} />
            <KeyValue label="Redaction" value={run.redactionState} />
            <KeyValue label="Contains Raw Payload" value={run.containsRawPayload ? "yes" : "no"} />
            {run.errorCode ? <KeyValue label="Error Code" value={run.errorCode} mono /> : null}
            {run.errorMessage ? <KeyValue label="Error Message" value={run.errorMessage} /> : null}
          </div>
        </section>
      </div>
    </div>
  );
}

function RunListRow({
  run,
  isActive,
  isComparing,
  projectName,
  onSelect,
  onDelete,
  onCompare,
}: {
  run: CreatorLLMRunRecord;
  isActive: boolean;
  isComparing: boolean;
  projectName?: string;
  onSelect: () => void;
  onDelete: () => void;
  onCompare: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "group rounded-[1.4rem] border p-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70",
        isActive
          ? "border-cyan-400/30 bg-cyan-500/10 shadow-[0_0_0_1px_rgba(34,211,238,0.1)]"
          : "border-white/8 bg-black/20 hover:border-white/16 hover:bg-white/[0.045]"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-white/12 bg-white/5 text-white/78">
              {run.feature === "video_info" ? "Video Info" : "Shorts"}
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                "border-white/12",
                run.status === "success"
                  ? "bg-emerald-400/10 text-emerald-100"
                  : run.status === "queued" || run.status === "processing"
                    ? "bg-cyan-400/10 text-cyan-100"
                    : "bg-amber-400/10 text-amber-100"
              )}
            >
              {run.status}
            </Badge>
            {isComparing ? (
              <Badge variant="outline" className="border-cyan-300/20 bg-cyan-400/10 text-cyan-100">
                compare
              </Badge>
            ) : null}
          </div>
          <div className="truncate text-sm font-semibold text-white">{run.model}</div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-white/45">
            <span>{formatStartedAt(run.startedAt)}</span>
            <span>{formatDurationMs(run.durationMs)}</span>
            <span>{formatCompactNumber(run.usage?.totalTokens)} tok</span>
          </div>
          <div className="truncate text-xs text-white/38">{projectName ?? run.projectId ?? "Global run"}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 rounded-xl border border-white/10 bg-white/[0.03] px-2.5 text-white/60 hover:bg-white/10 hover:text-white"
            onClick={(event) => {
              event.stopPropagation();
              onCompare();
            }}
          >
            <ArrowRightLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 rounded-xl border border-white/10 bg-white/[0.03] px-2.5 text-white/60 hover:bg-red-500/10 hover:text-red-100"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function AiRunsWorkbench() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { runs, isLoading, error, refresh, deleteRun, deleteRuns, clearRuns } = useCreatorLlmRuns();
  const { projects } = useProjectLibrary();

  const [sortMode, setSortMode] = useState<AiRunsWorkbenchSort>("newest");
  const [activeTab, setActiveTab] = useState<InspectorTab>("overview");
  const [searchDraft, setSearchDraft] = useState(searchParams.get("q") ?? "");

  const deferredSearchDraft = useDeferredValue(searchDraft);
  const searchParamsString = searchParams.toString();

  const queryState = useMemo<QueryFilterState>(() => {
    const feature = searchParams.get("feature");
    const status = searchParams.get("status");

    return {
      projectId: searchParams.get("projectId") ?? "all",
      feature: feature === "shorts" || feature === "video_info" ? feature : "all",
      status:
        status === "queued" ||
        status === "processing" ||
        status === "success" ||
        status === "provider_error" ||
        status === "parse_error" ||
        status === "validation_error"
          ? status
          : "all",
      model: searchParams.get("model") ?? "all",
    };
  }, [searchParams]);

  const selectedRunId = searchParams.get("run") ?? "";
  const compareRunId = searchParams.get("compare") ?? "";
  const queryText = searchParams.get("q") ?? "";

  useEffect(() => {
    setSearchDraft(queryText);
  }, [queryText]);

  const updateQuery = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParamsString);
    for (const [key, value] of Object.entries(updates)) {
      if (value == null || value === "" || value === "all") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }
    const nextUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    startTransition(() => {
      router.replace(nextUrl, { scroll: false });
    });
  }, [pathname, router, searchParamsString]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      if (deferredSearchDraft === queryText) return;
      updateQuery({
        q: deferredSearchDraft || null,
        run: null,
        compare: null,
      });
    }, 160);

    return () => window.clearTimeout(timeoutId);
  }, [deferredSearchDraft, queryText, updateQuery]);

  const projectNameById = useMemo(() => {
    return new Map(projects.map((project) => [project.id, project.name]));
  }, [projects]);

  const projectOptions = useMemo(() => {
    const ids = Array.from(new Set(runs.map((run) => run.projectId).filter(Boolean))) as string[];
    return ids
      .map((id) => ({
        id,
        label: projectNameById.get(id) ?? id,
      }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [projectNameById, runs]);

  const modelOptions = useMemo(() => {
    return Array.from(new Set(runs.map((run) => run.model).filter(Boolean))).sort((left, right) => left.localeCompare(right));
  }, [runs]);

  const filteredRuns = useMemo(() => {
    return filterAiRunsWorkbenchRecords(runs, {
      projectId: queryState.projectId !== "all" ? queryState.projectId : null,
      feature: queryState.feature,
      status: queryState.status,
      model: queryState.model,
      q: queryText,
      sort: sortMode,
    });
  }, [queryState, queryText, runs, sortMode]);

  const metrics = useMemo(() => computeAiRunsWorkbenchMetrics(filteredRuns), [filteredRuns]);

  const selectedRun = useMemo(() => {
    return filteredRuns.find((run) => run.id === selectedRunId) ?? filteredRuns[0] ?? null;
  }, [filteredRuns, selectedRunId]);

  const compareRun = useMemo(() => {
    if (!compareRunId) return null;
    return filteredRuns.find((run) => run.id === compareRunId) ?? null;
  }, [compareRunId, filteredRuns]);

  const compareCandidates = useMemo(() => {
    return filteredRuns.filter((run) => run.id !== selectedRun?.id);
  }, [filteredRuns, selectedRun?.id]);

  useEffect(() => {
    const nextRunId = selectedRun?.id ?? null;
    if ((selectedRunId || null) === nextRunId) return;
    updateQuery({ run: nextRunId });
  }, [selectedRun?.id, selectedRunId, updateQuery]);

  useEffect(() => {
    if (!compareRunId) return;
    if (compareRunId === selectedRun?.id || !compareRun) {
      updateQuery({ compare: null });
    }
  }, [compareRun, compareRunId, selectedRun?.id, updateQuery]);

  const parsedDiffItems = useMemo(() => {
    if (!selectedRun || !compareRun) return [];
    return collectAiRunDiffItems(selectedRun.parsedOutputSnapshot, compareRun.parsedOutputSnapshot, {
      maxItems: 36,
      maxDepth: 6,
    });
  }, [compareRun, selectedRun]);

  const requestDiffItems = useMemo(() => {
    if (!selectedRun || !compareRun) return [];
    return collectAiRunDiffItems(selectedRun.requestPayloadRaw, compareRun.requestPayloadRaw, {
      maxItems: 28,
      maxDepth: 5,
    });
  }, [compareRun, selectedRun]);

  const responseDiffItems = useMemo(() => {
    if (!selectedRun || !compareRun) return [];
    return collectAiRunDiffItems(selectedRun.responsePayloadRaw, compareRun.responsePayloadRaw, {
      maxItems: 28,
      maxDepth: 5,
    });
  }, [compareRun, selectedRun]);

  const projectLabel = selectedRun?.projectId ? projectNameById.get(selectedRun.projectId) : undefined;
  const activeFilterCount = useMemo(() => {
    return [
      queryState.projectId !== "all",
      queryState.feature !== "all",
      queryState.status !== "all",
      queryState.model !== "all",
      queryText.trim().length > 0,
    ].filter(Boolean).length;
  }, [queryState.feature, queryState.model, queryState.projectId, queryState.status, queryText]);

  const handleDeleteVisible = async () => {
    const targetIds = filteredRuns.map((run) => run.id);
    if (targetIds.length === 0) return;
    if (!window.confirm(`Delete ${targetIds.length} visible AI run${targetIds.length === 1 ? "" : "s"}?`)) return;

    if (targetIds.length === runs.length) {
      await clearRuns();
    } else {
      await deleteRuns(targetIds);
    }
    toast.success("Visible AI runs deleted");
  };

  const handleDeleteSingle = async (runId: string) => {
    if (!window.confirm("Delete this AI run?")) return;
    await deleteRun(runId);
    toast.success("AI run deleted");
  };

  return (
    <main className="min-h-full bg-transparent text-white">
      <div className="sticky top-0 z-10 border-b border-white/8 bg-[linear-gradient(180deg,rgba(4,8,14,0.96),rgba(4,8,14,0.88))] backdrop-blur-xl">
        <div className="mx-auto max-w-[1720px] px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-cyan-200/80">
                  <BarChart3 className="h-4 w-4" />
                  <span className="text-xs uppercase tracking-[0.28em]">AI Runs Workbench</span>
                </div>
                <h1 className="text-3xl font-semibold tracking-tight text-white">Operational view for prompts, payloads, and JSON traces</h1>
                <p className="max-w-4xl text-sm text-white/50">
                  Full-screen inspection for long sessions: dense run index, sharable filters in the URL, and a structured JSON inspector instead of raw text blobs.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  className="rounded-2xl border border-white/10 bg-white/[0.04] text-white/75 hover:bg-white/10 hover:text-white"
                  onClick={() => void refresh()}
                >
                  <RefreshCcw className="mr-2 h-4 w-4" />
                  Refresh
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="rounded-2xl border border-white/10 bg-white/[0.04] text-white/75 hover:bg-white/10 hover:text-white"
                  onClick={() => downloadJson(`clipscribe-ai-runs-${Date.now()}.json`, filteredRuns)}
                  disabled={filteredRuns.length === 0}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Export Visible JSON
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="rounded-2xl border border-white/10 bg-white/[0.04] text-white/75 hover:bg-red-500/10 hover:text-red-100"
                  onClick={() => void handleDeleteVisible()}
                  disabled={filteredRuns.length === 0}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete Visible
                </Button>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <MetricCard label="Visible Runs" value={String(metrics.totalRuns)} />
              <MetricCard label="Error Rate" value={formatPercent(metrics.errorRate)} caption={`${metrics.errorRuns} failed or degraded runs`} accent="amber" />
              <MetricCard label="Models" value={String(metrics.uniqueModels)} />
              <MetricCard label="Avg Latency" value={formatDurationMs(metrics.averageDurationMs)} />
              <MetricCard label="Visible Tokens" value={formatCompactNumber(metrics.totalTokens)} caption={`${metrics.successRuns} successful runs`} accent="emerald" />
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1720px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
          <aside className="space-y-4 xl:sticky xl:top-[13.75rem] xl:self-start">
            <Card className="overflow-hidden border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),transparent_30%),linear-gradient(180deg,rgba(10,14,22,0.98),rgba(5,8,14,0.98))] text-white shadow-[0_20px_80px_rgba(0,0,0,0.42)]">
              <CardContent className="space-y-4 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Filter className="h-4 w-4 text-cyan-300" />
                      <h2 className="text-sm font-semibold text-white">Query controls</h2>
                    </div>
                  </div>
                  <Badge variant="outline" className="border-white/12 bg-black/25 text-white/70">
                    {activeFilterCount} active
                  </Badge>
                </div>

                <WorkbenchControlBlock label="Search" hint="live">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-200/55" />
                    <Input
                      value={searchDraft}
                      onChange={(event) => setSearchDraft(event.target.value)}
                      placeholder="model, error, fingerprint, audience..."
                      className="h-11 rounded-2xl border-white/12 bg-[linear-gradient(180deg,rgba(14,20,30,0.98),rgba(7,11,18,0.98))] pl-10 text-white placeholder:text-white/28"
                    />
                  </div>
                </WorkbenchControlBlock>

                <div className="grid gap-3">
                  <WorkbenchControlBlock label="Project scope" hint="dataset">
                    <Select
                      value={queryState.projectId}
                      onValueChange={(value) => updateQuery({ projectId: value, run: null, compare: null })}
                    >
                      <SelectTrigger className="h-11 rounded-2xl border-white/12 bg-[linear-gradient(180deg,rgba(14,20,30,0.98),rgba(7,11,18,0.98))] text-white">
                        <SelectValue placeholder="All projects" />
                      </SelectTrigger>
                      <SelectContent className="border-white/10 bg-zinc-950 text-white">
                        <SelectItem value="all">All projects</SelectItem>
                        {projectOptions.map((project) => (
                          <SelectItem key={project.id} value={project.id}>
                            {project.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </WorkbenchControlBlock>

                  <div className="grid gap-3 md:grid-cols-2">
                    <WorkbenchControlBlock label="Feature">
                      <Select
                        value={queryState.feature}
                        onValueChange={(value) => updateQuery({ feature: value, run: null, compare: null })}
                      >
                        <SelectTrigger className="h-11 rounded-2xl border-white/12 bg-[linear-gradient(180deg,rgba(14,20,30,0.98),rgba(7,11,18,0.98))] text-white">
                          <SelectValue placeholder="All features" />
                        </SelectTrigger>
                        <SelectContent className="border-white/10 bg-zinc-950 text-white">
                          <SelectItem value="all">All features</SelectItem>
                          <SelectItem value="shorts">Shorts</SelectItem>
                          <SelectItem value="video_info">Video info</SelectItem>
                        </SelectContent>
                      </Select>
                    </WorkbenchControlBlock>

                    <WorkbenchControlBlock label="Status">
                      <Select
                        value={queryState.status}
                        onValueChange={(value) => updateQuery({ status: value, run: null, compare: null })}
                      >
                        <SelectTrigger className="h-11 rounded-2xl border-white/12 bg-[linear-gradient(180deg,rgba(14,20,30,0.98),rgba(7,11,18,0.98))] text-white">
                          <SelectValue placeholder="All statuses" />
                        </SelectTrigger>
                        <SelectContent className="border-white/10 bg-zinc-950 text-white">
                          <SelectItem value="all">All statuses</SelectItem>
                          <SelectItem value="queued">Queued</SelectItem>
                          <SelectItem value="processing">Processing</SelectItem>
                          <SelectItem value="success">Success</SelectItem>
                          <SelectItem value="provider_error">Provider error</SelectItem>
                          <SelectItem value="parse_error">Parse error</SelectItem>
                          <SelectItem value="validation_error">Validation error</SelectItem>
                        </SelectContent>
                      </Select>
                    </WorkbenchControlBlock>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <WorkbenchControlBlock label="Model">
                    <Select
                      value={queryState.model}
                      onValueChange={(value) => updateQuery({ model: value, run: null, compare: null })}
                    >
                      <SelectTrigger className="h-11 rounded-2xl border-white/12 bg-[linear-gradient(180deg,rgba(14,20,30,0.98),rgba(7,11,18,0.98))] text-white">
                        <SelectValue placeholder="All models" />
                      </SelectTrigger>
                      <SelectContent className="border-white/10 bg-zinc-950 text-white">
                        <SelectItem value="all">All models</SelectItem>
                        {modelOptions.map((model) => (
                          <SelectItem key={model} value={model}>
                            {model}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    </WorkbenchControlBlock>

                    <WorkbenchControlBlock label="Order">
                    <Select value={sortMode} onValueChange={(value) => setSortMode(value as AiRunsWorkbenchSort)}>
                      <SelectTrigger className="h-11 rounded-2xl border-white/12 bg-[linear-gradient(180deg,rgba(14,20,30,0.98),rgba(7,11,18,0.98))] text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="border-white/10 bg-zinc-950 text-white">
                        <SelectItem value="newest">Newest first</SelectItem>
                        <SelectItem value="oldest">Oldest first</SelectItem>
                        <SelectItem value="slowest">Slowest first</SelectItem>
                        <SelectItem value="fastest">Fastest first</SelectItem>
                        <SelectItem value="tokens">Most tokens</SelectItem>
                      </SelectContent>
                    </Select>
                    </WorkbenchControlBlock>
                  </div>
                </div>

                <Separator className="bg-white/8" />

                <div className="flex items-center justify-between gap-3 rounded-[1.2rem] border border-white/8 bg-[linear-gradient(180deg,rgba(9,13,21,0.98),rgba(5,8,14,0.98))] px-3 py-2.5">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.24em] text-white/38">Visible set</div>
                    <div className="mt-1 text-sm font-medium text-white">{filteredRuns.length} runs ready to inspect</div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    className="rounded-2xl border border-white/10 bg-white/[0.04] text-white/75 hover:bg-white/10 hover:text-white"
                    onClick={() => {
                      setSearchDraft("");
                      updateQuery({
                        projectId: null,
                        feature: null,
                        status: null,
                        model: null,
                        q: null,
                        run: null,
                        compare: null,
                      });
                    }}
                  >
                    Reset filters
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">Run index</h2>
                <span className="text-xs text-white/40">{filteredRuns.length} visible</span>
              </div>

              <div className="max-h-[calc(100vh-21rem)] space-y-3 overflow-auto pr-1">
                {isLoading ? (
                  <div className="rounded-[1.4rem] border border-white/10 bg-black/20 px-4 py-6 text-sm text-white/45">Loading AI runs...</div>
                ) : filteredRuns.length === 0 ? (
                  <div className="rounded-[1.4rem] border border-dashed border-white/10 bg-black/20 px-4 py-6 text-sm text-white/45">
                    No runs match the current filters.
                  </div>
                ) : (
                  filteredRuns.map((run) => (
                    <RunListRow
                      key={run.id}
                      run={run}
                      isActive={selectedRun?.id === run.id}
                      isComparing={compareRun?.id === run.id}
                      projectName={run.projectId ? projectNameById.get(run.projectId) : undefined}
                      onSelect={() => updateQuery({ run: run.id })}
                      onCompare={() => updateQuery({ compare: compareRun?.id === run.id ? null : run.id })}
                      onDelete={() => void handleDeleteSingle(run.id)}
                    />
                  ))
                )}
              </div>
            </div>
          </aside>

          <section className="min-w-0">
            {error ? (
              <Alert className="border-red-400/20 bg-red-500/10 text-red-100">
                <AlertTitle>Failed to load AI runs</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : !selectedRun ? (
              <div className="rounded-[1.8rem] border border-dashed border-white/10 bg-black/20 p-10 text-center text-white/45">
                {isLoading ? "Loading run details..." : "Select a run to open the inspector."}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-[1.8rem] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),transparent_26%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-5 shadow-[0_22px_70px_rgba(0,0,0,0.35)]">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="border-white/12 bg-white/5 text-white/80">
                          {selectedRun.feature === "video_info" ? "Video Info" : "Shorts"}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={cn(
                            "border-white/12",
                            selectedRun.status === "success"
                              ? "bg-emerald-400/10 text-emerald-100"
                              : selectedRun.status === "queued" || selectedRun.status === "processing"
                                ? "bg-cyan-400/10 text-cyan-100"
                              : "bg-amber-400/10 text-amber-100"
                          )}
                        >
                          {selectedRun.status}
                        </Badge>
                        <Badge variant="outline" className="border-white/12 bg-white/5 text-white/70">
                          {selectedRun.promptVersion}
                        </Badge>
                      </div>
                      <div>
                        <h2 className="text-2xl font-semibold tracking-tight text-white">{selectedRun.model}</h2>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-white/48">
                          <span>{formatStartedAt(selectedRun.startedAt)}</span>
                          <span>{selectedRun.projectId ? projectNameById.get(selectedRun.projectId) ?? selectedRun.projectId : "Global run"}</span>
                          <span>{selectedRun.id}</span>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-[minmax(0,260px)_auto]">
                      <div className="space-y-2">
                        <label className="text-[11px] uppercase tracking-[0.24em] text-white/42">Compare against</label>
                        <Select value={compareRun?.id ?? "none"} onValueChange={(value) => updateQuery({ compare: value === "none" ? null : value })}>
                          <SelectTrigger className="rounded-2xl border-white/10 bg-black/25 text-white">
                            <SelectValue placeholder="Choose a second run" />
                          </SelectTrigger>
                          <SelectContent className="border-white/10 bg-zinc-950 text-white">
                            <SelectItem value="none">No compare run</SelectItem>
                            {compareCandidates.map((run) => (
                              <SelectItem key={run.id} value={run.id}>
                                {run.model} · {formatStartedAt(run.startedAt)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="flex flex-wrap items-end gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          className="rounded-2xl border border-white/10 bg-white/[0.04] text-white/75 hover:bg-white/10 hover:text-white"
                          onClick={() => copyText(selectedRun.id, "Run id")}
                        >
                          <Copy className="mr-2 h-4 w-4" />
                          Copy ID
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          className="rounded-2xl border border-white/10 bg-white/[0.04] text-white/75 hover:bg-red-500/10 hover:text-red-100"
                          onClick={() => void handleDeleteSingle(selectedRun.id)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>

                <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as InspectorTab)} className="space-y-4">
                  <TabsList className="grid h-auto w-full grid-cols-2 rounded-[1.35rem] border border-white/10 bg-black/25 p-1.5 md:grid-cols-5">
                    <TabsTrigger value="overview" className="rounded-[1rem]">Overview</TabsTrigger>
                    <TabsTrigger value="parsed" className="rounded-[1rem]">Parsed Output</TabsTrigger>
                    <TabsTrigger value="request" className="rounded-[1rem]">Request</TabsTrigger>
                    <TabsTrigger value="response" className="rounded-[1rem]">Response</TabsTrigger>
                    <TabsTrigger value="diff" className="rounded-[1rem]">Diff</TabsTrigger>
                  </TabsList>

                  <TabsContent value="overview" className="mt-0">
                    <OverviewInspector run={selectedRun} projectName={projectLabel} />
                  </TabsContent>

                  <TabsContent value="parsed" className="mt-0">
                    <JsonPanel title="Parsed output snapshot" value={selectedRun.parsedOutputSnapshot} emptyLabel="No parsed output snapshot stored for this run." />
                  </TabsContent>

                  <TabsContent value="request" className="mt-0">
                    <RequestMessages run={selectedRun} />
                  </TabsContent>

                  <TabsContent value="response" className="mt-0">
                    <ResponseInspector run={selectedRun} />
                  </TabsContent>

                  <TabsContent value="diff" className="mt-0">
                    {!compareRun ? (
                      <div className="rounded-[1.6rem] border border-dashed border-white/10 bg-black/20 p-10 text-center text-white/45">
                        Pick a compare run to inspect structured differences across metadata, request, response, and parsed output.
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                          <KeyValue label="Selected Status" value={selectedRun.status} />
                          <KeyValue label="Compare Status" value={compareRun.status} />
                          <KeyValue label="Selected Duration" value={formatDurationMs(selectedRun.durationMs)} />
                          <KeyValue label="Compare Duration" value={formatDurationMs(compareRun.durationMs)} />
                          <KeyValue label="Selected Tokens" value={formatCompactNumber(selectedRun.usage?.totalTokens)} />
                          <KeyValue label="Compare Tokens" value={formatCompactNumber(compareRun.usage?.totalTokens)} />
                          <KeyValue label="Selected Prompt" value={selectedRun.promptVersion} mono />
                          <KeyValue label="Compare Prompt" value={compareRun.promptVersion} mono />
                        </div>

                        <DiffList title="Parsed output differences" items={parsedDiffItems} emptyLabel="Parsed snapshots match at the inspected depth." />
                        <DiffList title="Request differences" items={requestDiffItems} emptyLabel="Request envelopes match at the inspected depth." />
                        <DiffList title="Response differences" items={responseDiffItems} emptyLabel="Provider responses match at the inspected depth." />
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </div>
            )}
          </section>
        </div>
      </div>

      <Toaster theme="dark" position="bottom-center" />
    </main>
  );
}
