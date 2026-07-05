/**
 * Singleton PatternApiClient whose base URL is a user-editable setting
 * (persisted in AsyncStorage). "localhost" on a phone points at the phone
 * itself, so the default is a LAN-IP placeholder the user must edit in the
 * settings section of the Projects tab.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { PatternApiClient } from "@pattern-studio/core";

const API_URL_KEY = "ps.apiBaseUrl";

/** Placeholder — replace with the machine running the FastAPI backend. */
export const DEFAULT_API_BASE_URL = "http://192.168.x.x:8000";

export const apiClient = new PatternApiClient({ baseUrl: DEFAULT_API_BASE_URL });

export async function loadApiBaseUrl(): Promise<string> {
  const stored = await AsyncStorage.getItem(API_URL_KEY);
  const url = stored?.trim() || DEFAULT_API_BASE_URL;
  apiClient.setBaseUrl(url);
  return url;
}

export async function saveApiBaseUrl(url: string): Promise<void> {
  const trimmed = url.trim() || DEFAULT_API_BASE_URL;
  apiClient.setBaseUrl(trimmed);
  await AsyncStorage.setItem(API_URL_KEY, trimmed);
}
