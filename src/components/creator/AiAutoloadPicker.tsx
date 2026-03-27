"use client";

import { useMemo, useState } from "react";
import { Check, Sparkles, WandSparkles, X } from "lucide-react";
import { toast } from "sonner";

import { resolveProjectVideoInfoHistory } from "@/lib/creator/video-info-storage";
import { buildVideoInfoTagsInput } from "@/lib/creator/youtube-publish";
import type { CreatorVideoInfoProjectRecord } from "@/lib/creator/types";
import type { ContentProjectRecord } from "@/lib/projects/types";
import { cn } from "@/lib/utils";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type AutoloadField = "title" | "description" | "tags" | "all";

interface AiAutoloadPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  field: AutoloadField;
  project: ContentProjectRecord | null | undefined;
  onApplyTitle?: (title: string) => void;
  onApplyDescription?: (description: string) => void;
  onApplyTags?: (tags: string) => void;
  onApplyAll?: (values: { title: string; description: string; tags: string; chapters?: string }) => void;
}

function formatRelativeDate(value: number) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function fieldLabel(field: AutoloadField) {
  switch (field) {
    case "title":
      return "Title";
    case "description":
      return "Description";
    case "tags":
      return "Tags";
    case "all":
      return "All Fields";
  }
}

export function AiAutoloadPicker({
  open,
  onOpenChange,
  field,
  project,
  onApplyTitle,
  onApplyDescription,
  onApplyTags,
  onApplyAll,
}: AiAutoloadPickerProps) {
  const history = useMemo(() => resolveProjectVideoInfoHistory(project), [project]);
  const sortedHistory = useMemo(
    () => [...history].sort((a, b) => b.generatedAt - a.generatedAt),
    [history]
  );

  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null);

  if (history.length === 0) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md border-white/10 bg-zinc-950 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <WandSparkles className="h-5 w-5 text-cyan-300" />
              Load from AI
            </DialogTitle>
            <DialogDescription className="text-zinc-400">
              No AI generations found for this project. Generate metadata in the AI Metadata tab first.
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  const handleApplyFromRecord = (record: CreatorVideoInfoProjectRecord, specificTitle?: string) => {
    const analysis = record.analysis;

    if (field === "title" && onApplyTitle) {
      const title = specificTitle ?? analysis.youtube.titleIdeas[0] ?? "";
      if (!title) {
        toast.error("No title available in this generation.");
        return;
      }
      onApplyTitle(title);
      toast.success("Title loaded from AI");
    } else if (field === "description" && onApplyDescription) {
      onApplyDescription(analysis.youtube.description);
      toast.success("Description loaded from AI");
    } else if (field === "tags" && onApplyTags) {
      onApplyTags(buildVideoInfoTagsInput(analysis));
      toast.success("Tags loaded from AI");
    } else if (field === "all" && onApplyAll) {
      onApplyAll({
        title: specificTitle ?? analysis.youtube.titleIdeas[0] ?? "",
        description: analysis.youtube.description,
        tags: buildVideoInfoTagsInput(analysis),
        chapters: analysis.youtube.chapterText || undefined,
      });
      toast.success("All fields loaded from AI");
    }

    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-lg overflow-y-auto border-white/10 bg-zinc-950 text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <WandSparkles className="h-5 w-5 text-cyan-300" />
            Load {fieldLabel(field)} from AI
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
            Pick a generation to auto-fill {field === "all" ? "title, description, and tags" : `the ${field} field`}.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-3">
          {sortedHistory.map((record) => {
            const analysis = record.analysis;
            const isExpanded = expandedRecordId === record.id;

            return (
              <div
                key={record.id}
                className="rounded-2xl border border-white/8 bg-black/20 overflow-hidden"
              >
                {/* Record header */}
                <button
                  type="button"
                  onClick={() => setExpandedRecordId(isExpanded ? null : record.id)}
                  className="flex w-full items-center justify-between gap-3 p-4 text-left transition-colors hover:bg-white/[0.03]"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">
                        {formatRelativeDate(record.generatedAt)}
                      </span>
                      <Badge className="border-white/10 bg-white/5 text-[10px] text-white/60">
                        {analysis.model || "unknown"}
                      </Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {record.inputSummary.videoInfoBlocks.slice(0, 4).map((block) => (
                        <span
                          key={block}
                          className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/50"
                        >
                          {block}
                        </span>
                      ))}
                      {record.inputSummary.videoInfoBlocks.length > 4 && (
                        <span className="text-[10px] text-white/40">
                          +{record.inputSummary.videoInfoBlocks.length - 4}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Quick apply for non-title fields */}
                  {field !== "title" && (
                    <Button
                      size="sm"
                      className="shrink-0 bg-white text-black hover:bg-zinc-200"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleApplyFromRecord(record);
                      }}
                    >
                      <Check className="mr-1.5 h-3.5 w-3.5" />
                      Use
                    </Button>
                  )}
                </button>

                {/* Expanded preview – title picker for title field */}
                {isExpanded && field === "title" && analysis.youtube.titleIdeas.length > 0 && (
                  <div className="border-t border-white/6 p-4 space-y-2">
                    <div className="text-xs uppercase tracking-[0.2em] text-zinc-500 mb-2">Pick a title</div>
                    {analysis.youtube.titleIdeas.map((title, index) => (
                      <button
                        key={`${index}-${title}`}
                        type="button"
                        onClick={() => handleApplyFromRecord(record, title)}
                        className="w-full rounded-xl border border-white/8 bg-white/[0.03] p-3 text-left text-sm text-white/90 transition-colors hover:border-cyan-300/20 hover:bg-cyan-400/5"
                      >
                        <span className="mr-2 text-cyan-300">{index + 1}.</span>
                        {title}
                      </button>
                    ))}
                  </div>
                )}

                {/* Expanded preview – field value preview for description/tags/all */}
                {isExpanded && field !== "title" && (
                  <div className="border-t border-white/6 p-4">
                    {(field === "description" || field === "all") && (
                      <div className="mb-3">
                        <div className="text-xs uppercase tracking-[0.2em] text-zinc-500 mb-1">Description preview</div>
                        <div className="max-h-32 overflow-y-auto rounded-xl border border-white/8 bg-black/30 p-3 text-xs leading-relaxed text-white/70">
                          {analysis.youtube.description.slice(0, 400)}
                          {analysis.youtube.description.length > 400 ? "…" : ""}
                        </div>
                      </div>
                    )}
                    {(field === "tags" || field === "all") && (
                      <div>
                        <div className="text-xs uppercase tracking-[0.2em] text-zinc-500 mb-1">Tags preview</div>
                        <div className="flex flex-wrap gap-1">
                          {analysis.youtube.hashtags.slice(0, 8).map((tag) => (
                            <span key={tag} className="rounded-full border border-cyan-300/15 bg-cyan-400/5 px-2 py-0.5 text-[10px] text-cyan-100">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {field === "all" && analysis.youtube.titleIdeas.length > 0 && (
                      <div className="mt-3 space-y-2">
                        <div className="text-xs uppercase tracking-[0.2em] text-zinc-500 mb-1">Pick a title (loads all)</div>
                        {analysis.youtube.titleIdeas.map((title, index) => (
                          <button
                            key={`${index}-${title}`}
                            type="button"
                            onClick={() => handleApplyFromRecord(record, title)}
                            className="w-full rounded-xl border border-white/8 bg-white/[0.03] p-3 text-left text-sm text-white/90 transition-colors hover:border-cyan-300/20 hover:bg-cyan-400/5"
                          >
                            <span className="mr-2 text-cyan-300">{index + 1}.</span>
                            {title}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Small sparkle icon button placed next to a form input to trigger the autoload picker. */
export function AiAutoloadButton({
  onClick,
  disabled,
  className,
}: {
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "h-8 w-8 shrink-0 rounded-lg p-0 text-cyan-400 hover:bg-cyan-400/10 hover:text-cyan-300 disabled:text-zinc-600",
        className
      )}
      title="Load from AI generation"
    >
      <Sparkles className="h-4 w-4" />
    </Button>
  );
}
