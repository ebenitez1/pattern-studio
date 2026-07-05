/**
 * "New Project" source pickers + upload/processing pipeline.
 *
 * All three sources funnel into a { uri, name, type } descriptor that the
 * shared-core PatternApiClient appends to FormData the React Native way.
 */
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import type { GridData, JobStatus } from "@pattern-studio/core";
import { apiClient } from "./api";

export interface PickedFile {
  uri: string;
  name: string;
  type: string;
}

function nameFromUri(uri: string, fallback: string): string {
  const last = uri.split(/[\\/]/).pop();
  return last && last.includes(".") ? last : fallback;
}

/** Photo library source. */
export async function pickFromLibrary(): Promise<PickedFile | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error("Photo library permission denied");
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 1,
  });
  if (result.canceled || !result.assets.length) return null;
  const asset = result.assets[0];
  return {
    uri: asset.uri,
    name: asset.fileName ?? nameFromUri(asset.uri, "pattern.jpg"),
    type: asset.mimeType ?? "image/jpeg",
  };
}

/**
 * Camera source. `allowsEditing: true` gives the user a basic rectangular
 * crop after capture. Full perspective correction (de-skewing a pattern
 * photographed at an angle) is a future enhancement — for now the backend
 * preprocess step is responsible for any further straightening/contrast
 * enhancement, so we deliberately do no client-side image processing here.
 */
export async function pickFromCamera(): Promise<PickedFile | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error("Camera permission denied");
  const result = await ImagePicker.launchCameraAsync({
    allowsEditing: true,
    quality: 1,
  });
  if (result.canceled || !result.assets.length) return null;
  const asset = result.assets[0];
  return {
    uri: asset.uri,
    name: asset.fileName ?? nameFromUri(asset.uri, "photo.jpg"),
    type: asset.mimeType ?? "image/jpeg",
  };
}

/** PDF source. */
export async function pickPdf(): Promise<PickedFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: "application/pdf",
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets.length) return null;
  const asset = result.assets[0];
  return {
    uri: asset.uri,
    name: asset.name || nameFromUri(asset.uri, "pattern.pdf"),
    type: asset.mimeType ?? "application/pdf",
  };
}

export interface ProcessedUpload {
  jobId: string;
  grid: GridData;
}

/**
 * Upload the picked file and poll the job until the grid is ready.
 * `onProgress` receives every poll tick (stage + 0..1 progress).
 */
export async function uploadAndProcess(
  file: PickedFile,
  onProgress: (status: JobStatus) => void,
): Promise<ProcessedUpload> {
  const { job_id } = await apiClient.upload({
    // RN FormData understands the {uri, name, type} shape natively.
    file: { uri: file.uri, name: file.name, type: file.type },
    name: file.name,
    type: file.type,
  });
  const grid = await apiClient.waitForJob(job_id, onProgress);
  return { jobId: job_id, grid };
}
