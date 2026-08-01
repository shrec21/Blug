// Cheap, fast, heuristic first pass. The goal is NOT perfect classification —
// it's filtering the 99% of file saves (formatting, comments, unrelated logic)
// that shouldn't trigger any analysis at all, so the daemon stays quiet by default.

export type ArchCategory =
  | "schema"      // migrations, ORM models, .sql, prisma/drizzle schema files
  | "api"         // route definitions, controllers, OpenAPI/GraphQL specs
  | "infra"       // docker-compose, k8s manifests, Terraform, CI workflows
  | "deps"        // package.json, requirements.txt, go.mod, Gemfile, csproj
  | "messaging";  // queue/topic config, event bus definitions

export interface Classification {
  isArchRelevant: boolean;
  category?: ArchCategory;
}

const RULES: Array<{ category: ArchCategory; test: RegExp }> = [
  // Schema / DB
  { category: "schema", test: /(^|\/)migrations?\//i },
  { category: "schema", test: /\.sql$/i },
  { category: "schema", test: /schema\.(prisma|graphql)$/i },
  { category: "schema", test: /(^|\/)models?\/.*\.(py|ts|js|cs|java|rb)$/i },
  { category: "schema", test: /\.edmx$/i }, // EF Core / ASP.NET
  { category: "schema", test: /dbcontext.*\.cs$/i },

  // API surface
  { category: "api", test: /(^|\/)(routes?|controllers?|api|endpoints?)\/.*\.(ts|js|py|cs|java|rb|go)$/i },
  { category: "api", test: /openapi\.(ya?ml|json)$/i },
  { category: "api", test: /\.proto$/i },
  { category: "api", test: /schema\.graphql$/i },

  // Infra
  { category: "infra", test: /docker-compose\.ya?ml$/i },
  { category: "infra", test: /(^|\/)Dockerfile(?:\..*)?$/i },
  { category: "infra", test: /\.tf$/i },
  { category: "infra", test: /(^|\/)k8s\/.*\.ya?ml$/i },
  { category: "infra", test: /(^|\/)\.github\/workflows\/.*\.ya?ml$/i },

  // Dependency manifests (top-level dep changes = new service/library boundary)
  { category: "deps", test: /(^|\/)package\.json$/i },
  { category: "deps", test: /(^|\/)requirements\.txt$/i },
  { category: "deps", test: /(^|\/)go\.mod$/i },
  { category: "deps", test: /\.csproj$/i },
  { category: "deps", test: /(^|\/)pom\.xml$/i },

  // Messaging
  { category: "messaging", test: /(^|\/)(events?|topics?|queues?)\/.*\.(ts|js|py|cs|java)$/i },
];

const IGNORE = [
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /\.git\//,
  /(^|\/)\.blug\//,
  /\.test\.|\.spec\./,
  /\.md$/i,
];

export function classify(relPath: string): Classification {
  if (IGNORE.some((r) => r.test(relPath))) return { isArchRelevant: false };
  for (const rule of RULES) {
    if (rule.test.test(relPath)) return { isArchRelevant: true, category: rule.category };
  }
  return { isArchRelevant: false };
}
