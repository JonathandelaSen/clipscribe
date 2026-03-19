"use client";

import { useParams } from "next/navigation";

import { ProjectWorkspace } from "@/components/projects/ProjectWorkspace";

export default function ProjectWorkspacePage() {
  const params = useParams<{ projectId: string }>();
  return <ProjectWorkspace projectId={params.projectId} />;
}
