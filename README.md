# ClipScribe

<div align="center">
  <img src="./docs/creator_hub.png" alt="Main Screen" width="80%" />
</div>

<div align="center">
  <img src="./docs/creator_shorts.png" alt="Video Info Studio Screen" width="30%" />
  <img src="./docs/creator_video_info.png" alt="Creator Hub Screen" width="30%" />
  <img src="./docs/creator_shorts_export.png" alt="Shorts Forge Screen" width="30%" />
</div>

A modern, privacy-first web application built with [Next.js](http://nextjs.org) that lets you drag and drop audio and video files for local transcription, subtitle workflows, and short-form clip creation. ClipScribe keeps the entire process in the browser so your media stays on your device.

The application leverages a local Web Worker and client-side processing via Transformers.js for transcriptions, and FFmpeg WASM for video manipulation, ensuring efficient, private, and fast execution directly on your device.

<img src="./docs/app_recording.gif" alt="App Recording" width="100%" />

## Key Features

- 🔒 **100% Private (Local Processing)**: Audio transcription is handled directly in your browser. No data is ever sent to a remote server or API. Fast, secure, and zero server-side costs.
- 🌍 **Language Auto-Detection & Selector**: By default, the app automatically detects the spoken language. You can also explicitly set the language (Spanish, English, French, and 8 more) using the built-in selector for higher accuracy.
- ⚡ **Real-time Progress**: View the transcription status and partial results live while the neural model is processing.
- ⏸️ **Cancellable Jobs**: Safely stop processing large files mid-way using the Stop Transcription button.
- 🗃️ **Persistent History**: Your past transcriptions are automatically saved to `localStorage` so you can review them after refreshing or returning to the app later.
- 🌐 **Subtitle Translation**: Translate your `.srt` subtitles into 10 different target languages entirely client-side using lightweight Web Workers and dynamically downloaded models.
- 💾 **Export & Downloads**: Download your generated transcripts as plain text (`.txt`) or as SubRip Subtitles (`.srt`) out of the box. Both features are available inline and in the History tab.
- 📋 **One-Click Copying**: Easily copy full transcripts or subtitles with integrated clipboard buttons.
- 🎬 **Video Support & FFmpeg Rendering**: Drop in video files directly. The app processes them locally and can export edited short-form video clips right from your browser via FFmpeg WASM.
- ✂️ **Built-in Clip Editor**: A comprehensive local video editor tailored for short-form content. Features include trimming, pan/zoom framing, customizable subtitle positioning, and safe-zone overlays for platforms like TikTok, YouTube Shorts, and Instagram Reels.
- 🤖 **Creator AI Tools**: Automatically generate title ideas, SEO descriptions, chapters, and identify "viral clips" from transcripts to effortlessly repurpose long-form content.
- 🎨 **Visual Subtitles**: Render dynamic subtitles with configurable styles and precise time shifting directly onto video exports.

## NLP Models

This project strictly adheres to a local-first philosophy. To achieve this within the memory limits of a web browser, we use specific quantized ONNX models via Transformers.js:

- **Transcription:** Uses `Xenova/whisper-tiny` for fast, lightweight english transcription.
- **Translation:** Uses targeted `Xenova/opus-mt-{src}-{tgt}` models from Helsinki-NLP. Instead of loading a massive 600M+ parameter universal translation model (which crashes browsers with 1GB+ KV cache buffers), we dynamically fetch ~75MB models specific _only_ to the source and target language pair you select. These models are cached in your browser's IndexedDB for instant, offline reuse.

## Environment Variables

To enable the raw debug logs interface on the main screen (useful for observing the underlying Web Worker message stream), create a `.env.local` file in the root directory and add the following:

```env
NEXT_PUBLIC_ENABLE_LOGS=true
```

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS & shadcn/ui
- **Icons**: Lucide React
- **ML Engine**: Hugging Face Transformers.js (Whisper model)
- **Local Media Processing**: FFmpeg WASM (`@ffmpeg/ffmpeg`)
- **State/Persistence**: React Hooks, LocalStorage, & Dexie.js (IndexedDB)

## Getting Started

First, install the dependencies:

```bash
npm install
# or
yarn install
# or
pnpm install
```

Then, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the application.

## CLI Timeline Bundles

You can create an importable Timeline Studio bundle from the terminal and then import it from the editor project library.

Interactive wizard:

```bash
npm run create:timeline-project -- --interactive
```

Direct command:

```bash
npm run create:timeline-project -- \
  --name "Launch Cut" \
  --aspect 9:16 \
  --video /absolute/path/intro.mp4 \
  --video /absolute/path/outro.mp4 \
  --reverse 2 \
  --video-trim 1:1.5:4.25 \
  --audio /absolute/path/bed.mp3 \
  --audio-start 2.5 \
  --output ./bundles
```

This creates a folder such as `launch-cut.clipscribe-project/` with `manifest.json` and a `media/` directory. In Timeline Studio, use `Import Bundle` from the project library and select that folder to create a saved local project.

For an agent-friendly terminal workflow, turn the bundle into an editable workspace file and then export it back to MP4:

```bash
npm run import:timeline-project -- \
  --bundle ./bundles/launch-cut.clipscribe-project
```

This writes `project.json` into the bundle folder. An agent can inspect or edit that file and then export it:

```bash
npm run export:timeline-project -- \
  --project ./bundles/launch-cut.clipscribe-project \
  --resolution 1080p
```

The export command writes the final MP4 to `exports/<project-name>__<aspect>__<resolution>.mp4` inside the workspace by default. Use `--dry-run` to preview the render plan, `--output` to choose another destination, and `--json` for machine-readable CLI output.

## Vibe Coding

This project was intentionally built using an AI-assisted development approach, where the architecture, design, and code were **vibe coded with Gemini Pro 3.1**.

## License

This project is open-source and available under the MIT License.
