import Link from "next/link";
import { FileText, Clapperboard, ArrowRight, Sparkles, ArrowLeft, Film } from "lucide-react";

import { cn } from "@/lib/utils";

const TOOLS = [
  {
    title: "Video Info Studio",
    description: "Generate titles, descriptions, chapters, and SEO blocks from your transcript.",
    href: "/creator/video-info",
    icon: FileText,
    color: "text-blue-400",
    bgColor: "bg-blue-400/10",
    borderColor: "border-blue-400/20",
    glowColor: "group-hover:bg-blue-500/10",
  },
  {
    title: "Shorts Forge",
    description: "Find clip candidates, edit vertical framing, and export shorts.",
    href: "/creator/shorts",
    icon: Clapperboard,
    color: "text-orange-400",
    bgColor: "bg-orange-400/10",
    borderColor: "border-orange-400/20",
    glowColor: "group-hover:bg-orange-500/10",
  },
  {
    title: "Timeline Studio",
    description: "Build full timeline projects with clips, a ripple audio track, subtitles, and exports.",
    href: "/creator/editor",
    icon: Film,
    color: "text-cyan-300",
    bgColor: "bg-cyan-300/10",
    borderColor: "border-cyan-300/20",
    glowColor: "group-hover:bg-cyan-400/10",
  },
] as const;

export default function CreatorPage() {
  return (
    <main className="min-h-[calc(100vh-[var(--header-height)])] relative flex flex-col p-4 sm:p-8 lg:p-12 overflow-hidden bg-zinc-950">
      
      {/* Top Navigation */}
      <div className="w-full max-w-5xl mx-auto mb-8 relative z-20">
        <Link 
          href="/"
          className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Home
        </Link>
      </div>

      {/* Background ambient light */}
      <div className="absolute inset-0 z-0 bg-zinc-950" />
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full bg-indigo-500/10 blur-[120px] pointer-events-none z-0" />

      <div className="flex-1 flex flex-col justify-center relative z-10 max-w-5xl w-full mx-auto space-y-12">
        
        {/* Header Section */}
        <header className="flex flex-col items-center text-center space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-white/10 bg-white/[0.03] text-sm text-zinc-300 backdrop-blur-sm relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/10 to-purple-500/10" />
            <Sparkles className="w-4 h-4 text-indigo-400" />
            <span className="relative z-10 font-medium">ClipScribe Creator Tools</span>
          </div>
          
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-white">
            Supercharge your workflow
          </h1>
          
          <p className="max-w-2xl text-base sm:text-lg text-zinc-400">
            A suite of AI-powered utilities designed to help you extract maximum value from your content. From smart clip detection to SEO generation.
          </p>
        </header>

        {/* Tools Grid */}
        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 pb-20">
          {TOOLS.map((tool) => {
            const Icon = tool.icon;
            return (
              <Link 
                key={tool.href} 
                href={tool.href}
                className="group relative block focus:outline-none focus:ring-2 focus:ring-indigo-500/50 rounded-3xl transition-transform duration-300 hover:-translate-y-1"
              >
                {/* Glow Effect Layer */}
                <div className={cn(
                  "absolute inset-0 rounded-3xl blur-xl opacity-0 transition-opacity duration-500",
                  tool.glowColor,
                  "group-hover:opacity-100"
                )} />

                {/* Card Main Layer */}
                <div className="relative h-full flex flex-col rounded-3xl border border-white/5 bg-white/[0.02] backdrop-blur-xl p-8 sm:p-10 transition-colors duration-300 group-hover:border-white/10 group-hover:bg-white/[0.05]">
                  
                  {/* Icon Container */}
                  <div className={cn(
                    "inline-flex items-center justify-center rounded-2xl p-4 w-16 h-16 mb-8 border transition-transform duration-300 group-hover:scale-110",
                    tool.bgColor,
                    tool.color,
                    tool.borderColor
                  )}>
                    <Icon className="w-8 h-8" />
                  </div>

                  <div className="flex-1 flex flex-col justify-end">
                    <h2 className="text-2xl font-semibold text-white mb-3 flex items-center gap-3">
                      {tool.title}
                      <ArrowRight className="w-5 h-5 opacity-0 -translate-x-4 transition-all duration-300 group-hover:opacity-100 group-hover:translate-x-0 text-zinc-400" />
                    </h2>
                    <p className="text-zinc-400 leading-relaxed text-sm sm:text-base">
                      {tool.description}
                    </p>
                  </div>
                </div>
              </Link>
            );
          })}
        </section>
        
      </div>
    </main>
  );
}
