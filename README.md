# ClipScribe

ClipScribe is an AI-driven creator workstation for turning raw video and audio into transcripts, subtitled shorts, voiceovers, timeline edits, and YouTube-ready packages.

It is built around a connected content workflow where AI helps drive repurposing, packaging, editing, and publishing instead of being treated as an isolated text-generation feature.

## What ClipScribe Does

- Imports creator source material from local files or YouTube into a project-centered workspace. 🎬
- Runs AI-driven transcription, subtitle, and content packaging workflows inside a unified creator workspace. 🤖
- Generates YouTube metadata, title ideas, content packs, and viral short suggestions with Creator AI. ✍️
- Provides a dedicated shorts workflow with framing, subtitle styling, overlays, and export diagnostics. 📱
- Includes a multi-track timeline editor for more deliberate editing and rendering workflows. 🎞️
- Generates AI voiceovers with ElevenLabs and stores them as reusable project assets. 🎙️
- Publishes videos to YouTube with draft assembly, localization support, captions, thumbnails, and upload history. 🚀

## Product Walkthrough

### 1. Project Library + Assets 📚

The project library is the starting point for the whole workflow. It gives creators a clean entry point for ingesting source material, organizing active work, and turning uploaded media into structured project assets that can later feed transcripts, shorts, voiceovers, and exports.

- Drag-and-drop project creation from local media files.
- Import from YouTube URL into a normalized project asset.
- Active source selection and project-scoped asset management.
- Centralized view of source assets, derived media, and exports.

![Project Library](docs/readme/proyect_library_1.png)
![Project Library](docs/readme/proyect_library_2.png)
![Project Library](docs/readme/proyect_library_3.png)

### 2. Transcripts 🧩

Transcription is one of the foundations of the product because it turns raw media into structured, time-aware content that the rest of the platform can reuse. ClipScribe runs transcription through Transformers.js using timestamped Whisper variants, preferring `onnx-community/whisper-base_timestamped` and falling back to `onnx-community/whisper-tiny_timestamped`, with word-level timestamps enabled.

- Background transcription with status and progress handling.
- Transcript versioning and subtitle generation from project history.
- Translation workflows for multilingual subtitle outputs.
- Word-level timestamps unlock features such as subtitle generation, precise seeking, timed clip extraction, and transcript-aware short suggestions.

<!-- Replace with screenshot: Transcript workflow and timed transcript view -->

![Transcripts and timed transcript workflow](docs/readme/transcript_1.png)
![Transcripts and timed transcript workflow](docs/readme/transcript_2.png)

### 3. Timeline Studio 🎞️

ClipScribe also includes a more explicit editing environment for creators who need more control than an AI-first short workflow provides. Timeline Studio expands the project into a multi-track editor with trimming, layout control, overlays, and export settings.

- Multi-track editing for video, audio, images, captions, and overlays.
- Aspect ratio control for common creator output formats.
- Export settings for resolution and rendering strategy.
- Built to support more deliberate composition than the quick shorts flow.

<!-- Replace with screenshot: Timeline Studio editor -->

![Timeline Studio editor](docs/readme/timeline_editor_1.png)

### 4. Creator AI Metadata ✨

The metadata workflow is built for packaging long-form content, not just generating generic text. It can assemble titles, descriptions, hashtags, chapters, thumbnail hooks, and richer content-pack outputs while exposing prompt customization depth that feels productized rather than bolted on.

- AI generation for title ideas, descriptions, hashtags, chapters, pinned comments, and insights.
- Feature-specific prompt customization rather than a single generic text box.
- Per-feature model configuration routed through the shared Creator AI runtime.
- Designed for repeatable packaging workflows across multiple videos.

<!-- Replace with screenshot: Creator AI metadata studio -->

![Creator AI metadata studio](docs/readme/metadata_1.png)
![Creator AI metadata studio](docs/readme/metadata_2.png)

### 5. Shorts Forge 🔥

The shorts workflow focuses on repurposing a longer source into platform-native short-form content. Instead of stopping at clip suggestions, it carries the creator into framing, subtitles, overlay styling, and reusable short project states.

- Viral clip suggestion generation from transcript-aware inputs.
- Dedicated short editor with framing controls and creative tuning.
- Subtitle style controls and text overlay customization.
- Export-ready previews with diagnostics and rendering progress.
- Saved shorts library so generated ideas can become durable assets.

<!-- Replace with screenshot: Shorts Forge clip workflow -->

![Shorts Forge clip workflow](docs/readme/shorts_1.png)
![Shorts Forge clip workflow](docs/readme/shorts_2.png)
![Shorts Forge clip workflow](docs/readme/shorts_3.png)

### 6. Voiceover Workspace 🎙️

The voiceover workflow extends the platform beyond transcription and editing into AI-generated narration. It supports script drafting, usage estimation, generation, replay, and reuse of voice outputs as first-class project assets.

- ElevenLabs-powered voiceover generation from editable scripts.
- Draft persistence and configuration-aware generation flow.
- Cost and usage estimation surfaced in the UI.
- Generated audio saved back into the project for reuse elsewhere.

