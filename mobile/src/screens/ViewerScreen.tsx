/**
 * Viewer tab: full-screen Skia pattern canvas + a bottom sheet mirroring the
 * Symbols tab (filter without leaving the viewer).
 */
import React, { useMemo, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import BottomSheet from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  colors,
  computeStats,
  spacing,
  typography,
  useProjectStore,
} from "@pattern-studio/core";
import { PatternCanvas } from "../components/PatternCanvas";
import { SymbolPanel } from "../components/SymbolPanel";

export function ViewerScreen() {
  const project = useProjectStore((s) => s.project);
  const gridRevision = useProjectStore((s) => s.gridRevision);
  const sheetRef = useRef<BottomSheet>(null);
  const insets = useSafeAreaInsets();

  const completion = useMemo(() => {
    if (!project) return 0;
    return computeStats(project.grid, project.progress).completion;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, gridRevision]);

  const snapPoints = useMemo(() => ["12%", "50%", "88%"], []);

  if (!project) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>No project open</Text>
        <Text style={styles.emptyText}>
          Open or create a project from the Projects tab.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.xs }]}>
        <Text style={styles.title} numberOfLines={1}>
          {project.name}
        </Text>
        <Text style={styles.subtitle}>
          {project.grid.rows}×{project.grid.cols} ·{" "}
          {Math.round(completion * 100)}% complete
        </Text>
      </View>
      <PatternCanvas />
      <BottomSheet
        ref={sheetRef}
        index={0}
        snapPoints={snapPoints}
        enableDynamicSizing={false}
        backgroundStyle={styles.sheetBg}
        handleIndicatorStyle={styles.sheetHandle}
      >
        <SymbolPanel variant="sheet" />
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: {
    color: colors.text,
    fontSize: typography.sizeLg,
    fontWeight: "700",
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: typography.sizeXs,
    marginTop: 2,
  },
  empty: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: typography.sizeLg,
    fontWeight: "700",
    marginBottom: spacing.sm,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: typography.sizeMd,
    textAlign: "center",
  },
  sheetBg: {
    backgroundColor: colors.surface,
  },
  sheetHandle: {
    backgroundColor: colors.textMuted,
  },
});
