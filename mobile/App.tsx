import React from "react";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  DarkTheme,
  NavigationContainer,
  type Theme,
} from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors, registerStorage } from "@pattern-studio/core";
import { sqliteStorage } from "./src/storage/sqliteStorage";
import { PrefsProvider } from "./src/prefs";
import type { RootTabParamList } from "./src/navigation";
import { ViewerScreen } from "./src/screens/ViewerScreen";
import { SymbolsScreen } from "./src/screens/SymbolsScreen";
import { StatsScreen } from "./src/screens/StatsScreen";
import { ProjectsScreen } from "./src/screens/ProjectsScreen";

// Register the SQLite ProjectStorage before anything renders — the core
// store's autosave/list/load all flow through this.
registerStorage(sqliteStorage);

const Tab = createBottomTabNavigator<RootTabParamList>();

const navTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.surface,
    border: colors.border,
    text: colors.text,
    primary: colors.accent,
  },
};

const TAB_ICONS: Record<
  keyof RootTabParamList,
  { focused: keyof typeof Ionicons.glyphMap; idle: keyof typeof Ionicons.glyphMap }
> = {
  Viewer: { focused: "grid", idle: "grid-outline" },
  Symbols: { focused: "shapes", idle: "shapes-outline" },
  Stats: { focused: "stats-chart", idle: "stats-chart-outline" },
  Projects: { focused: "folder-open", idle: "folder-open-outline" },
};

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PrefsProvider>
          <StatusBar style="light" />
          <NavigationContainer theme={navTheme}>
            <Tab.Navigator
              initialRouteName="Projects"
              screenOptions={({ route }) => ({
                headerShown: false,
                tabBarStyle: {
                  backgroundColor: colors.surface,
                  borderTopColor: colors.border,
                },
                tabBarActiveTintColor: colors.accent,
                tabBarInactiveTintColor: colors.textMuted,
                tabBarIcon: ({ focused, color, size }) => (
                  <Ionicons
                    name={
                      focused
                        ? TAB_ICONS[route.name].focused
                        : TAB_ICONS[route.name].idle
                    }
                    size={size}
                    color={color}
                  />
                ),
              })}
            >
              <Tab.Screen name="Viewer" component={ViewerScreen} />
              <Tab.Screen name="Symbols" component={SymbolsScreen} />
              <Tab.Screen name="Stats" component={StatsScreen} />
              <Tab.Screen name="Projects" component={ProjectsScreen} />
            </Tab.Navigator>
          </NavigationContainer>
        </PrefsProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
