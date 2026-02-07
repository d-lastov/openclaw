/**
 * Nebula Graph adapter for knowledge graph storage
 */

import type { NebulaConfig, EntityType } from "./config.js";

// ============================================================================
// Logger Type
// ============================================================================

export type Logger = {
  debug?: (msg: string) => void;
  trace?: (msg: string) => void;
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
};

// ============================================================================
// Types
// ============================================================================

export type GraphEntity = {
  id: string;
  type: EntityType;
  name: string;
  properties: Record<string, string | number | boolean>;
};

export type GraphRelation = {
  sourceId: string;
  targetId: string;
  type: string;
  properties: Record<string, string | number | boolean>;
};

export type GraphMemoryLink = {
  memoryId: string;
  entityId: string;
  confidence: number;
};

export type GraphExplorationResult = {
  entity: GraphEntity;
  related: Array<{
    entity: GraphEntity;
    relation: string;
    direction: "in" | "out";
  }>;
  memories: string[];
};

// ============================================================================
// nGQL Query Builder Helpers
// ============================================================================

function escapeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/'/g, "\\'");
}

function toNgqlValue(value: string | number | boolean): string {
  if (typeof value === "string") {
    return `"${escapeValue(value)}"`;
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value);
}

// ============================================================================
// Nebula Graph Client
// ============================================================================

export class NebulaMemoryClient {
  private session: unknown | null = null;
  private initPromise: Promise<void> | null = null;
  private readonly log: Logger;

  constructor(
    private readonly config: NebulaConfig,
    logger?: Logger,
  ) {
    this.log = logger || {};
  }

  private debug(msg: string): void {
    this.log.debug?.(`[nebula] ${msg}`);
  }

  private trace(msg: string): void {
    this.log.trace?.(`[nebula] ${msg}`);
  }

