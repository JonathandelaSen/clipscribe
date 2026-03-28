import { redirect } from "next/navigation";

export default async function CreatorYouTubePage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string; assetId?: string; exportId?: string }>;
}) {
  const params = await searchParams;
  const projectId = params.projectId?.trim();
  const assetId = params.assetId?.trim();
  const exportId = params.exportId?.trim();

  if (projectId) {
    const target = new URLSearchParams({ tab: "publish" });
    if (assetId) {
      target.set("view", "new");
      target.set("assetId", assetId);
    }
    if (exportId) {
      target.set("view", "new");
      target.set("exportId", exportId);
    }
    redirect(`/projects/${encodeURIComponent(projectId)}?${target.toString()}`);
  }

  redirect("/");
}
