export function formatTime(seconds: number): string {
    const pad = (num: number, size: number) => ('000' + num).slice(-size);
    const date = new Date(seconds * 1000);
    const hours = date.getUTCHours();
    const minutes = date.getUTCMinutes();
    const secs = date.getUTCSeconds();
    const ms = date.getUTCMilliseconds();
    return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(secs, 2)},${pad(ms, 3)}`;
}

type SrtChunk = {
    text: string;
    timestamp: [number | null, number | null];
};

export function generateSrt(chunks: SrtChunk[]): string {
    if (!chunks || chunks.length === 0) return "";
    return chunks.map((chunk, index) => {
        const startSeconds = chunk.timestamp[0] ?? 0;
        const endSeconds = chunk.timestamp[1] ?? startSeconds + 5;
        const start = formatTime(startSeconds);
        // Provide a fallback for the end time if it's missing (e.g. streaming last chunk)
        const end = formatTime(endSeconds);
        return `${index + 1}\n${start} --> ${end}\n${chunk.text.trim()}\n`;
    }).join('\n');
}

function parseTimecode(value: string): number {
    const match = value.trim().match(/^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/);
    if (!match) return 0;
    const [, hours, minutes, seconds, millis] = match;
    return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(millis) / 1000;
}

export function parseSrt(text: string) {
    return String(text || "")
        .trim()
        .split(/\r?\n\r?\n/)
        .map((block) => block.trim())
        .filter(Boolean)
        .flatMap((block) => {
            const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
            if (lines.length < 2) return [];
            const timeLine = lines[1].includes("-->") ? lines[1] : lines[0];
            const textStartIndex = lines[1].includes("-->") ? 2 : 1;
            const [startRaw, endRaw] = timeLine.split(/\s+-->\s+/);
            if (!startRaw || !endRaw) return [];
            return [{
                text: lines.slice(textStartIndex).join(" ").trim(),
                timestamp: [parseTimecode(startRaw), parseTimecode(endRaw)] as [number, number],
            }];
        });
}
