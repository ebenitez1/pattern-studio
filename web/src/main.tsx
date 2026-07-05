import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { useProjectStore } from "@pattern-studio/core";
import { initStorage } from "./storage/dexieStorage";
import { applyThemeVariables } from "./themeVars";
import { A11yProvider } from "./a11y";
import App from "./App";
import "./styles.css";

// Storage MUST be registered before anything touches the store.
initStorage();
applyThemeVariables();

void useProjectStore.getState().refreshProjects();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <A11yProvider>
      <App />
    </A11yProvider>
  </StrictMode>,
);
