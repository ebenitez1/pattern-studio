/**
 * PNG / CSV / PDF export buttons: backend export -> cache file -> share sheet.
 * Disabled when the project has no backend job id or sharing is unavailable.
 */
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  colors,
  radii,
  spacing,
  typography,
  useProjectStore,
  type ExportFormat,
} from "@pattern-studio/core";
import { exportAndShare, sharingAvailable } from "../exportShare";

const FORMATS: ExportFormat[] = ["png", "csv", "pdf"];

export function ExportButtons() {
  const project = useProjectStore((s) => s.project);
  const filter = useProjectStore((s) => s.filter);
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [canShare, setCanShare] = useState(true);

  useEffect(() => {
    let cancelled = false;
    sharingAvailable()
      .then((ok) => {
        if (!cancelled) setCanShare(ok);
      })
      .catch(() => {
        if (!cancelled) setCanShare(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const jobId = project?.job_id ?? null;
  const disabled = !project || !jobId || !canShare || busy !== null;

  const run = async (format: ExportFormat) => {
    if (!project || !jobId) return;
    setBusy(format);
    try {
      await exportAndShare({
        jobId,
        projectName: project.name,
        format,
        filter,
        progress: project.progress,
      });
    } catch (err) {
      Alert.alert(
        "Export failed",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <View>
      <View style={styles.row}>
        {FORMATS.map((f) => (
          <Pressable
            key={f}
            accessibilityRole="button"
            disabled={disabled}
            onPress={() => void run(f)}
            style={[styles.btn, disabled && styles.btnDisabled]}
          >
            {busy === f ? (
              <ActivityIndicator size="small" color={colors.text} />
            ) : (
              <Text style={[styles.btnText, disabled && styles.btnTextDisabled]}>
                {f.toUpperCase()}
              </Text>
            )}
          </Pressable>
        ))}
      </View>
      {!jobId && project && (
        <Text style={styles.hint}>
          This project has no backend job id, so it cannot be re-exported.
        </Text>
      )}
      {!canShare && (
        <Text style={styles.hint}>Sharing is not available on this device.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  btn: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: 12,
    alignItems: "center",
  },
  btnDisabled: {
    backgroundColor: colors.surfaceRaised,
  },
  btnText: {
    color: colors.text,
    fontWeight: "700",
    fontSize: typography.sizeSm,
  },
  btnTextDisabled: {
    color: colors.textMuted,
  },
  hint: {
    color: colors.textMuted,
    fontSize: typography.sizeXs,
    marginTop: spacing.sm,
  },
});
