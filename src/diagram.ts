import { type ArchitectureModel, type Component, type ComponentKind } from "./types.js";

export interface DiagramRenderOptions {
  focus?: string;
  depth?: number;
}

const GROUP_LABEL: Record<ComponentKind, string> = {
  table: "Database",
  endpoint: "API",
  service: "Services",
  module: "Modules",
  dependency: "Dependencies",
  queue: "Messaging",
  job: "Jobs",
};

// Layered order: deployment → interface → logic → async → data → background → external
const KIND_ORDER: ComponentKind[] = ["service", "endpoint", "module", "queue", "table", "job", "dependency"];

const SUBGRAPH_STYLE: Record<ComponentKind, string> = {
  service: "fill:#e8f5e9,stroke:#388e3c",
  endpoint: "fill:#e3f2fd,stroke:#1976d2",
  module: "fill:#fff9c4,stroke:#f9a825",
  table: "fill:#fce4ec,stroke:#c62828",
  queue: "fill:#fff3e0,stroke:#e65100",
  dependency: "fill:#f3e5f5,stroke:#7b1fa2",
  job: "fill:#e0f7fa,stroke:#00838f",
};

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

function escapeLabel(label: string): string {
  return label
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "/");
}

function matchesFocus(component: Component, focus: string): boolean {
  const needle = focus.toLowerCase();
  return component.id.toLowerCase().includes(needle) || component.name.toLowerCase().includes(needle);
}

function focusDepth(options: DiagramRenderOptions): number {
  if (options.depth === undefined) return 1;
  if (!Number.isInteger(options.depth) || options.depth < 0) return 1;
  return options.depth;
}

function focusModel(model: ArchitectureModel, focus: string, depth: number): ArchitectureModel {
  const focusedIds = new Set(
    Object.values(model.components)
      .filter((component) => matchesFocus(component, focus))
      .map((component) => component.id)
  );
  if (focusedIds.size === 0) {
    return { ...model, components: {}, relationships: [] };
  }

  const includedIds = new Set(focusedIds);
  let frontier = [...focusedIds];
  for (let level = 0; level < depth; level += 1) {
    const nextFrontier: string[] = [];
    for (const relationship of model.relationships) {
      for (const [from, to] of [
        [relationship.from, relationship.to],
        [relationship.to, relationship.from],
      ]) {
        if (frontier.includes(from) && !includedIds.has(to)) {
          includedIds.add(to);
          nextFrontier.push(to);
        }
      }
    }
    frontier = nextFrontier;
    if (frontier.length === 0) break;
  }

  const components = Object.fromEntries(
    Object.entries(model.components).filter(([id]) => includedIds.has(id))
  );
  const relationships = model.relationships.filter(
    (relationship) => components[relationship.from] && components[relationship.to]
  );

  return { ...model, components, relationships };
}

export function renderMermaid(model: ArchitectureModel, options: DiagramRenderOptions = {}): string {
  const renderedModel = options.focus ? focusModel(model, options.focus, focusDepth(options)) : model;
  const byKind = new Map<ComponentKind, Component[]>();
  for (const c of Object.values(renderedModel.components)) {
    if (!byKind.has(c.kind)) byKind.set(c.kind, []);
    byKind.get(c.kind)!.push(c);
  }

  const lines: string[] = ["flowchart TB"];
  const renderedKinds: ComponentKind[] = [];

  for (const kind of KIND_ORDER) {
    const comps = byKind.get(kind) ?? [];
    if (comps.length === 0) continue;
    renderedKinds.push(kind);
    lines.push(`  subgraph ${sanitizeId(kind)}["${GROUP_LABEL[kind]}"]`);
    for (const c of comps.sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`    ${sanitizeId(c.id)}["${escapeLabel(c.name)}"]`);
    }
    lines.push("  end");
  }

  // Filter out relationships where either side doesn't exist as a component
  const validRelationships = renderedModel.relationships.filter(
    (rel) => renderedModel.components[rel.from] && renderedModel.components[rel.to]
  );

  const relationships = [...validRelationships].sort((a, b) => {
    const aKey = `${a.from}\0${a.to}\0${a.label ?? ""}`;
    const bKey = `${b.from}\0${b.to}\0${b.label ?? ""}`;
    return aKey.localeCompare(bKey);
  });
  for (const rel of relationships) {
    const label = rel.label ? `|${escapeLabel(rel.label)}|` : "";
    lines.push(`  ${sanitizeId(rel.from)} -->${label} ${sanitizeId(rel.to)}`);
  }

  // Subgraph color styles
  for (const kind of renderedKinds) {
    lines.push(`  style ${sanitizeId(kind)} ${SUBGRAPH_STYLE[kind]}`);
  }

  return lines.join("\n");
}

export function renderMarkdown(model: ArchitectureModel): string {
  const mermaid = renderMermaid(model);
  const counts = Object.values(model.components).reduce<Record<string, number>>((acc, c) => {
    acc[c.kind] = (acc[c.kind] || 0) + 1;
    return acc;
  }, {});

  const summary = KIND_ORDER.filter((kind) => counts[kind])
    .map((kind) => `- ${GROUP_LABEL[kind]}: ${counts[kind]}`)
    .join("\n");

  return `# Architecture (auto-generated by blug)

_Last updated: ${model.updatedAt}_
_Do not hand-edit — this file is regenerated on every architecture-relevant change._

${summary || "_No components detected yet._"}

\`\`\`mermaid
${mermaid}
\`\`\`
`;
}
