import { redirect } from "next/navigation";

export default function CreatorEditorProjectPage({
  params,
}: {
  params: { projectId: string };
}) {
  const { projectId } = params;
  redirect(`/projects/${projectId}?tab=timeline`);
}
