"use client";

import { useParams } from "next/navigation";

import { TimelineEditorWorkspace } from "@/components/editor/TimelineEditorWorkspace";

export default function CreatorEditorProjectPage() {
  const params = useParams<{ projectId: string }>();
  return <TimelineEditorWorkspace projectId={params.projectId} />;
}
