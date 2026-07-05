/**
 * Projects tab: project list (search / open / long-press delete), the
 * "New Project" flow (photo library / camera / PDF -> upload -> poll ->
 * createProject) and the settings section (API URL + accessibility).
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  colors,
  radii,
  searchProjects,
  spacing,
  typography,
  useProjectStore,
  type JobStatus,
  type ProjectSummary,
} from "@pattern-studio/core";
import type { RootTabParamList } from "../navigation";
import {
  pickFromCamera,
  pickFromLibrary,
  pickPdf,
  uploadAndProcess,
  type PickedFile,
} from "../newProject";
import {
  usePrefs,
  SYMBOL_SCALE_MAX,
  SYMBOL_SCALE_MIN,
} from "../prefs";

type Nav = BottomTabNavigationProp<RootTabParamList, "Projects">;

type NewProjectPhase =
  | { kind: "idle" }
  | { kind: "uploading"; fileName: string }
  | { kind: "processing"; fileName: string; stage: string; progress: number }
  | { kind: "error"; message: string };

function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "") || "Untitled pattern";
}

function formatLastOpened(ts: number): string {
  if (!ts) return "never opened";
  return new Date(ts).toLocaleDateString();
}

// ---------------------------------------------------------------------------

function ProjectRow({
  item,
  onOpen,
  onDelete,
}: {
  item: ProjectSummary;
  onOpen: (id: string) => void;
  onDelete: (item: ProjectSummary) => void;
}) {
  const pct =
    item.total_cells > 0
      ? Math.round((item.completed_cells / item.total_cells) * 100)
      : 0;
  return (
    <Pressable
      onPress={() => onOpen(item.id)}
      onLongPress={() => onDelete(item)}
      accessibilityRole="button"
      style={styles.projectRow}
    >
      {item.thumbnail ? (
        <Image source={{ uri: item.thumbnail }} style={styles.projectThumb} />
      ) : (
        <View style={[styles.projectThumb, styles.projectThumbFallback]}>
          <Text style={styles.projectThumbText}>
            {item.rows}×{item.cols}
          </Text>
        </View>
      )}
      <View style={styles.projectBody}>
        <Text style={styles.projectName} numberOfLines={1}>
          {item.name}
        </Text>
        {item.tags.length > 0 && (
          <View style={styles.tagRow}>
            {item.tags.map((t) => (
              <View key={t} style={styles.tag}>
                <Text style={styles.tagText}>{t}</Text>
              </View>
            ))}
          </View>
        )}
        <Text style={styles.projectMeta}>
          {pct}% complete · {formatLastOpened(item.last_opened_at)}
        </Text>
      </View>
      <Text style={styles.projectPct}>{pct}%</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------

export function ProjectsScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const projects = useProjectStore((s) => s.projects);
  const refreshProjects = useProjectStore((s) => s.refreshProjects);
  const openProject = useProjectStore((s) => s.openProject);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const createProject = useProjectStore((s) => s.createProject);

  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState<NewProjectPhase>({ kind: "idle" });

  const { a11y, updateA11y, apiBaseUrl, setApiBaseUrl, ready } = usePrefs();
  const [urlDraft, setUrlDraft] = useState(apiBaseUrl);
  useEffect(() => {
    if (ready) setUrlDraft(apiBaseUrl);
  }, [ready, apiBaseUrl]);

  useFocusEffect(
    useCallback(() => {
      void refreshProjects();
    }, [refreshProjects]),
  );

  const filtered = useMemo(
    () => searchProjects(projects, query),
    [projects, query],
  );

  const handleOpen = useCallback(
    async (id: string) => {
      try {
        await openProject(id);
        navigation.navigate("Viewer");
      } catch (err) {
        Alert.alert(
          "Could not open project",
          err instanceof Error ? err.message : String(err),
        );
      }
    },
    [openProject, navigation],
  );

  const handleDelete = useCallback(
    (item: ProjectSummary) => {
      Alert.alert(
        "Delete project?",
        `"${item.name}" and its progress will be removed permanently.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => void deleteProject(item.id),
          },
        ],
      );
    },
    [deleteProject],
  );

  const startNewProject = useCallback(
    async (picker: () => Promise<PickedFile | null>) => {
      try {
        const file = await picker();
        if (!file) return; // user cancelled
        setPhase({ kind: "uploading", fileName: file.name });
        const onProgress = (status: JobStatus) =>
          setPhase({
            kind: "processing",
            fileName: file.name,
            stage: status.stage,
            progress: status.progress,
          });
        const { jobId, grid } = await uploadAndProcess(file, onProgress);
        // Thumbnail generation is skipped client-side (null is acceptable);
        // the list falls back to a rows×cols placeholder card.
        await createProject({
          name: baseName(file.name),
          sourceFileName: file.name,
          jobId,
          grid,
          thumbnail: null,
        });
        setPhase({ kind: "idle" });
        navigation.navigate("Viewer");
      } catch (err) {
        setPhase({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [createProject, navigation],
  );

  const busy = phase.kind === "uploading" || phase.kind === "processing";

  const header = (
    <View style={styles.headerBlock}>
      <Text style={styles.title}>Pattern Studio</Text>

      {/* ---- New project ---- */}
      <Text style={styles.sectionTitle}>New Project</Text>
      <View style={styles.sourceRow}>
        <Pressable
          style={[styles.sourceBtn, busy && styles.sourceBtnDisabled]}
          disabled={busy}
          onPress={() => void startNewProject(pickFromLibrary)}
        >
          <Text style={styles.sourceIcon}>🖼️</Text>
          <Text style={styles.sourceLabel}>Photos</Text>
        </Pressable>
        <Pressable
          style={[styles.sourceBtn, busy && styles.sourceBtnDisabled]}
          disabled={busy}
          onPress={() => void startNewProject(pickFromCamera)}
        >
          <Text style={styles.sourceIcon}>📷</Text>
          <Text style={styles.sourceLabel}>Camera</Text>
        </Pressable>
        <Pressable
          style={[styles.sourceBtn, busy && styles.sourceBtnDisabled]}
          disabled={busy}
          onPress={() => void startNewProject(pickPdf)}
        >
          <Text style={styles.sourceIcon}>📄</Text>
          <Text style={styles.sourceLabel}>PDF</Text>
        </Pressable>
      </View>

      {phase.kind === "uploading" && (
        <View style={styles.progressCard}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.progressText}>Uploading {phase.fileName}…</Text>
        </View>
      )}
      {phase.kind === "processing" && (
        <View style={styles.progressCard}>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.round(phase.progress * 100)}%` },
              ]}
            />
          </View>
          <Text style={styles.progressText}>
            {phase.stage} · {Math.round(phase.progress * 100)}%
          </Text>
        </View>
      )}
      {phase.kind === "error" && (
        <Pressable
          style={[styles.progressCard, styles.errorCard]}
          onPress={() => setPhase({ kind: "idle" })}
        >
          <Text style={styles.errorText}>
            {phase.message}
          </Text>
          <Text style={styles.errorDismiss}>Tap to dismiss</Text>
        </Pressable>
      )}

      {/* ---- Search ---- */}
      <TextInput
        style={styles.search}
        placeholder="Search projects by name or tag"
        placeholderTextColor={colors.textMuted}
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {filtered.length === 0 && (
        <Text style={styles.emptyList}>
          {projects.length === 0
            ? "No projects yet — create one above."
            : "No projects match your search."}
        </Text>
      )}
    </View>
  );

  const footer = (
    <View style={styles.settingsBlock}>
      <Text style={styles.sectionTitle}>Settings</Text>

      <Text style={styles.settingLabel}>Backend URL</Text>
      <View style={styles.urlRow}>
        <TextInput
          style={[styles.search, styles.urlInput]}
          value={urlDraft}
          onChangeText={setUrlDraft}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="http://192.168.x.x:8000"
          placeholderTextColor={colors.textMuted}
          onSubmitEditing={() => setApiBaseUrl(urlDraft)}
        />
        <Pressable
          style={styles.saveBtn}
          onPress={() => setApiBaseUrl(urlDraft)}
        >
          <Text style={styles.saveBtnText}>Save</Text>
        </Pressable>
      </View>
      <Text style={styles.settingHint}>
        Use your computer&apos;s LAN IP — localhost on the phone points at the
        phone itself.
      </Text>

      <View style={styles.settingRow}>
        <Text style={styles.settingLabel}>
          Symbol scale ({a11y.symbolScale.toFixed(2)}×)
        </Text>
        <View style={styles.stepper}>
          <Pressable
            style={styles.stepBtn}
            disabled={a11y.symbolScale <= SYMBOL_SCALE_MIN}
            onPress={() => updateA11y({ symbolScale: a11y.symbolScale - 0.25 })}
          >
            <Text style={styles.stepBtnText}>−</Text>
          </Pressable>
          <Pressable
            style={styles.stepBtn}
            disabled={a11y.symbolScale >= SYMBOL_SCALE_MAX}
            onPress={() => updateA11y({ symbolScale: a11y.symbolScale + 0.25 })}
          >
            <Text style={styles.stepBtnText}>+</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.settingRow}>
        <Text style={styles.settingLabel}>Colorblind highlight (cyan)</Text>
        <Switch
          value={a11y.colorblindHighlight}
          onValueChange={(v) => updateA11y({ colorblindHighlight: v })}
          trackColor={{ true: colors.accent, false: colors.border }}
          thumbColor={colors.text}
        />
      </View>

      <View style={styles.settingRow}>
        <Text style={styles.settingLabel}>High contrast grid</Text>
        <Switch
          value={a11y.highContrast}
          onValueChange={(v) => updateA11y({ highContrast: v })}
          trackColor={{ true: colors.accent, false: colors.border }}
          thumbColor={colors.text}
        />
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ProjectRow
            item={item}
            onOpen={(id) => void handleOpen(id)}
            onDelete={handleDelete}
          />
        )}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
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
  headerBlock: {
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  title: {
    color: colors.text,
    fontSize: typography.sizeXl,
    fontWeight: "700",
  },
  sectionTitle: {
    color: colors.text,
    fontSize: typography.sizeMd,
    fontWeight: "700",
    marginTop: spacing.sm,
  },
  sourceRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  sourceBtn: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    alignItems: "center",
    paddingVertical: spacing.md,
    gap: spacing.xs,
  },
  sourceBtnDisabled: {
    opacity: 0.4,
  },
  sourceIcon: {
    fontSize: 22,
  },
  sourceLabel: {
    color: colors.text,
    fontSize: typography.sizeSm,
    fontWeight: "600",
  },
  progressCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
    alignItems: "center",
  },
  progressTrack: {
    alignSelf: "stretch",
    height: 10,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceRaised,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.accent,
  },
  progressText: {
    color: colors.textMuted,
    fontSize: typography.sizeSm,
  },
  errorCard: {
    borderColor: colors.statusNeedsReview,
  },
  errorText: {
    color: colors.text,
    fontSize: typography.sizeSm,
    textAlign: "center",
  },
  errorDismiss: {
    color: colors.textMuted,
    fontSize: typography.sizeXs,
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
  emptyList: {
    color: colors.textMuted,
    fontSize: typography.sizeSm,
    textAlign: "center",
    paddingVertical: spacing.md,
  },
  projectRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  projectThumb: {
    width: 56,
    height: 56,
    borderRadius: radii.sm,
  },
  projectThumbFallback: {
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  projectThumbText: {
    color: colors.textMuted,
    fontSize: typography.sizeXs,
  },
  projectBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  projectName: {
    color: colors.text,
    fontSize: typography.sizeMd,
    fontWeight: "600",
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  tag: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
  },
  tagText: {
    color: colors.textMuted,
    fontSize: typography.sizeXs,
  },
  projectMeta: {
    color: colors.textMuted,
    fontSize: typography.sizeXs,
  },
  projectPct: {
    color: colors.accent,
    fontSize: typography.sizeMd,
    fontWeight: "700",
  },
  settingsBlock: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.xs,
  },
  settingLabel: {
    color: colors.text,
    fontSize: typography.sizeSm,
  },
  settingHint: {
    color: colors.textMuted,
    fontSize: typography.sizeXs,
  },
  urlRow: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
  },
  urlInput: {
    flex: 1,
  },
  saveBtn: {
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  saveBtnText: {
    color: colors.text,
    fontWeight: "700",
    fontSize: typography.sizeSm,
  },
  stepper: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnText: {
    color: colors.text,
    fontSize: typography.sizeLg,
    fontWeight: "700",
  },
});
