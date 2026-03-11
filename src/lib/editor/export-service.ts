import { exportEditorProjectLocally, type LocalEditorExportInput, type LocalEditorExportResult } from "@/lib/editor/local-render";

export interface EditorExportService {
  exportProject(input: LocalEditorExportInput): Promise<LocalEditorExportResult>;
}

export const localEditorExportService: EditorExportService = {
  exportProject(input) {
    return exportEditorProjectLocally(input);
  },
};
