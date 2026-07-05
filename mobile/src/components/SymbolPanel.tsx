/**
 * Symbol legend + filter controls. Used twice:
 *  - inside the Viewer's bottom sheet (variant="sheet", BottomSheetFlatList)
 *  - as the full Symbols tab (variant="full", regular FlatList + search)
 */
import React, { useMemo } from "react";
import {
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { BottomSheetFlatList } from "@gorhom/bottom-sheet";
import {
  colors,
  computeStats,
  radii,
  searchSymbols,
  spacing,
  typography,
  useProjectStore,
  type FilterMode,
  type PatternSymbol,
  type SymbolStats,
} from "@pattern-studio/core";
import { usePrefs } from "../prefs";
import { Segmented } from "./Segmented";

const FILTER_OPTIONS: { label: string; value: FilterMode }[] = [
  { label: "None", value: "none" },
  { label: "Show Only", value: "show_only" },
  { label: "Highlight", value: "highlight" },
];

function symbolLabel(s: PatternSymbol): string {
  return s.ocr_text ?? s.color_name ?? s.dominant_color ?? s.id;
}

export function SymbolPanel({ variant }: { variant: "sheet" | "full" }) {
  const project = useProjectStore((s) => s.project);
  const filter = useProjectStore((s) => s.filter);
  const gridRevision = useProjectStore((s) => s.gridRevision);
  const searchQuery = useProjectStore((s) => s.searchQuery);
  const setSearchQuery = useProjectStore((s) => s.setSearchQuery);
  const toggleSymbol = useProjectStore((s) => s.toggleSymbol);
  const setFilterMode = useProjectStore((s) => s.setFilterMode);
  const setHideCompleted = useProjectStore((s) => s.setHideCompleted);
  const clearSelection = useProjectStore((s) => s.clearSelection);
  const { a11y } = usePrefs();

  const full = variant === "full";
  const thumbSize = Math.round((full ? 48 : 32) * a11y.symbolScale);

  // Per-symbol progress, recomputed only when the grid revision bumps.
  const statsBySymbol = useMemo(() => {
    const map = new Map<string, SymbolStats>();
    if (!project) return map;
    for (const s of computeStats(project.grid, project.progress).per_symbol) {
      map.set(s.symbol_id, s);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, gridRevision]);

  const symbols = useMemo(() => {
    if (!project) return [];
    return full
      ? searchSymbols(project.grid.symbols, searchQuery)
      : project.grid.symbols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, project?.grid.symbols, searchQuery, full]);

  const selected = useMemo(
    () => new Set(filter.selectedSymbolIds),
    [filter.selectedSymbolIds],
  );

  if (!project) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          Open a project to see its symbols.
        </Text>
      </View>
    );
  }

  const renderItem = ({ item }: { item: PatternSymbol }) => {
    const st = statsBySymbol.get(item.id);
    const isSelected = selected.has(item.id);
    return (
      <Pressable
        onPress={() => toggleSymbol(item.id)}
        accessibilityRole="button"
        accessibilityState={{ selected: isSelected }}
        style={[styles.row, isSelected && styles.rowSelected]}
      >
        {item.thumbnail ? (
          <Image
            source={{ uri: item.thumbnail }}
            style={{ width: thumbSize, height: thumbSize, borderRadius: radii.sm }}
          />
        ) : (
          <View
            style={[
              styles.thumbFallback,
              {
                width: thumbSize,
                height: thumbSize,
                backgroundColor: item.dominant_color ?? colors.surfaceRaised,
              },
            ]}
          />
        )}
        <View style={styles.rowBody}>
          <Text
            style={[styles.rowTitle, { fontSize: typography.sizeMd * (full ? a11y.symbolScale : 1) }]}
            numberOfLines={1}
          >
            {symbolLabel(item)}
          </Text>
          <Text style={styles.rowSub} numberOfLines={1}>
            {item.count} cells
            {item.color_code ? ` · ${item.color_code}` : ""}
          </Text>
        </View>
        <View style={styles.rowStats}>
          <Text style={styles.doneText}>{st?.completed ?? 0} done</Text>
          <Text style={styles.remainText}>{st?.remaining ?? item.count} left</Text>
        </View>
      </Pressable>
    );
  };

  const header = (
    <View style={styles.controls}>
      {full && (
        <TextInput
          style={styles.search}
          placeholder="Search symbols (letter, color, code)"
          placeholderTextColor={colors.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
      )}
      <Segmented
        options={FILTER_OPTIONS}
        value={filter.mode}
        onChange={setFilterMode}
      />
      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>Hide Completed</Text>
        <Switch
          value={filter.hideCompleted}
          onValueChange={setHideCompleted}
          trackColor={{ true: colors.accent, false: colors.border }}
          thumbColor={colors.text}
        />
      </View>
      {filter.selectedSymbolIds.length > 0 && (
        <Pressable onPress={clearSelection} style={styles.clearBtn}>
          <Text style={styles.clearText}>
            Clear selection ({filter.selectedSymbolIds.length})
          </Text>
        </Pressable>
      )}
    </View>
  );

  const listProps = {
    data: symbols,
    keyExtractor: (item: PatternSymbol) => item.id,
    renderItem,
    ListHeaderComponent: header,
    contentContainerStyle: styles.listContent,
    keyboardShouldPersistTaps: "handled" as const,
  };

  return variant === "sheet" ? (
    <BottomSheetFlatList {...listProps} />
  ) : (
    <FlatList {...listProps} />
  );
}

const styles = StyleSheet.create({
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: typography.sizeMd,
    textAlign: "center",
  },
  controls: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  search: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: typography.sizeMd,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.xs,
  },
  toggleLabel: {
    color: colors.text,
    fontSize: typography.sizeSm,
  },
  clearBtn: {
    alignSelf: "flex-start",
    paddingVertical: spacing.xs,
  },
  clearText: {
    color: colors.accent,
    fontSize: typography.sizeSm,
  },
  listContent: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: "transparent",
    marginBottom: spacing.xs,
    backgroundColor: colors.surface,
  },
  rowSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.surfaceRaised,
  },
  thumbFallback: {
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    color: colors.text,
    fontWeight: "600",
  },
  rowSub: {
    color: colors.textMuted,
    fontSize: typography.sizeXs,
    marginTop: 2,
  },
  rowStats: {
    alignItems: "flex-end",
  },
  doneText: {
    color: "#66bb6a",
    fontSize: typography.sizeXs,
    fontWeight: "600",
  },
  remainText: {
    color: colors.textMuted,
    fontSize: typography.sizeXs,
    marginTop: 2,
  },
});
