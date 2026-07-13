import { useState, type ReactNode } from "react";
import { CurrentProject } from "./CurrentProject";
import { ProjectList } from "./ProjectList";
import { SymbolPanel } from "./SymbolPanel";
import { StatsPanel } from "./StatsPanel";
import { ExportMenu } from "./ExportMenu";

function CollapsiblePanel({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`panel ${open ? "open" : ""}`}>
      <button
        type="button"
        className="panel-header"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className={`panel-caret ${open ? "open" : ""}`}>▸</span>
        {title}
      </button>
      {open && <div className="panel-body">{children}</div>}
    </section>
  );
}

export function Sidebar() {
  return (
    <aside className="sidebar">
      <CollapsiblePanel title="Current Project" defaultOpen>
        <CurrentProject />
      </CollapsiblePanel>
      <CollapsiblePanel title="Projects" defaultOpen>
        <ProjectList />
      </CollapsiblePanel>
      <CollapsiblePanel title="Symbols" defaultOpen>
        <SymbolPanel />
      </CollapsiblePanel>
      <CollapsiblePanel title="Stats">
        <StatsPanel />
      </CollapsiblePanel>
      <CollapsiblePanel title="Export">
        <ExportMenu />
      </CollapsiblePanel>
    </aside>
  );
}
