import { PatternApiClient } from "@pattern-studio/core";

export const apiClient = new PatternApiClient({
  baseUrl: import.meta.env.VITE_API_URL ?? "http://localhost:8000",
});
