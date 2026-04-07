"use client";

import Link from "next/link";
import { CheckCircle2, ChevronRight, ExternalLink, Plus, RadioTower, Sparkles, Youtube } from "lucide-react";

import type { ProjectYouTubeUploadRecord } from "@/lib/projects/types";
import { cn } from "@/lib/utils";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

function formatUploadedAt(value: number) {
  return new Intl.DateTimeFormat("es", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function buildNewPublishHref(projectId: string) {
  return `/projects/${encodeURIComponent(projectId)}?tab=publish&view=new`;
}

function sourceModeLabel(record: ProjectYouTubeUploadRecord) {
  if (record.sourceMode === "project_asset") return "Project asset";
  if (record.sourceMode === "project_export") return "Project export";
  return "Local file";
}

function publishIntentLabel(record: ProjectYouTubeUploadRecord) {
  return record.draft.publishIntent === "short" ? "Short" : "Video";
}

function processingTone(status: string) {
  if (status === "succeeded") {
    return "border-emerald-400/25 bg-emerald-400/10 text-emerald-100";
  }
  if (status === "failed") {
    return "border-red-400/25 bg-red-400/10 text-red-100";
  }
  return "border-amber-400/25 bg-amber-400/10 text-amber-100";
}

function detailValue(value?: string | null) {
  return value?.trim() ? value : "n/a";
}

export function ProjectYouTubeUploadList({
  projectId,
  uploads,
  selectedUploadId,
}: {
  projectId: string;
  uploads: ProjectYouTubeUploadRecord[];
  selectedUploadId?: string;
}) {
  const newPublishHref = buildNewPublishHref(projectId);

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-white/8 bg-white/[0.035] text-white shadow-[0_22px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
        <CardHeader className="border-b border-white/6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-red-400/20 bg-red-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-red-100/90">
                <Youtube className="h-3.5 w-3.5" />
                Publish history
              </div>
              <CardTitle className="text-2xl tracking-tight text-white">YouTube uploads</CardTitle>
            </div>
            <Button
              asChild
              className="bg-[linear-gradient(135deg,rgba(34,211,238,0.9),rgba(16,185,129,0.9))] font-semibold text-black hover:opacity-95"
            >
              <Link href={newPublishHref}>
                <Plus className="mr-2 h-4 w-4" />
                New publish
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          {uploads.length === 0 ? (
            <div className="rounded-[26px] border border-dashed border-white/10 bg-black/20 p-10 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-cyan-200">
                <Sparkles className="h-6 w-6" />
              </div>
              <div className="mt-5 text-xl font-semibold text-white">No YouTube uploads yet</div>
              <div className="mt-2 text-sm text-zinc-400">The first successful publish for this project will land here.</div>
              <Button
                asChild
                className="mt-6 bg-[linear-gradient(135deg,rgba(34,211,238,0.9),rgba(16,185,129,0.9))] font-semibold text-black hover:opacity-95"
              >
                <Link href={newPublishHref}>
                  <Plus className="mr-2 h-4 w-4" />
                  New publish
                </Link>
              </Button>
            </div>
          ) : (
            <Accordion
              type="multiple"
              className="space-y-4"
              defaultValue={selectedUploadId ? [selectedUploadId] : undefined}
            >
              {uploads.map((upload) => {
                const isSelected = selectedUploadId === upload.id;

                return (
                  <AccordionItem
                    key={upload.id}
                    value={upload.id}
                    className={cn(
                      "rounded-[26px] border bg-black/20 p-5 transition-colors",
                      isSelected
                        ? "border-cyan-300/35 bg-[linear-gradient(135deg,rgba(34,211,238,0.11),rgba(255,255,255,0.03))]"
                        : "border-white/8 hover:border-white/15"
                    )}
                    style={{ contentVisibility: "auto" }}
                  >
                    <AccordionTrigger className="py-0 hover:no-underline">
                      <div className="flex w-full flex-col gap-5 pr-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-lg font-semibold text-white">{upload.draft.title}</div>
                            {isSelected ? (
                              <Badge className="border-cyan-300/30 bg-cyan-400/10 text-cyan-100">
                                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                                Latest upload
                              </Badge>
                            ) : null}
                            <Badge className="border-white/10 bg-white/5 text-white/75">
                              {publishIntentLabel(upload)}
                            </Badge>
                            <Badge className={processingTone(upload.result.processingStatus)}>
                              {upload.result.processingStatus}
                            </Badge>
                            <Badge className="border-white/10 bg-white/5 text-white/75">
                              {upload.draft.privacyStatus}
                            </Badge>
                          </div>

                          <div className="flex flex-wrap gap-4 text-sm text-zinc-400">
                            <span>{formatUploadedAt(upload.uploadedAt)}</span>
                            <span>{sourceModeLabel(upload)}</span>
                            <span className="font-mono text-zinc-500">{upload.videoId}</span>
                          </div>

                          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                              <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Source</div>
                              <div className="mt-2 truncate text-sm text-white">{upload.sourceFilename}</div>
                            </div>
                            <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                              <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Thumbnail</div>
                              <div className="mt-2 text-sm text-white">{upload.result.thumbnailState}</div>
                            </div>
                            <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                              <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Caption</div>
                              <div className="mt-2 text-sm text-white">{upload.result.captionState}</div>
                            </div>
                            <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                              <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Upload status</div>
                              <div className="mt-2 text-sm text-white">{upload.result.uploadStatus || "n/a"}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </AccordionTrigger>

                    <AccordionContent className="pt-5">
                      <div className="space-y-5">
                        <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
                          <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                            <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Description</div>
                            <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">
                              {detailValue(upload.draft.description)}
                            </div>
                          </div>

                          <div className="space-y-3">
                            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                              <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Tags</div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {upload.draft.tags.length > 0 ? (
                                  upload.draft.tags.map((tag) => (
                                    <Badge key={tag} className="border-white/10 bg-black/25 text-white/80">
                                      {tag}
                                    </Badge>
                                  ))
                                ) : (
                                  <span className="text-sm text-zinc-400">No tags</span>
                                )}
                              </div>
                            </div>

                            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                              <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Localizations</div>
                              <div className="mt-3 space-y-2">
                                {upload.draft.localizations.length > 0 ? (
                                  upload.draft.localizations.map((localization) => (
                                    <div key={localization.locale} className="rounded-xl border border-white/8 bg-black/20 px-3 py-2">
                                      <div className="text-sm font-medium text-white">{localization.locale}</div>
                                      <div className="mt-1 text-xs text-zinc-400">{localization.title}</div>
                                    </div>
                                  ))
                                ) : (
                                  <span className="text-sm text-zinc-400">No localized metadata</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                          <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                            <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Category</div>
                            <div className="mt-2 text-sm text-white">{detailValue(upload.draft.categoryId)}</div>
                          </div>
                          <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                            <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Language</div>
                            <div className="mt-2 text-sm text-white">{detailValue(upload.draft.defaultLanguage)}</div>
                          </div>
                          <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                            <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Publish at</div>
                            <div className="mt-2 text-sm text-white">{detailValue(upload.draft.publishAt)}</div>
                          </div>
                          <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                            <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Recording date</div>
                            <div className="mt-2 text-sm text-white">{detailValue(upload.draft.recordingDate)}</div>
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                          <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                            <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Source asset id</div>
                            <div className="mt-2 break-all text-sm text-white">{detailValue(upload.sourceAssetId)}</div>
                          </div>
                          <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                            <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Source export id</div>
                            <div className="mt-2 break-all text-sm text-white">{detailValue(upload.sourceExportId)}</div>
                          </div>
                          <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                            <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Output asset id</div>
                            <div className="mt-2 break-all text-sm text-white">{detailValue(upload.outputAssetId)}</div>
                          </div>
                          <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                            <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Result privacy</div>
                            <div className="mt-2 text-sm text-white">{detailValue(upload.result.privacyStatus)}</div>
                          </div>
                        </div>

                        {upload.result.failureReason || upload.result.rejectionReason ? (
                          <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-50/85">
                            {upload.result.failureReason || upload.result.rejectionReason}
                          </div>
                        ) : null}

                        <div className="flex flex-wrap items-center gap-2">
                          <Button asChild variant="outline" className="border-white/10 bg-white/5 text-white hover:bg-white/10">
                            <Link href={newPublishHref}>
                              <Plus className="mr-2 h-4 w-4" />
                              New publish
                            </Link>
                          </Button>
                          <Button asChild variant="outline" className="border-white/10 bg-white/5 text-white hover:bg-white/10">
                            <a href={upload.watchUrl} target="_blank" rel="noreferrer">
                              Watch page
                              <ExternalLink className="ml-2 h-4 w-4" />
                            </a>
                          </Button>
                          <Button asChild className="bg-white text-black hover:bg-zinc-100">
                            <a href={upload.studioUrl} target="_blank" rel="noreferrer">
                              <RadioTower className="mr-2 h-4 w-4" />
                              Open in Studio
                              <ChevronRight className="ml-2 h-4 w-4" />
                            </a>
                          </Button>
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