  private async ensureInitialized(): Promise<void> {
    if (this.session) {
      return;
    }
    if (this.initPromise) {
      return this.initPromise;
    }
    this.initPromise = this.doInitialize();
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    this.debug(
      `initializing connection to ${this.config.host}:${this.config.port}, space=${this.config.space}`,
    );

    // Dynamic import - use @nebula-contrib/nebula-nodejs
    const { createClient, Connection } = await import("@nebula-contrib/nebula-nodejs");

    const space = this.config.space;

    // Step 1: Create space if not exists using raw Connection
    // This avoids the infinite retry loop when space doesn't exist
    this.debug("step 1: ensuring space exists via bootstrap connection...");

    const bootstrapConn = new Connection({
      host: this.config.host,
      port: this.config.port,
      userName: this.config.user,
      password: this.config.password,
      space: "", // Empty - we'll create space manually
    });

    // Wait for authorization (ignore USE space error for empty space)
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.debug("bootstrap: timeout waiting for auth, proceeding anyway");
        resolve();
      }, 10000);

      bootstrapConn.on("authorized", () => {
        this.trace("bootstrap: authorized");
        clearTimeout(timeout);
        resolve();
      });

      bootstrapConn.on("error", () => {
        // Ignore errors - empty space will fail USE but that's ok
        this.trace("bootstrap: error (expected for empty space)");
        clearTimeout(timeout);
        resolve();
      });
    });

    // Create space if we have a session
    const sessionId = (bootstrapConn as any).sessionId;
    if (sessionId) {
      this.debug(`bootstrap: sessionId=${sessionId}, creating space...`);
      try {
        const thriftClient = (bootstrapConn as any).client;
        await thriftClient.execute(
          sessionId,
          Buffer.from(
            `CREATE SPACE IF NOT EXISTS ${space} (vid_type=FIXED_STRING(128), partition_num=1, replica_factor=1)`,
            "utf-8",
          ),
        );
        this.debug("bootstrap: space created or already exists");
        // Wait for space to propagate to storage
        await new Promise((r) => setTimeout(r, 5000));
      } catch (err) {
        this.debug(`bootstrap: create space error (may be ok): ${err}`);
      }
    } else {
      this.debug("bootstrap: no sessionId, skipping space creation");
    }

    // Close bootstrap connection
    try {
      await bootstrapConn.close();
      this.trace("bootstrap: connection closed");
    } catch {
      // Ignore
    }

    // Step 2: Create main client with space
    this.debug("step 2: creating main client with space...");

    const client = createClient({
      servers: [`${this.config.host}:${this.config.port}`],
      userName: this.config.user,
      password: this.config.password,
      space,
      poolSize: 1,
      executeTimeout: 15000,
    });

    this.trace("waiting for client ready event...");

    // Wait for client to be ready
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.debug("connection timeout after 15s");
        reject(new Error("Nebula connection timeout"));
      }, 15000);

      client.on("ready", () => {
        this.debug("client ready");
        clearTimeout(timeout);
        resolve();
      });

      client.on("error", ({ error }: { error: Error }) => {
        this.debug(`client error: ${error.message}`);
        clearTimeout(timeout);
        reject(error);
      });

      client.on("connected", () => {
        this.trace("client connected (TCP)");
      });

      client.on("authorized", () => {
        this.trace("client authorized (session created)");
      });

      client.on(
        "reconnecting",
        ({ retryInfo }: { retryInfo: { delay: number; attempt: number } }) => {
          this.debug(
            `client reconnecting: attempt=${retryInfo.attempt}, delay=${retryInfo.delay}ms`,
          );
        },
      );
    });

    this.session = client;
    this.debug("session stored, ensuring schema...");

    // Ensure schema exists
    await this.ensureSchema();
    this.debug("initialization complete");
  }

  private async execute(query: string): Promise<any> {
    await this.ensureInitialized();
    const client = this.session as any;

    const shortQuery = query.length > 100 ? query.slice(0, 100) + "..." : query;
    this.trace(`execute: ${shortQuery}`);

    const start = Date.now();
    // nebula-contrib/nebula-nodejs returns parsed data directly
    // Pass true as second arg to get original nebula response if needed
    const result = await client.execute(query);
    const elapsed = Date.now() - start;

    this.trace(`execute completed in ${elapsed}ms, rows=${result?.length ?? 0}`);
    return { data: result };
  }

  private async ensureSchema(): Promise<void> {
    // Space is already created and selected via createClient
    // Just ensure schema exists
    this.trace("ensuring schema (tags and edges)...");
    await this.execute(`USE ${this.config.space}`);

    // Create tags (vertex types)
    const tagQueries = [
      `CREATE TAG IF NOT EXISTS Person (name string, phone string, email string, role string)`,
      `CREATE TAG IF NOT EXISTS Organization (name string, type string)`,
      `CREATE TAG IF NOT EXISTS Concept (name string, category string, importance float)`,
      `CREATE TAG IF NOT EXISTS Memory (qdrantId string, text string, category string)`,
    ];

    for (const q of tagQueries) {
      try {
        await this.execute(q);
      } catch {
        // Tag might exist
      }
    }

    // Create edge types
    const edgeQueries = [
      `CREATE EDGE IF NOT EXISTS knows (relationship string, strength float)`,
      `CREATE EDGE IF NOT EXISTS related_to (relationType string, confidence float)`,
      `CREATE EDGE IF NOT EXISTS mentions (confidence float)`,
      `CREATE EDGE IF NOT EXISTS works_at (role string, since string)`,
      `CREATE EDGE IF NOT EXISTS belongs_to (role string)`,
    ];

    for (const q of edgeQueries) {
      try {
        await this.execute(q);
      } catch {
        // Edge might exist
      }
    }

    // Wait for schema to propagate
    await new Promise((r) => setTimeout(r, 1000));
  }

  /**
   * Create or update an entity vertex
   */
  async upsertEntity(entity: GraphEntity): Promise<void> {
    this.trace(`upsertEntity: id=${entity.id}, type=${entity.type}, name=${entity.name}`);
    await this.execute(`USE ${this.config.space}`);

    const tagName = entity.type.charAt(0).toUpperCase() + entity.type.slice(1);
    const props = { name: entity.name, ...entity.properties };
    const propNames = Object.keys(props).join(", ");
    const propValues = Object.values(props).map(toNgqlValue).join(", ");

    await this.execute(
      `INSERT VERTEX ${tagName} (${propNames}) VALUES "${escapeValue(entity.id)}":(${propValues})`,
    );
  }

  /**
   * Create a relationship between entities
   */
  async createRelation(relation: GraphRelation): Promise<void> {
    await this.execute(`USE ${this.config.space}`);

    const propNames = Object.keys(relation.properties).join(", ");
    const propValues = Object.values(relation.properties).map(toNgqlValue).join(", ");

    const propsClause = propNames ? `(${propNames})` : "";
    const valuesClause = propNames ? `(${propValues})` : "";

    await this.execute(
      `INSERT EDGE ${relation.type} ${propsClause} VALUES "${escapeValue(relation.sourceId)}"->"${escapeValue(relation.targetId)}"@0:${valuesClause || "()"}`,
    );
  }

  /**
   * Link a memory to entities
   */
  async linkMemory(memoryId: string, entityIds: string[]): Promise<void> {
    this.debug(`linkMemory: memoryId=${memoryId}, entities=[${entityIds.join(", ")}]`);
    await this.execute(`USE ${this.config.space}`);

    // Create memory vertex if not exists
    await this.execute(
      `INSERT VERTEX Memory (qdrantId) VALUES "${escapeValue(memoryId)}":("${escapeValue(memoryId)}")`,
    );

    // Create edges to entities
    for (const entityId of entityIds) {
      try {
        await this.execute(
          `INSERT EDGE mentions (confidence) VALUES "${escapeValue(memoryId)}"->"${escapeValue(entityId)}"@0:(0.8)`,
        );
      } catch {
        // Edge might exist
      }
    }
  }

  /**
   * Remove memory links when memory is deleted
   */
  async unlinkMemory(memoryId: string): Promise<void> {
    this.debug(`unlinkMemory: memoryId=${memoryId}`);
    await this.execute(`USE ${this.config.space}`);

    // Delete the memory vertex and all its edges
    try {
      await this.execute(`DELETE VERTEX "${escapeValue(memoryId)}" WITH EDGE`);
    } catch {
      // Might not exist
    }
  }

  /**
   * Find or create entities, return their IDs
   */
  async ensureEntities(
    entities: Array<{
      type: EntityType;
      name: string;
      properties?: Record<string, string | number | boolean>;
    }>,
  ): Promise<string[]> {
    this.debug(`ensureEntities: count=${entities.length}`);
    const ids: string[] = [];

    for (const e of entities) {
      // Generate deterministic ID from type and name
      const id = `${e.type}_${e.name.toLowerCase().replace(/\s+/g, "_")}`;

      await this.upsertEntity({
        id,
        type: e.type,
        name: e.name,
        properties: e.properties || {},
      });

      ids.push(id);
    }

    return ids;
  }

  /**
   * Find memories related to given entities
   */
  async findRelatedMemories(entityNames: string[]): Promise<string[]> {
    this.debug(`findRelatedMemories: entities=[${entityNames.join(", ")}]`);
    await this.execute(`USE ${this.config.space}`);

    const memoryIds: string[] = [];

    for (const name of entityNames) {
      try {
        // Search for entities by name and find linked memories
        const result = await this.execute(
          `LOOKUP ON Person WHERE Person.name == "${escapeValue(name)}" YIELD id(vertex) as vid | GO FROM $-.vid REVERSELY OVER mentions YIELD src(edge) as memId`,
        );

        if (result.data && result.data.length > 0) {
          for (const row of result.data) {
            if (row.memId) {
              memoryIds.push(String(row.memId));
            }
          }
        }
      } catch {
        // Continue with other entities
      }

      // Also try Organization
      try {
        const result = await this.execute(
          `LOOKUP ON Organization WHERE Organization.name == "${escapeValue(name)}" YIELD id(vertex) as vid | GO FROM $-.vid REVERSELY OVER mentions YIELD src(edge) as memId`,
        );

        if (result.data && result.data.length > 0) {
          for (const row of result.data) {
            if (row.memId) {
              memoryIds.push(String(row.memId));
            }
          }
        }
      } catch {
        // Continue
      }
    }

    // Deduplicate
    return [...new Set(memoryIds)];
  }

  /**
   * Explore entity relationships
   */
  async exploreEntity(entityName: string, maxHops = 2): Promise<GraphExplorationResult | null> {
    this.debug(`exploreEntity: name=${entityName}, maxHops=${maxHops}`);
    await this.execute(`USE ${this.config.space}`);

    // Find entity by name (try all types)
    let entityId: string | null = null;
    let entityType: EntityType | null = null;

    for (const type of ["Person", "Organization", "Concept"] as const) {
      try {
        const result = await this.execute(
          `LOOKUP ON ${type} WHERE ${type}.name == "${escapeValue(entityName)}" YIELD id(vertex) as vid, properties(vertex) as props`,
        );
        if (result.data && result.data.length > 0) {
          entityId = String(result.data[0].vid);
          entityType = type.toLowerCase() as EntityType;
          break;
        }
      } catch {
        // Try next type
      }
    }

    if (!entityId || !entityType) {
      return null;
    }

    const entity: GraphEntity = {
      id: entityId,
      type: entityType,
      name: entityName,
      properties: {},
    };

    const related: GraphExplorationResult["related"] = [];

    // Find outgoing relationships
    try {
      const outResult = await this.execute(
        `GO FROM "${escapeValue(entityId)}" OVER * YIELD dst(edge) as dst, type(edge) as edgeType, properties($$) as props`,
      );
      if (outResult.data) {
        for (const row of outResult.data) {
          if (row.dst && row.edgeType) {
            related.push({
              entity: {
                id: String(row.dst),
                type: "concept", // Would need additional query to determine
                name: row.props?.name || String(row.dst),
                properties: row.props || {},
              },
              relation: String(row.edgeType),
              direction: "out",
            });
          }
        }
      }
    } catch {
      // Continue
    }

    // Find incoming relationships
    try {
      const inResult = await this.execute(
        `GO FROM "${escapeValue(entityId)}" REVERSELY OVER * YIELD src(edge) as src, type(edge) as edgeType, properties($$) as props`,
      );
      if (inResult.data) {
        for (const row of inResult.data) {
          if (row.src && row.edgeType) {
            related.push({
              entity: {
                id: String(row.src),
                type: "concept",
                name: row.props?.name || String(row.src),
                properties: row.props || {},
              },
              relation: String(row.edgeType),
              direction: "in",
            });
          }
        }
      }
    } catch {
      // Continue
    }

    // Find linked memories
    const memories: string[] = [];
    try {
      const memResult = await this.execute(
        `GO FROM "${escapeValue(entityId)}" REVERSELY OVER mentions YIELD src(edge) as memId`,
      );
      if (memResult.data) {
        for (const row of memResult.data) {
          if (row.memId) {
            memories.push(String(row.memId));
          }
        }
      }
    } catch {
      // Continue
    }

    return { entity, related, memories };
  }

  /**
   * Get graph statistics
   */
  async getStats(): Promise<{
    personCount: number;
    organizationCount: number;
    conceptCount: number;
    memoryCount: number;
    relationCount: number;
  }> {
    this.debug("getStats");
    await this.execute(`USE ${this.config.space}`);

    let personCount = 0;
    let organizationCount = 0;
    let conceptCount = 0;
    let memoryCount = 0;
    let relationCount = 0;

    try {
      const personResult = await this.execute(
        `LOOKUP ON Person YIELD id(vertex) | YIELD COUNT(*) as cnt`,
      );
      personCount = personResult.data?.[0]?.cnt || 0;
    } catch {
      // No data
    }

    try {
      const orgResult = await this.execute(
        `LOOKUP ON Organization YIELD id(vertex) | YIELD COUNT(*) as cnt`,
      );
      organizationCount = orgResult.data?.[0]?.cnt || 0;
    } catch {
      // No data
    }

    try {
      const conceptResult = await this.execute(
        `LOOKUP ON Concept YIELD id(vertex) | YIELD COUNT(*) as cnt`,
      );
      conceptCount = conceptResult.data?.[0]?.cnt || 0;
    } catch {
      // No data
    }

    try {
      const memResult = await this.execute(
        `LOOKUP ON Memory YIELD id(vertex) | YIELD COUNT(*) as cnt`,
      );
      memoryCount = memResult.data?.[0]?.cnt || 0;
    } catch {
      // No data
    }

    return {
      personCount,
      organizationCount,
      conceptCount,
      memoryCount,
      relationCount,
    };
  }

  /**
   * Close the connection
   */
  async close(): Promise<void> {
    this.debug("closing connection...");
    if (this.session) {
      try {
        await (this.session as any).close();
        this.debug("connection closed");
      } catch (err) {
        this.debug(`close error (ignored): ${err}`);
      }
      this.session = null;
    } else {
      this.trace("close called but no active session");
    }
  }
}