<!-- Replace with screenshot: Voiceover workspace -->

![Voiceover workspace](docs/readme/voiceover_1.png)
![Voiceover workspace](docs/readme/voiceover_2.png)

### 7. YouTube Publish 📡

Publishing is treated as part of the product, not an afterthought. ClipScribe can turn project assets or exports into YouTube-ready drafts, help prefill metadata from prior AI runs, and track the history of completed uploads.

- Publish drafts for shorts or standard videos.
- Metadata prefills from AI metadata and short suggestion outputs.
- Support for captions, localizations, thumbnails, and related metadata.
- Upload history view so publishing remains part of the project record.

<!-- Replace with screenshot: YouTube publish workflow -->

![YouTube publish workflow](docs/readme/publish_1.png)
![YouTube publish workflow](docs/readme/publish_2.png)
![YouTube publish workflow](docs/readme/publish_3.png)
![YouTube publish workflow](docs/readme/publish_4.png)
![YouTube publish workflow](docs/readme/publish_5.png)
![YouTube publish workflow](docs/readme/publish_6.png)

## Stack And Integrations 🧱

### Frontend / Platform

- Next.js 16
- React 19
- Tailwind CSS 4
- shadcn/ui
- Dexie.js for client-side persistence

### Media / Rendering

- FFmpeg WASM for interactive media workflows
- Bundled `ffmpeg` / `ffprobe` for CLI and system export flows
- Custom media, subtitle, framing, and export utilities

### AI / Runtime

- Transformers.js with worker-based transcription and translation pipelines
- Shared Creator AI runtime for provider/model selection, tracing, usage, and pricing
- Feature-specific prompt pipelines for `shorts` and `video_info`
- ElevenLabs integration for voiceover generation

### Integrations

| Integration                                                            | Purpose                                       | Runtime |
| ---------------------------------------------------------------------- | --------------------------------------------- | ------- |
| `onnx-community/whisper-base_timestamped` / `whisper-tiny_timestamped` | Transcription with word-level timestamps      | Client  |
| `Xenova/opus-mt-*`                                                     | Subtitle translation                          | Client  |
| OpenAI API                                                             | Creator AI text generation (`video_info`)     | Server  |
| Gemini API                                                             | Creator AI text generation (`shorts` default) | Server  |
| ElevenLabs API                                                         | Voiceover / TTS                               | Server  |
| YouTube Data API v3                                                    | Video publishing                              | Server  |

## AI Run Evals 🧪

ClipScribe treats AI outputs as product-critical artifacts, so Creator AI runs are evaluated and traced instead of being handled as opaque API calls.

- Every tracked AI run records provider, model, prompt version, token usage, API key source, input summary, and estimated cost when inferable.
- Eval coverage checks both OpenAI and Gemini paths so provider migrations do not silently break metadata or shorts workflows.
- Regression tests verify that prompt versions, usage parsing, pricing metadata, and stored run records remain auditable over time.
- The AI runs workbench makes generation history inspectable, helping debug prompt changes and compare outputs across models.

![AI Runs Workbench](docs/readme/ai_runs_workbench_1.png)
![AI Runs Workbench](docs/readme/ai_runs_workbench_2.png)
![AI Runs Workbench](docs/readme/ai_runs_workbench_3.png)

## Getting Started 🚀

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment Variables 🔐

Copy `.env.example` to `.env.local` and configure only the integrations you need.

```env
# Debug
NEXT_PUBLIC_ENABLE_LOGS=true

# Creator AI
OPENAI_API_KEY=
GEMINI_API_KEY=
CREATOR_SHORTS_PROVIDER=gemini
CREATOR_SHORTS_MODEL=gemini-2.5-flash
CREATOR_SHORTS_TEMPERATURE=0.4
CREATOR_VIDEO_INFO_PROVIDER=openai
CREATOR_VIDEO_INFO_MODEL=gpt-4.1-mini
CREATOR_VIDEO_INFO_TEMPERATURE=0.4

# YouTube Publish
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
YOUTUBE_SESSION_SECRET=

# ElevenLabs Voiceover
ELEVEN_LABS_APY_KEY=
ELEVEN_LABS_VOICE_ID=
EVELEN_LABS_MODEL=
```

## CLI And Power Features 🛠️

Beyond the main UI, ClipScribe includes CLI workflows for automation, repeatable rendering, and batch-friendly project creation.

### Create a timeline project

```bash
npm run create:timeline-project -- --interactive
```

```bash
npm run create:timeline-project -- \
  --name "My Short" \
  --aspect 9:16 \
  --video ./clip.mp4 \
  --audio ./music.mp3 \
  --output ./projects
```

### Import and export a timeline project

```bash
npm run import:timeline-project -- --bundle ./projects/my-short.clipscribe-project
npm run export:timeline-project -- --project ./projects/my-short.clipscribe-project --resolution 1080p --output ./exports
```

### Create and export in one step

```bash
npm run create-and-export:timeline-project
```

## License

MIT
