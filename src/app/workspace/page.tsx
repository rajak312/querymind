import type { Metadata } from "next";
import { WorkspaceLoader } from "./workspace-loader";

export const metadata: Metadata = { title: "Workspace" };

export default async function WorkspacePage({ searchParams }: PageProps<"/workspace">) {
  const { dataset } = await searchParams;
  return <WorkspaceLoader initialDatasetId={typeof dataset === "string" ? dataset : undefined} />;
}
