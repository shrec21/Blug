// The living architecture model. Deliberately simple and diffable —
// this whole file is what gets serialized to .blug/model.json.

export type ComponentKind =
  | "table"        // DB table / schema entity
  | "endpoint"      // API route / RPC method
  | "service"       // deployable unit (docker-compose service, k8s deployment, microservice folder)
  | "module"        // business-logic unit (engine, tracker, dispatcher, agent)
  | "dependency"    // external package that changed (new/removed top-level dep)
  | "queue"         // message queue / topic
  | "job";          // scheduled/background job

export interface Component {
  id: string;               // stable id, e.g. "table:Users" or "endpoint:POST /orders"
  kind: ComponentKind;
  name: string;
  sourceFile: string;       // relative path that defines it
  detail?: string;          // e.g. column list, method signature
  lastChanged: string;      // ISO timestamp
}

export interface Relationship {
  from: string;              // Component id
  to: string;                // Component id
  label?: string;            // e.g. "FK", "calls", "publishes"
  sourceFile: string;        // relative path that inferred this edge
}

export interface ArchitectureExtraction {
  components: Component[];
  relationships: Relationship[];
}

export interface ArchitectureModel {
  version: number;
  updatedAt: string;
  components: Record<string, Component>;
  relationships: Relationship[];
}

export interface ChangeEvent {
  filePath: string;          // relative path
  changeType: "add" | "change" | "unlink";
  timestamp: string;
}

export interface DriftReport {
  sourceFile: string;
  hasDrift: boolean;
  added: Component[];
  removed: Component[];
  modified: Component[];
  addedRelationships: Relationship[];
  removedRelationships: Relationship[];
  summary: string;
}

export function emptyModel(): ArchitectureModel {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    components: {},
    relationships: [],
  };
}
