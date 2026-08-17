# Database Relationship Inference Design

## Goal

Add local, deterministic database relationship inference so Blug diagrams show table-to-table edges instead of only grouped components.

## Scope

This first version infers relationships only from schema-category files. It does not infer API-to-table, service-to-service, dependency, or queue relationships.

Supported relationship patterns:

- SQL foreign keys using `FOREIGN KEY (...) REFERENCES TargetTable(...)`.
- SQL inline references using `column_id ... REFERENCES TargetTable(...)`.
- Prisma model relations using fields like `user User @relation(...)`.
- Simple EF Core/C# navigation properties where both sides are table components already detected.

The implementation remains heuristic and conservative. It should skip ambiguous patterns rather than creating misleading edges.

## Architecture

Add relationship extraction alongside component extraction in `src/analyzer.ts`.

The analyzer should expose a schema-focused extraction path that can return both:

- `Component[]`
- `Relationship[]`

The existing `extractComponents()` API can remain for callers and tests that only need components. A new API such as `extractArchitecture()` should return both components and relationships for `scanAndUpdate()`.

`src/store.ts` should merge relationships into `ArchitectureModel.relationships` using source-file ownership, matching the current component merge behavior. Relationships inferred from a changed file should replace relationships previously inferred from that same file. Relationships from other files must be preserved.

Because the current `Relationship` type has only `from`, `to`, and `label`, source ownership needs to be added to relationships:

```ts
export interface Relationship {
  from: string;
  to: string;
  label?: string;
  sourceFile: string;
}
```

`src/diagram.ts` already renders relationships. It should continue to render the same Mermaid edge syntax, ignoring `sourceFile` in output.

## Direction

Use relationship direction from the dependent table to the referenced table.

Examples:

- `Orders.user_id REFERENCES Users(id)` creates `table:Orders -->|FK| table:Users`.
- Prisma `Order.user User @relation(...)` creates `table:Order -->|relation| table:User`.

This direction answers “this table depends on that table.”

## SQL Rules

For SQL, infer the source table from the nearest enclosing `CREATE TABLE <TableName> (...)` or `ALTER TABLE <TableName> ...` block.

Detect:

```sql
CREATE TABLE Orders (
  id int,
  user_id int,
  FOREIGN KEY (user_id) REFERENCES Users(id)
);
```

and:

```sql
CREATE TABLE Orders (
  user_id int REFERENCES Users(id)
);
```

and:

```sql
ALTER TABLE Orders
ADD CONSTRAINT fk_orders_users
FOREIGN KEY (user_id) REFERENCES Users(id);
```

The edge label should be `FK`.

## Prisma Rules

For Prisma, infer the source table from each `model ModelName { ... }` block.

A field is considered a relationship when:

- It has a type whose first character is uppercase.
- It includes `@relation`.
- The target type is not a scalar Prisma type.

Example:

```prisma
model Order {
  user User @relation(fields: [userId], references: [id])
}
```

creates `table:Order -->|relation| table:User`.

## EF Core Rules

For EF Core/C#, infer simple navigation properties only:

```csharp
public User User { get; set; }
public ICollection<Order> Orders { get; set; }
```

Only create a relationship when both the containing type and target type map to detected table components. Avoid guessing relationships from arbitrary method calls or LINQ queries.

The edge label should be `relation`.

## Merge Behavior

`mergeComponents()` should either become a broader merge function or delegate to a new `mergeArchitecture()` function.

Required behavior:

- Add new relationships when they appear in a changed file.
- Remove relationships previously inferred from that file when they disappear.
- Preserve relationships inferred from other files.
- Treat relationship changes as drift so `ARCHITECTURE.md` and the live preview refresh.
- Avoid duplicate relationships with the same `from`, `to`, `label`, and `sourceFile`.

`DriftReport` should include relationship counts in its summary so users can tell that a diagram edge changed even if no component changed.

## Data Flow

```text
schema file save
  -> watcher
  -> scanAndUpdate()
  -> classify as schema
  -> extract components + relationships
  -> merge into model
  -> write .blug/model.json and ARCHITECTURE.md if drift exists
  -> live preview refreshes if enabled
```

## Error Handling

Malformed or partial files should not crash scanning.

- SQL parsing should be best-effort regex/block parsing.
- Prisma block parsing should skip malformed model blocks.
- EF Core inference should skip files where no containing type can be identified.

If no relationship can be inferred confidently, return no relationship.

## Testing

Add focused tests for:

- SQL table-level foreign key extraction.
- SQL inline `REFERENCES` extraction.
- SQL `ALTER TABLE ... FOREIGN KEY ... REFERENCES` extraction.
- Prisma `@relation` extraction.
- EF Core simple navigation extraction.
- Merge behavior for adding and removing relationships from a changed file.
- Preservation of relationships from other files.
- Drift summary when only relationships change.
- Mermaid rendering ignores `sourceFile` and emits stable relationship edges.
- Existing component extraction behavior remains unchanged.

## Acceptance Criteria

- Architecture diagrams show table relationship edges for supported SQL, Prisma, and EF Core schemas.
- Relationship changes trigger drift reports, regenerate `ARCHITECTURE.md`, and refresh live preview.
- No relationship edge is created unless both ends are stable table component IDs.
- Existing behavior for component detection, watcher mode, preview mode, CLI, and MCP remains unchanged.
- Tests and typecheck pass.
