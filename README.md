# ClipScribe

A local-first web application built with Next.js for audio/video transcription, subtitle workflows, short-form clip creation, and AI-assisted content repurposing.

## Key Features

- Local audio/video transcription (browser-side, no data leaves your device)
- Language auto-detection and manual selector (11 languages)
- Real-time progress and cancellable jobs
- Persistent transcription history (localStorage)
- Subtitle translation (client-side, 10 target languages)
- Export as `.txt` or `.srt`, one-click clipboard copy
- Video import and local FFmpeg WASM rendering
- Timeline Studio: multi-track editor with trimming, pan/zoom, safe-zone overlays, and local export
- Creator AI: auto-generate titles, SEO descriptions, chapters, and viral clip suggestions from transcripts
- Visual subtitles with configurable styles and time shifting
- YouTube upload via OAuth integration
- Voiceover generation via ElevenLabs TTS

## Models & APIs

| Integration | Purpose | Runtime |
|---|---|---|
| `Xenova/whisper-tiny` (Transformers.js) | Transcription | Client (Web Worker) |
| `Xenova/opus-mt-*` (Transformers.js) | Subtitle translation | Client (Web Worker) |
| OpenAI API | Creator AI text generation | Server |
| Gemini API | Creator AI text generation | Server |
| ElevenLabs API | Voiceover / TTS | Server |
| YouTube Data API v3 | Video publishing | Server (OAuth) |

## Environment Variables

Copy `.env.example` to `.env.local` and fill in the values you need:

```env
# Debug
NEXT_PUBLIC_ENABLE_LOGS=true

# Creator AI providers
OPENAI_API_KEY=
GEMINI_API_KEY=

# Creator AI feature defaults
CREATOR_SHORTS_PROVIDER=gemini
CREATOR_SHORTS_MODEL=gemini-2.5-flash
CREATOR_SHORTS_TEMPERATURE=0.4
CREATOR_VIDEO_INFO_PROVIDER=openai
CREATOR_VIDEO_INFO_MODEL=gpt-4.1-mini
CREATOR_VIDEO_INFO_TEMPERATURE=0.4

# YouTube Publish (Google OAuth)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
YOUTUBE_SESSION_SECRET=

# ElevenLabs TTS
ELEVEN_LABS_APY_KEY=
ELEVEN_LABS_VOICE_ID=
EVELEN_LABS_MODEL=
```

## Tech Stack

Next.js 16 · Tailwind CSS 4 · shadcn/ui · Lucide React · Transformers.js · FFmpeg WASM · Dexie.js · ElevenLabs SDK

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## CLI

The CLI automates timeline project creation and video rendering using bundled `ffmpeg`/`ffprobe`.

### Create a timeline project

```bash
# Interactive wizard
npm run create:timeline-project -- --interactive

# Direct
npm run create:timeline-project -- \
  --name "My Short" --aspect 9:16 \
  --video ./clip.mp4 --audio ./music.mp3 \
  --output ./projects
```

Flags: `--video`, `--video-trim`, `--video-volume`, `--video-muted`, `--reverse`, `--video-clone-to-fill`, `--audio-trim-final-to-video`.

### Import / Export

```bash
npm run import:timeline-project -- --bundle ./projects/my-short.clipscribe-project
npm run export:timeline-project -- --project ./projects/my-short.clipscribe-project --resolution 1080p --output ./exports
```

Export flags: `--resolution <480p|720p|1080p|4k>`, `--dry-run`, `--json`.

### Create & export in one step

```bash
npm run create-and-export:timeline-project
```

## License

MIT
