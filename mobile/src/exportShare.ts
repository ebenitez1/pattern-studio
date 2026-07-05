/**
 * Backend export → local cache file → native share sheet.
 *
 * The shared-core client returns a Blob; React Native Blobs support
 * FileReader, so we go Blob → base64 data-URL → base64 payload → cache file.
 * Uses the legacy expo-file-system API (expo-file-system/legacy) for its
 * simple base64 string writes.
 */
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import {
  buildExportRequest,
  EXPORT_MIME,
  exportFileName,
  type CellProgress,
  type ExportFormat,
  type FilterState,
} from "@pattern-studio/core";
import { apiClient } from "./api";

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.onloadend = () => {
      const dataUrl = String(reader.result ?? "");
      const comma = dataUrl.indexOf(",");
      if (comma < 0) {
        reject(new Error("Unexpected FileReader result"));
        return;
      }
      resolve(dataUrl.slice(comma + 1));
    };
    reader.readAsDataURL(blob);
  });
}

export function sharingAvailable(): Promise<boolean> {
  return Sharing.isAvailableAsync();
}

/**
 * Export the pattern in the given format and hand it to the share sheet.
 * Requires a backend job id (projects imported without one cannot re-export).
 */
export async function exportAndShare(args: {
  jobId: string;
  projectName: string;
  format: ExportFormat;
  filter: FilterState;
  progress: Record<string, CellProgress>;
}): Promise<void> {
  const { jobId, projectName, format, filter, progress } = args;
  const blob = await apiClient.export(
    jobId,
    buildExportRequest(format, filter, progress),
  );
  const base64 = await blobToBase64(blob);
  const fileUri = `${FileSystem.cacheDirectory ?? ""}${exportFileName(projectName, format)}`;
  await FileSystem.writeAsStringAsync(fileUri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  await Sharing.shareAsync(fileUri, {
    mimeType: EXPORT_MIME[format],
    dialogTitle: `Export ${projectName}`,
  });
}
