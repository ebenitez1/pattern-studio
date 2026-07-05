/**
 * Stats tab: project totals, progress bar, per-symbol table, export buttons.
 */
import React, { useMemo } from "react";
import { FlatList, Image, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  colors,
  computeStats,
  radii,
  spacing,
  typography,
  useProjectStore,
  type PatternSymbol,
  type SymbolStats,
} from "@pattern-studio/core";
import { ExportButtons } from "../components/ExportButtons";

function StatChip({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipValue}>{value}</Text>
      <Text style={styles.chipLabel}>{label}</Text>
    </View>
  );
}

export function StatsScreen() {
  const project = useProjectStore((s) => s.project);
  const gridRevision = useProjectStore((s) => s.gridRevision);
  const insets = useSafeAreaInsets();

  // Memoized on gridRevision — recomputed only when progress actually changes.
  const stats = useMemo(() => {
    if (!project) return null;
    return computeStats(project.grid, project.progress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, gridRevision]);

  const symbolsById = useMemo(() => {
    const m = new Map<string, PatternSymbol>();
    for (const s of project?.grid.symbols ?? []) m.set(s.id, s);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, project?.grid.symbols]);

  if (!project || !stats) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          Open a project to see its statistics.
        </Text>
      </View>
    );
  }

  const pct = Math.round(stats.completion * 100);

  const header = (
    <View style={styles.headerBlock}>
      <Text style={styles.title} numberOfLines={1}>
        {project.name}
      </Text>

      <View style={styles.chipRow}>
        <StatChip label="Rows" value={stats.rows} />
        <StatChip label="Cols" value={stats.cols} />
        <StatChip label="Cells" value={stats.total_cells} />
        <StatChip label="Symbols" value={stats.unique_symbols} />
      </View>
      <View style={styles.chipRow}>
        <StatChip label="Completed" value={stats.completed} />
        <StatChip label="Remaining" value={stats.remaining} />
        <StatChip label="Skipped" value={stats.skipped} />
        <StatChip label="Review" value={stats.needs_review} />
      </View>

      <View style={styles.progressWrap}>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${pct}%` }]} />
        </View>
        <Text style={styles.progressLabel}>{pct}% complete</Text>
      </View>

      <Text style={styles.sectionTitle}>Export</Text>
      <ExportButtons />

      <Text style={styles.sectionTitle}>Per symbol</Text>
      <View style={styles.tableHeader}>
        <Text style={[styles.th, styles.colSymbol]}>Symbol</Text>
        <Text style={[styles.th, styles.colNum]}>Total</Text>
        <Text style={[styles.th, styles.colNum]}>Done</Text>
        <Text style={[styles.th, styles.colNum]}>Left</Text>
      </View>
    </View>
  );

  const renderRow = ({ item }: { item: SymbolStats }) => {
    const sym = symbolsById.get(item.symbol_id);
    const label =
      sym?.ocr_text ?? sym?.color_name ?? sym?.dominant_color ?? item.symbol_id;
    return (
      <View style={styles.tr}>
        <View style={[styles.colSymbol, styles.symbolCell]}>
          {sym?.thumbnail ? (
            <Image source={{ uri: sym.thumbnail }} style={styles.thumb} />
          ) : (
            <View
              style={[
                styles.thumb,
                { backgroundColor: sym?.dominant_color ?? colors.surfaceRaised },
              ]}
            />
          )}
          <Text style={styles.td} numberOfLines={1}>
            {label}
          </Text>
        </View>
        <Text style={[styles.td, styles.colNum]}>{item.total}</Text>
        <Text style={[styles.td, styles.colNum, styles.doneNum]}>
          {item.completed}
        </Text>
        <Text style={[styles.td, styles.colNum]}>{item.remaining}</Text>
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <FlatList
        data={stats.per_symbol}
        keyExtractor={(item) => item.symbol_id}
        renderItem={renderRow}
        ListHeaderComponent={header}
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  listContent: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  empty: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: typography.sizeMd,
    textAlign: "center",
  },
  headerBlock: {
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  title: {
    color: colors.text,
    fontSize: typography.sizeXl,
    fontWeight: "700",
  },
  chipRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  chip: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    alignItems: "center",
  },
  chipValue: {
    color: colors.text,
    fontSize: typography.sizeLg,
    fontWeight: "700",
  },
  chipLabel: {
    color: colors.textMuted,
    fontSize: typography.sizeXs,
    marginTop: 2,
  },
  progressWrap: {
    marginTop: spacing.xs,
  },
  progressTrack: {
    height: 12,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceRaised,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.accent,
    borderRadius: radii.md,
  },
  progressLabel: {
    color: colors.textMuted,
    fontSize: typography.sizeXs,
    marginTop: spacing.xs,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: typography.sizeMd,
    fontWeight: "700",
    marginTop: spacing.md,
  },
  tableHeader: {
    flexDirection: "row",
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  th: {
    color: colors.textMuted,
    fontSize: typography.sizeXs,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  tr: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  colSymbol: {
    flex: 2,
  },
  colNum: {
    flex: 1,
    textAlign: "right",
  },
  symbolCell: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  td: {
    color: colors.text,
    fontSize: typography.sizeSm,
    flexShrink: 1,
  },
  doneNum: {
    color: "#66bb6a",
  },
  thumb: {
    width: 24,
    height: 24,
    borderRadius: radii.sm,
  },
});
