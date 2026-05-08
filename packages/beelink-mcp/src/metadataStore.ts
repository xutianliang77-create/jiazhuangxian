import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type {
  CatalogEntry,
  CatalogCollaboration,
  MetadataObjectProfile,
  MetadataSearchResult,
  MetadataTableProfile,
  TableLineage,
  TableColumn,
} from "./types";

export class MetadataStore {
  private readonly db: Database.Database;

  constructor(readonly dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("busy_timeout = 5000");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  upsertCatalogObjects(entries: CatalogEntry[], syncedAt: number = Date.now()): number {
    const stmt = this.db.prepare(
      `INSERT INTO catalog_objects(
         path, object_id, name, type, parent_path, object_tag, created_at,
         last_synced_at, permission_status
       )
       VALUES (
         @path, @objectId, @name, @type, @parentPath, @objectTag, @createdAt,
         @lastSyncedAt, @permissionStatus
       )
       ON CONFLICT(path) DO UPDATE SET
         object_id = COALESCE(excluded.object_id, catalog_objects.object_id),
         name = excluded.name,
         type = excluded.type,
         parent_path = excluded.parent_path,
         object_tag = COALESCE(excluded.object_tag, catalog_objects.object_tag),
         created_at = COALESCE(excluded.created_at, catalog_objects.created_at),
         last_synced_at = excluded.last_synced_at,
         permission_status = excluded.permission_status`
    );
    const tx = this.db.transaction((items: CatalogEntry[]) => {
      for (const entry of items) {
        stmt.run({
          path: entry.path,
          objectId: entry.id ?? null,
          name: entry.name,
          type: entry.type,
          parentPath: parentPath(entry.path),
          objectTag: entry.tag ?? null,
          createdAt: entry.createdAt ?? null,
          lastSyncedAt: syncedAt,
          permissionStatus: "ok",
        });
      }
    });
    tx(entries);
    return entries.length;
  }

  replaceColumns(objectPath: string, columns: TableColumn[], syncedAt: number = Date.now()): number {
    const existing = this.readColumnHints(objectPath);
    const deleteStmt = this.db.prepare("DELETE FROM table_columns WHERE object_path = ?");
    const insertStmt = this.db.prepare(
      `INSERT INTO table_columns(
         object_path, column_name, data_type, nullable, ordinal, description,
         business_name, sample_values_json, header_confidence, last_synced_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const tx = this.db.transaction(() => {
      deleteStmt.run(objectPath);
      columns.forEach((column, index) => {
        const hint = existing.get(column.name);
        insertStmt.run(
          objectPath,
          column.name,
          column.type,
          column.nullable === undefined ? null : column.nullable ? 1 : 0,
          index,
          column.description ?? null,
          column.businessName ?? hint?.businessName ?? null,
          column.sampleValues
            ? JSON.stringify(column.sampleValues.slice(0, 5))
            : hint?.sampleValuesJson ?? null,
          column.headerConfidence ?? hint?.headerConfidence ?? null,
          syncedAt
        );
      });
    });
    tx();
    return columns.length;
  }

  updateColumnHints(objectPath: string, columns: TableColumn[], syncedAt: number = Date.now()): number {
    const stmt = this.db.prepare(
      `UPDATE table_columns
       SET business_name = ?,
           sample_values_json = ?,
           header_confidence = ?,
           last_synced_at = ?
       WHERE object_path = ? AND column_name = ?`
    );
    const tx = this.db.transaction(() => {
      for (const column of columns) {
        stmt.run(
          column.businessName ?? null,
          column.sampleValues ? JSON.stringify(column.sampleValues.slice(0, 5)) : null,
          column.headerConfidence ?? null,
          syncedAt,
          objectPath,
          column.name
        );
      }
    });
    tx();
    return columns.filter((column) => column.businessName || column.sampleValues?.length).length;
  }

  updateObjectCollaboration(objectPath: string, collaboration: CatalogCollaboration): void {
    const stmt = this.db.prepare(
      `UPDATE catalog_objects
       SET tags_json = COALESCE(?, tags_json),
           tags_version = COALESCE(?, tags_version),
           wiki_text = COALESCE(?, wiki_text),
           wiki_version = COALESCE(?, wiki_version)
       WHERE path = ?`
    );
    stmt.run(
      collaboration.tags ? JSON.stringify(collaboration.tags) : null,
      collaboration.tagsVersion ?? null,
      collaboration.wikiText ?? null,
      collaboration.wikiVersion ?? null,
      objectPath
    );
  }

  replaceLineage(objectPath: string, lineage: TableLineage, syncedAt: number = Date.now()): void {
    const deleteStmt = this.db.prepare("DELETE FROM lineage_edges WHERE object_path = ?");
    const insertStmt = this.db.prepare(
      `INSERT INTO lineage_edges(
         object_path, direction, node_path, node_id, node_type, node_tag, created_at, last_synced_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const tx = this.db.transaction(() => {
      deleteStmt.run(objectPath);
      for (const node of lineage.sources) {
        insertStmt.run(objectPath, "source", node.path, node.id ?? null, node.type, node.tag ?? null, node.createdAt ?? null, syncedAt);
      }
      for (const node of lineage.parents) {
        insertStmt.run(objectPath, "parent", node.path, node.id ?? null, node.type, node.tag ?? null, node.createdAt ?? null, syncedAt);
      }
      for (const node of lineage.children) {
        insertStmt.run(objectPath, "child", node.path, node.id ?? null, node.type, node.tag ?? null, node.createdAt ?? null, syncedAt);
      }
    });
    tx();
  }

  search(query: string, limit: number): MetadataSearchResult {
    const like = `%${query.trim().toLowerCase()}%`;
    const objectRows = this.db
      .prepare(
        `SELECT object_id AS id, name, path, type, object_tag AS tag, created_at AS createdAt
         FROM catalog_objects
         WHERE lower(path) LIKE ? OR lower(name) LIKE ?
         ORDER BY
           CASE WHEN lower(name) = lower(?) THEN 0 ELSE 1 END,
           path
         LIMIT ?`
      )
      .all(like, like, query.trim(), limit) as Array<{
      name: string;
      path: string;
      type: CatalogEntry["type"];
      id: string | null;
      tag: string | null;
      createdAt: string | null;
    }>;
    const columnRows = this.db
      .prepare(
        `SELECT object_path AS objectPath,
                column_name AS columnName,
                data_type AS dataType,
                nullable,
                description,
                business_name AS businessName,
                sample_values_json AS sampleValuesJson,
                header_confidence AS headerConfidence
         FROM table_columns
         WHERE lower(object_path) LIKE ?
            OR lower(column_name) LIKE ?
            OR lower(description) LIKE ?
            OR lower(business_name) LIKE ?
            OR lower(sample_values_json) LIKE ?
         ORDER BY object_path, ordinal
         LIMIT ?`
      )
      .all(like, like, like, like, like, limit) as Array<{
      objectPath: string;
      columnName: string;
      dataType: string;
      nullable: number | null;
      description: string | null;
      businessName: string | null;
      sampleValuesJson: string | null;
      headerConfidence: number | null;
    }>;

    return {
      dbPath: this.dbPath,
      objects: objectRows.map((row) => ({
        ...(row.id ? { id: row.id } : {}),
        name: row.name,
        path: row.path,
        type: row.type,
        ...(row.tag ? { tag: row.tag } : {}),
        ...(row.createdAt ? { createdAt: row.createdAt } : {}),
      })),
      columns: columnRows.map((row) => ({
        objectPath: row.objectPath,
        columnName: row.columnName,
        dataType: row.dataType,
        ...(row.nullable === null ? {} : { nullable: row.nullable === 1 }),
        ...(row.description ? { description: row.description } : {}),
        ...(row.businessName ? { businessName: row.businessName } : {}),
        ...(row.sampleValuesJson ? { sampleValues: parseJsonArray(row.sampleValuesJson) } : {}),
        ...(typeof row.headerConfidence === "number" ? { headerConfidence: row.headerConfidence } : {}),
      })),
    };
  }

  listTableProfiles(limit: number = 50): MetadataTableProfile[] {
    const tableRows = this.db
      .prepare(
        `SELECT name, path, type
         FROM catalog_objects
         WHERE type IN ('table', 'view')
         ORDER BY path
         LIMIT ?`
      )
      .all(limit) as Array<{
      name: string;
      path: string;
      type: CatalogEntry["type"];
    }>;
    const columnStmt = this.db.prepare(
      `SELECT column_name AS columnName,
              data_type AS dataType,
              business_name AS businessName,
              sample_values_json AS sampleValuesJson
       FROM table_columns
       WHERE object_path = ?
       ORDER BY ordinal`
    );
    return tableRows.map((table) => {
      const columns = columnStmt.all(table.path) as Array<{
        columnName: string;
        dataType: string;
        businessName: string | null;
        sampleValuesJson: string | null;
      }>;
      return {
        name: table.name,
        path: table.path,
        type: table.type,
        columns: columns.map((column) => ({
          columnName: column.columnName,
          dataType: column.dataType,
          ...(column.businessName ? { businessName: column.businessName } : {}),
          ...(column.sampleValuesJson ? { sampleValues: parseJsonArray(column.sampleValuesJson) } : {}),
        })),
      };
    });
  }

  getObjectProfile(path: string): MetadataObjectProfile | null {
    const object = this.db
      .prepare(
        `SELECT name, path, type, permission_status AS permissionStatus
              , object_id AS id,
                object_tag AS tag,
                created_at AS createdAt,
                tags_json AS tagsJson,
                tags_version AS tagsVersion,
                wiki_text AS wikiText,
                wiki_version AS wikiVersion
         FROM catalog_objects
         WHERE path = ?`
      )
      .get(path) as
      | {
          name: string;
          path: string;
          type: CatalogEntry["type"];
          permissionStatus: string | null;
          id: string | null;
          tag: string | null;
          createdAt: string | null;
          tagsJson: string | null;
          tagsVersion: string | null;
          wikiText: string | null;
          wikiVersion: string | null;
        }
      | undefined;
    if (!object) return null;

    const columns = this.db
      .prepare(
        `SELECT column_name AS columnName,
                data_type AS dataType,
                nullable,
                description,
                business_name AS businessName,
                sample_values_json AS sampleValuesJson,
                header_confidence AS headerConfidence
         FROM table_columns
         WHERE object_path = ?
         ORDER BY ordinal`
      )
      .all(path) as Array<{
      columnName: string;
      dataType: string;
      nullable: number | null;
      description: string | null;
      businessName: string | null;
      sampleValuesJson: string | null;
      headerConfidence: number | null;
    }>;

    return {
      name: object.name,
      ...(object.id ? { id: object.id } : {}),
      path: object.path,
      type: object.type,
      ...(object.tag ? { tag: object.tag } : {}),
      ...(object.createdAt ? { createdAt: object.createdAt } : {}),
      ...(object.permissionStatus ? { permissionStatus: object.permissionStatus } : {}),
      ...(object.tagsJson ? { tags: parseJsonArray(object.tagsJson) } : {}),
      ...(object.tagsVersion ? { tagsVersion: object.tagsVersion } : {}),
      ...(object.wikiText ? { wikiText: object.wikiText } : {}),
      ...(object.wikiVersion ? { wikiVersion: object.wikiVersion } : {}),
      columns: columns.map((column) => ({
        columnName: column.columnName,
        dataType: column.dataType,
        ...(column.nullable === null ? {} : { nullable: column.nullable === 1 }),
        ...(column.description ? { description: column.description } : {}),
        ...(column.businessName ? { businessName: column.businessName } : {}),
        ...(column.sampleValuesJson ? { sampleValues: parseJsonArray(column.sampleValuesJson) } : {}),
        ...(typeof column.headerConfidence === "number" ? { headerConfidence: column.headerConfidence } : {}),
      })),
    };
  }

  getLineage(objectPath: string): TableLineage {
    const object = this.getObjectProfile(objectPath);
    const rows = this.db
      .prepare(
        `SELECT direction,
                node_path AS path,
                node_id AS id,
                node_type AS type,
                node_tag AS tag,
                created_at AS createdAt,
                last_synced_at AS lastSyncedAt
         FROM lineage_edges
         WHERE object_path = ?
         ORDER BY direction, node_path`
      )
      .all(objectPath) as Array<{
      direction: "source" | "parent" | "child";
      path: string;
      id: string | null;
      type: CatalogEntry["type"];
      tag: string | null;
      createdAt: string | null;
      lastSyncedAt: number;
    }>;
    const toNode = (row: (typeof rows)[number]) => ({
      ...(row.id ? { id: row.id } : {}),
      path: row.path,
      type: row.type,
      ...(row.tag ? { tag: row.tag } : {}),
      ...(row.createdAt ? { createdAt: row.createdAt } : {}),
    });
    const latest = rows.reduce((max, row) => Math.max(max, row.lastSyncedAt), 0);
    return {
      path: objectPath,
      ...(object?.id ? { objectId: object.id } : {}),
      ...(latest > 0 ? { fetchedAt: latest } : {}),
      sources: rows.filter((row) => row.direction === "source").map(toNode),
      parents: rows.filter((row) => row.direction === "parent").map(toNode),
      children: rows.filter((row) => row.direction === "child").map(toNode),
      caveats:
        rows.length > 0
          ? []
          : ["No lineage edges are recorded in the local metadata index for this object."],
    };
  }

  listCatalogObjectPaths(): string[] {
    const rows = this.db
      .prepare("SELECT path FROM catalog_objects ORDER BY path")
      .all() as Array<{ path: string }>;
    return rows.map((row) => row.path);
  }

  pruneCatalogObjects(keepPaths: Set<string>, rootPaths?: string[]): number {
    const rows = this.db
      .prepare("SELECT path FROM catalog_objects ORDER BY path")
      .all() as Array<{ path: string }>;
    const stalePaths = rows
      .map((row) => row.path)
      .filter((objectPath) => !keepPaths.has(objectPath))
      .filter((objectPath) => matchesPruneRoots(objectPath, rootPaths));
    if (stalePaths.length === 0) return 0;

    const deleteColumns = this.db.prepare("DELETE FROM table_columns WHERE object_path = ?");
    const deleteLineage = this.db.prepare("DELETE FROM lineage_edges WHERE object_path = ?");
    const deleteObjects = this.db.prepare("DELETE FROM catalog_objects WHERE path = ?");
    const tx = this.db.transaction((paths: string[]) => {
      for (const objectPath of paths) {
        deleteColumns.run(objectPath);
        deleteLineage.run(objectPath);
        deleteObjects.run(objectPath);
      }
    });
    tx(stalePaths);
    return stalePaths.length;
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS catalog_objects (
        path TEXT PRIMARY KEY,
        object_id TEXT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        parent_path TEXT,
        object_tag TEXT,
        created_at TEXT,
        tags_json TEXT,
        tags_version TEXT,
        wiki_text TEXT,
        wiki_version TEXT,
        last_synced_at INTEGER NOT NULL,
        permission_status TEXT NOT NULL DEFAULT 'unknown'
      );

      CREATE INDEX IF NOT EXISTS idx_catalog_objects_parent
        ON catalog_objects(parent_path);

      CREATE INDEX IF NOT EXISTS idx_catalog_objects_name
        ON catalog_objects(name);

      CREATE TABLE IF NOT EXISTS table_columns (
        object_path TEXT NOT NULL,
        column_name TEXT NOT NULL,
        data_type TEXT NOT NULL,
        nullable INTEGER,
        ordinal INTEGER NOT NULL,
        description TEXT,
        business_name TEXT,
        sample_values_json TEXT,
        header_confidence REAL,
        semantic_tags TEXT,
        last_synced_at INTEGER NOT NULL,
        PRIMARY KEY (object_path, column_name)
      );

      CREATE INDEX IF NOT EXISTS idx_table_columns_name
        ON table_columns(column_name);

      CREATE TABLE IF NOT EXISTS lineage_edges (
        object_path TEXT NOT NULL,
        direction TEXT NOT NULL,
        node_path TEXT NOT NULL,
        node_id TEXT,
        node_type TEXT NOT NULL,
        node_tag TEXT,
        created_at TEXT,
        last_synced_at INTEGER NOT NULL,
        PRIMARY KEY (object_path, direction, node_path)
      );

      CREATE INDEX IF NOT EXISTS idx_lineage_edges_object
        ON lineage_edges(object_path);
    `);
    this.ensureColumn("catalog_objects", "object_id", "TEXT");
    this.ensureColumn("catalog_objects", "object_tag", "TEXT");
    this.ensureColumn("catalog_objects", "created_at", "TEXT");
    this.ensureColumn("catalog_objects", "tags_json", "TEXT");
    this.ensureColumn("catalog_objects", "tags_version", "TEXT");
    this.ensureColumn("catalog_objects", "wiki_text", "TEXT");
    this.ensureColumn("catalog_objects", "wiki_version", "TEXT");
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_catalog_objects_id
        ON catalog_objects(object_id);
    `);
    this.ensureColumn("table_columns", "business_name", "TEXT");
    this.ensureColumn("table_columns", "sample_values_json", "TEXT");
    this.ensureColumn("table_columns", "header_confidence", "REAL");
  }

  private ensureColumn(table: string, column: string, type: string): void {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (rows.some((row) => row.name === column)) return;
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }

  private readColumnHints(objectPath: string): Map<
    string,
    { businessName: string | null; sampleValuesJson: string | null; headerConfidence: number | null }
  > {
    const rows = this.db
      .prepare(
        `SELECT column_name AS columnName,
                business_name AS businessName,
                sample_values_json AS sampleValuesJson,
                header_confidence AS headerConfidence
         FROM table_columns
         WHERE object_path = ?`
      )
      .all(objectPath) as Array<{
      columnName: string;
      businessName: string | null;
      sampleValuesJson: string | null;
      headerConfidence: number | null;
    }>;
    return new Map(rows.map((row) => [row.columnName, row]));
  }
}

function parentPath(value: string): string | null {
  const index = value.lastIndexOf(".");
  return index > 0 ? value.slice(0, index) : null;
}

function matchesPruneRoots(objectPath: string, rootPaths?: string[]): boolean {
  if (!rootPaths || rootPaths.length === 0) return true;
  return rootPaths.some((root) => objectPath === root || objectPath.startsWith(`${root}.`));
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
