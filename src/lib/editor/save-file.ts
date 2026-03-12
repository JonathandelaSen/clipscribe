export interface EditorSaveFileStream {
  write(data: Blob | BufferSource | string): Promise<void>;
  close(): Promise<void>;
}

export interface EditorSaveFileHandle {
  name: string;
  createWritable(): Promise<EditorSaveFileStream>;
}

interface SaveFilePickerOptionType {
  description?: string;
  accept: Record<string, string[]>;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  excludeAcceptAllOption?: boolean;
  types?: SaveFilePickerOptionType[];
}

type SaveFilePickerWindow = Window & {
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<EditorSaveFileHandle>;
};

export function isEditorSavePickerSupported() {
  return typeof window !== "undefined" && typeof (window as SaveFilePickerWindow).showSaveFilePicker === "function";
}

export async function pickEditorSaveFileHandle(suggestedName: string): Promise<EditorSaveFileHandle | null> {
  const pickerWindow = window as SaveFilePickerWindow;
  if (typeof pickerWindow.showSaveFilePicker !== "function") {
    throw new Error("This browser does not support choosing an export destination.");
  }

  try {
    return await pickerWindow.showSaveFilePicker({
      suggestedName,
      excludeAcceptAllOption: true,
      types: [
        {
          description: "MP4 Video",
          accept: {
            "video/mp4": [".mp4"],
          },
        },
      ],
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return null;
    }
    throw error;
  }
}

export async function writeBlobToEditorSaveFileHandle(
  handle: EditorSaveFileHandle,
  blob: Blob | File
): Promise<void> {
  const writable = await handle.createWritable();
  try {
    await writable.write(blob);
  } finally {
    await writable.close();
  }
}
