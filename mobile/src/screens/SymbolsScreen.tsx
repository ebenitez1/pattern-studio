/**
 * Symbols tab: full-screen symbol legend with search, larger thumbnails
 * (scaled by the accessibility symbolScale pref) and the same filter controls
 * as the viewer's bottom sheet.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "@pattern-studio/core";
import { SymbolPanel } from "../components/SymbolPanel";

export function SymbolsScreen() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <SymbolPanel variant="full" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
});
