"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { 
  CalendarClock,
  ChevronLeft, 
  ChevronRight, 
  FolderKanban, 
  Film, 
  Languages, 
  Clapperboard, 
  Scissors, 
  Download,
  Upload
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BackgroundTasksButton } from "@/components/tasks/BackgroundTasksButton";
import { useProjectLibrary } from "@/hooks/useProjectLibrary";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { projects } = useProjectLibrary();

  // Extract projectId if we are inside a project
  const match = pathname.match(/^\/projects\/([^\/]+)/);
  const projectId = match ? match[1] : null;
  const currentTab = searchParams.get("tab") || "assets";

  const isProjectView = !!projectId;
  const isAiRunsView = pathname === "/creator/runs";

  const projectLinks = [
    { id: "assets", label: "Assets", icon: Film },
    { id: "transcripts", label: "Transcripts", icon: Languages },
    { id: "shorts", label: "Shorts", icon: Clapperboard },
    { id: "timeline", label: "Editor", icon: Scissors },
    { id: "publish", label: "Publish", icon: Upload },
    { id: "exports", label: "Exports", icon: Download },
  ];

  return (
    <div className="flex min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.18),transparent_28%),radial-gradient(circle_at_top_right,rgba(251,146,60,0.14),transparent_24%),linear-gradient(180deg,#03060c,#090f18_48%,#03060c)] text-white font-sans">
      {/* Sidebar */}
      <aside
        className={cn(
          "sticky top-0 h-screen flex flex-col border-r border-white/10 bg-black/40 backdrop-blur-xl transition-all duration-300 ease-in-out z-20",
          isCollapsed ? "w-[72px]" : "w-64"
        )}
      >
        <div className="flex h-16 items-center justify-between px-4 border-b border-white/5">
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="flex h-8 w-8 min-w-8 items-center justify-center rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 text-white shadow-lg">
              <Film className="h-4 w-4" />
            </div>
            {!isCollapsed && (
              <span className="text-lg font-semibold tracking-tight text-white/90 whitespace-nowrap">
                ClipScribe
              </span>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-6 px-3 flex flex-col gap-6">
          <nav className="space-y-1">
            <div className={cn("px-2 mb-2 text-[11px] font-medium uppercase tracking-[0.2em] text-white/40", isCollapsed && "sr-only")}>
              Main Menu
            </div>
            <Link
              href="/"
              className={cn(
                "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                !isProjectView && !isAiRunsView 
                  ? "bg-white/10 text-white" 
                  : "text-white/60 hover:bg-white/5 hover:text-white"
              )}
            >
              <FolderKanban className={cn("h-5 w-5", !isProjectView && !isAiRunsView ? "text-cyan-400" : "text-white/50 group-hover:text-white")} />
              {!isCollapsed && <span>Library</span>}
            </Link>
            <Link
              href="/creator/runs"
              className={cn(
                "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                isAiRunsView
                  ? "bg-white/10 text-white"
                  : "text-white/60 hover:bg-white/5 hover:text-white"
              )}
            >
              <CalendarClock className={cn("h-5 w-5", isAiRunsView ? "text-cyan-400" : "text-white/50 group-hover:text-white")} />
              {!isCollapsed && <span>AI Runs</span>}
            </Link>
          </nav>

          {isProjectView && (
            <nav className="space-y-1">
              <div className={cn("px-2 mb-2 text-[11px] font-medium uppercase tracking-[0.2em] text-cyan-400/60", isCollapsed && "sr-only")}>
                Project Context
              </div>
              {projectLinks.map((link) => {
                const isActive = currentTab === link.id;
                const Icon = link.icon;
                return (
                  <Link
                    key={link.id}
                    href={`/projects/${projectId}?tab=${link.id}`}
                    className={cn(
                      "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
                      isActive
                        ? "bg-cyan-500/10 text-cyan-50 border border-cyan-500/20 shadow-[0_0_15px_rgba(6,182,212,0.1)]"
                        : "text-white/60 hover:bg-white/5 hover:text-white border border-transparent"
                    )}
                  >
                    <Icon className={cn("h-5 w-5", isActive ? "text-cyan-400" : "text-white/50 group-hover:text-white")} />
                    {!isCollapsed && <span>{link.label}</span>}
                  </Link>
                );
              })}
            </nav>
          )}
        </div>

        <div className="p-3 border-t border-white/5 flex flex-col gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="w-full h-10 rounded-xl text-white/50 hover:bg-white/5 hover:text-white justify-center"
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isCollapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
          </Button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Topbar */}
        <header className="h-16 shrink-0 flex items-center justify-between px-6 border-b border-white/5 bg-black/20 backdrop-blur-md z-10">
          <div className="flex items-center gap-4">
            {isProjectView && projectId ? (
              <Select value={projectId} onValueChange={(val) => router.push(`/projects/${val}?tab=${currentTab}`)}>
                 <SelectTrigger className="w-[300px] h-8 px-2 bg-transparent border-none text-sm font-medium text-white/70 hover:text-white hover:bg-white/5 data-[state=open]:bg-white/5 focus:ring-0 shadow-none">
                   <div className="flex items-center gap-2">
                     <FolderKanban className="w-4 h-4 text-cyan-400" />
                     <SelectValue placeholder="Project Workspace" />
                   </div>
                 </SelectTrigger>
                 <SelectContent className="bg-zinc-950 border-white/10 text-white">
                   {projects.length === 0 ? (
                     <SelectItem value={projectId} disabled>Loading projects...</SelectItem>
                   ) : (
                     projects.map((p) => p.id ? (
                       <SelectItem key={p.id} value={p.id} className="cursor-pointer focus:bg-cyan-500/20">{p.name || "Untitled Project"}</SelectItem>
                     ) : null)
                   )}
                 </SelectContent>
              </Select>
            ) : isAiRunsView ? (
              <h2 className="text-sm font-medium text-white/70 px-2 flex items-center gap-2 h-8">
                <CalendarClock className="w-4 h-4 text-cyan-400" /> AI Runs Workbench
              </h2>
            ) : (
              <h2 className="text-sm font-medium text-white/70 px-2 flex items-center gap-2 h-8">
                <FolderKanban className="w-4 h-4 text-cyan-400" /> Dashboard Overview
              </h2>
            )}
          </div>
          <div className="flex items-center gap-3">
            <BackgroundTasksButton />
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
