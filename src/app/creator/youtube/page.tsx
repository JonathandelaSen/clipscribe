import { redirect } from "next/navigation";

export default async function CreatorYouTubePage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string; exportId?: string }>;
}) {
  const params = await searchParams;
  const projectId = params.projectId?.trim();
  const exportId = params.exportId?.trim();

  if (projectId) {
    const target = new URLSearchParams({ tab: "publish" });
    if (exportId) {
      target.set("exportId", exportId);
    }
    redirect(`/projects/${encodeURIComponent(projectId)}?${target.toString()}`);
  }

  redirect("/");
}
