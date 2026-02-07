/**
 * OpenClaw Memory Plugin: Qdrant + Nebula Graph
 *
 * Hybrid memory storage combining:
 * - Qdrant for vector search (semantic similarity)
 * - Nebula Graph for knowledge graph (entity relationships)
 *
 * Supports multiple embedding providers: OpenAI, Gemini, Local, Yandex
 * Multi-language triggers: English, Russian, Czech
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import { randomUUID } from "node:crypto";
import { stringEnum } from "openclaw/plugin-sdk";
import {
  MEMORY_CATEGORIES,
  type MemoryCategory,
  type MemoryQdrantNebulaConfig,
  memoryQdrantNebulaConfigSchema,
  vectorDimsForModel,
} from "./config.js";
import {
  extractEntities,
  extractEntityNames,
  extractRelations,
  type ExtractedEntity,
} from "./entity-extractor.js";
import { HybridSearch, formatSearchResults, sanitizeSearchResults } from "./hybrid-search.js";
import { NebulaMemoryClient } from "./nebula-client.js";
import { QdrantMemoryClient, type QdrantPayload, type QdrantPoint } from "./qdrant-client.js";
import {
  shouldCapture,
  detectCategory,
  detectLanguage,
  calculateImportance,
  extractMessageTexts,
} from "./triggers.js";

// ============================================================================
// Types
// ============================================================================

type EmbeddingProvider = {
  id: string;
  model: string;
  embedQuery: (text: string) => Promise<number[]>;
  embedBatch: (texts: string[]) => Promise<number[][]>;
};

// ============================================================================
// Embedding Provider Factory
// ============================================================================

function resolveEnvVar(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.replace(/\$\{([^}]+)\}/g, (_, envVar) => {
    return process.env[envVar] || "";
  });
}

async function createOpenAiEmbeddings(cfg: MemoryQdrantNebulaConfig): Promise<EmbeddingProvider> {
  const apiKey = resolveEnvVar(cfg.embedding.remote?.apiKey) || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OpenAI API key is required. Set embedding.remote.apiKey or OPENAI_API_KEY env var.",
    );
  }

  const baseUrl = cfg.embedding.remote?.baseUrl || "https://api.openai.com/v1";
  const model = cfg.embedding.model;

  const embed = async (texts: string[]): Promise<number[][]> => {
    if (texts.length === 0) return [];

    const res = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...cfg.embedding.remote?.headers,
      },
      body: JSON.stringify({ model, input: texts }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI embeddings failed: ${res.status} ${text}`);
    }

    const payload = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
    return (payload.data ?? []).map((entry) => entry.embedding ?? []);
  };

  return {
    id: "openai",
    model,
    embedQuery: async (text) => {
      const [vec] = await embed([text]);
      return vec ?? [];
    },
    embedBatch: embed,
  };
}

async function createGeminiEmbeddings(cfg: MemoryQdrantNebulaConfig): Promise<EmbeddingProvider> {
  const apiKey =
    resolveEnvVar(cfg.embedding.remote?.apiKey) ||
    process.env.GOOGLE_API_KEY ||
    process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "Gemini API key is required. Set embedding.remote.apiKey or GOOGLE_API_KEY env var.",
    );
  }

  const baseUrl =
    cfg.embedding.remote?.baseUrl || "https://generativelanguage.googleapis.com/v1beta";
  const model = cfg.embedding.model || "gemini-embedding-001";
  const modelPath = model.startsWith("models/") ? model : `models/${model}`;

  const embedQuery = async (text: string): Promise<number[]> => {
    const res = await fetch(`${baseUrl}/${modelPath}:embedContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
        ...cfg.embedding.remote?.headers,
      },
      body: JSON.stringify({
        content: { parts: [{ text }] },
        taskType: "RETRIEVAL_QUERY",
      }),
    });

    if (!res.ok) {
      const payload = await res.text();
      throw new Error(`Gemini embeddings failed: ${res.status} ${payload}`);
    }

    const payload = (await res.json()) as { embedding?: { values?: number[] } };
    return payload.embedding?.values ?? [];
  };

  return {
    id: "gemini",
    model,
    embedQuery,
    embedBatch: async (texts) => {
      const results: number[][] = [];
      for (const text of texts) {
        results.push(await embedQuery(text));
      }
      return results;
    },
  };
}

async function createYandexEmbeddings(cfg: MemoryQdrantNebulaConfig): Promise<EmbeddingProvider> {
  const apiKey = resolveEnvVar(cfg.embedding.remote?.apiKey);
  if (!apiKey) {
    throw new Error("Yandex API key is required. Set embedding.remote.apiKey.");
  }

  const baseUrl =
    cfg.embedding.remote?.baseUrl || "https://llm.api.cloud.yandex.net/foundationModels/v1";
  const folderId = cfg.embedding.remote?.headers?.["x-folder-id"];
  const model =
    cfg.embedding.model ||
    (folderId ? `emb://${folderId}/text-search-doc/latest` : "text-search-doc/latest");

  const embedSingle = async (text: string): Promise<number[]> => {
    const res = await fetch(`${baseUrl}/textEmbedding`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Api-Key ${apiKey}`,
        ...cfg.embedding.remote?.headers,
      },
      body: JSON.stringify({ modelUri: model, text }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Yandex embeddings failed: ${res.status} ${errText}`);
    }

    const payload = (await res.json()) as { embedding?: number[] };
    return payload.embedding ?? [];
  };

  return {
    id: "yandex",
    model,
    embedQuery: embedSingle,
    embedBatch: async (texts) => {
      const results: number[][] = [];
      for (const text of texts) {
        results.push(await embedSingle(text));
      }
      return results;
    },
  };
}

async function createEmbeddingProvider(cfg: MemoryQdrantNebulaConfig): Promise<EmbeddingProvider> {
  const provider = cfg.embedding.provider;

  if (provider === "gemini") {
    return createGeminiEmbeddings(cfg);
  }

  if (provider === "yandex") {
    return createYandexEmbeddings(cfg);
  }

  if (provider === "auto") {
    // Try OpenAI first, then Gemini
    const hasOpenAi = Boolean(cfg.embedding.remote?.apiKey || process.env.OPENAI_API_KEY);
    if (hasOpenAi) {
      return createOpenAiEmbeddings(cfg);
    }

    const hasGemini = Boolean(
      cfg.embedding.remote?.apiKey || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY,
    );
    if (hasGemini) {
      return createGeminiEmbeddings(cfg);
    }

    throw new Error(
      "No embedding provider configured. Set OPENAI_API_KEY, GOOGLE_API_KEY, or configure embedding.remote.apiKey.",
    );
  }

  // Default to OpenAI
  return createOpenAiEmbeddings(cfg);
}

// ============================================================================
// Plugin Definition
// ============================================================================

const memoryQdrantNebulaPlugin = {
  id: "memory-qdrant-nebula",
  name: "Memory (Qdrant + Nebula)",
  description: "Hybrid long-term memory with vector search and knowledge graph",
  kind: "memory" as const,
  configSchema: memoryQdrantNebulaConfigSchema,

  async register(api: OpenClawPluginApi) {
    const cfg = memoryQdrantNebulaConfigSchema.parse(api.pluginConfig);
    const agentId = api.runtime.agentId || "default";
    const vectorDim = vectorDimsForModel(cfg.embedding.model);

    // Initialize clients (lazy)
    let qdrant: QdrantMemoryClient | null = null;
    let nebula: NebulaMemoryClient | null = null;
    let embeddings: EmbeddingProvider | null = null;
    let hybridSearch: HybridSearch | null = null;

    const ensureClients = async () => {
      if (!embeddings) {
        embeddings = await createEmbeddingProvider(cfg);
      }
      if (!qdrant) {
        qdrant = new QdrantMemoryClient(cfg.qdrant, agentId, vectorDim);
      }
      if (!nebula) {
        nebula = new NebulaMemoryClient(cfg.nebula, api.logger);
      }
      if (!hybridSearch) {
        hybridSearch = new HybridSearch(qdrant, nebula);
      }
      return { embeddings, qdrant, nebula, hybridSearch };
    };

    api.logger.info(
      `memory-qdrant-nebula: plugin registered (qdrant: ${cfg.qdrant.url}, nebula: ${cfg.nebula.host}:${cfg.nebula.port}, lazy init)`,
    );

    // ========================================================================
    // Tools
    // ========================================================================

    api.registerTool(
      {
        name: "memory_recall",
        label: "Memory Recall",
        description:
          "Search through long-term memories. Use when you need context about user preferences, past decisions, or previously discussed topics.",
        parameters: Type.Object({
          query: Type.String({ description: "Search query" }),
          limit: Type.Optional(Type.Number({ description: "Max results (default: 5)" })),
          includeGraph: Type.Optional(
            Type.Boolean({ description: "Include graph relationships (default: true)" }),
          ),
        }),
        async execute(_toolCallId, params) {
          const {
            query,
            limit = 5,
            includeGraph = true,
          } = params as {
            query: string;
            limit?: number;
            includeGraph?: boolean;
          };

          const clients = await ensureClients();
          const vector = await clients.embeddings.embedQuery(query);

          // Extract entities from query for graph search
          const entityNames = extractEntityNames(query);

          // Perform hybrid search
          const results = await clients.hybridSearch.search(vector, query, entityNames, {
            limit,
            includeGraph: includeGraph && cfg.graphEnrichment,
            hybridWeight: cfg.hybridWeight,
          });

          if (results.length === 0) {
            return {
              content: [{ type: "text", text: "No relevant memories found." }],
              details: { count: 0 },
            };
          }

          // Enrich with entity info if graph enabled
          const enrichedResults = cfg.graphEnrichment
            ? await clients.hybridSearch.enrichWithEntities(results)
            : results;

          const text = formatSearchResults(enrichedResults);
          const sanitized = sanitizeSearchResults(enrichedResults);

          return {
            content: [{ type: "text", text: `Found ${results.length} memories:\n\n${text}` }],
            details: { count: results.length, memories: sanitized },
          };
        },
      },
      { name: "memory_recall" },
    );

    api.registerTool(
      {
        name: "memory_store",
        label: "Memory Store",
        description:
          "Save important information in long-term memory. Use for preferences, facts, decisions.",
        parameters: Type.Object({
          text: Type.String({ description: "Information to remember" }),
          importance: Type.Optional(Type.Number({ description: "Importance 0-1 (default: auto)" })),
          category: Type.Optional(stringEnum(MEMORY_CATEGORIES)),
        }),
        async execute(_toolCallId, params) {
          const { text, importance, category } = params as {
            text: string;
            importance?: number;
            category?: MemoryCategory;
          };

          const clients = await ensureClients();
          const vector = await clients.embeddings.embedQuery(text);

          // Check for duplicates
          const existing = await clients.qdrant.search(vector, 1, 0.95);
          if (existing.length > 0) {
            return {
              content: [
                {
                  type: "text",
                  text: `Similar memory already exists: "${existing[0].point.payload.text}"`,
                },
              ],
              details: {
                action: "duplicate",
                existingId: existing[0].point.id,
                existingText: existing[0].point.payload.text,
              },
            };
          }

          // Detect properties
          const detectedCategory = category || detectCategory(text);
          const detectedLanguage = detectLanguage(text);
          const detectedImportance = importance ?? calculateImportance(text);

          // Extract entities and relations
          const entities = extractEntities(text);
          const relations = extractRelations(text);
          let entityIds: string[] = [];

          if (entities.length > 0 && cfg.graphEnrichment) {
            // Create entities in Nebula
            entityIds = await clients.nebula.ensureEntities(
              entities.map((e) => ({
                type: e.type,
                name: e.name,
                properties: e.properties,
              })),
            );

            // Create relations between entities
            for (const rel of relations) {
              const sourceId = `${rel.sourceType}_${rel.sourceName.toLowerCase().replace(/\s+/g, "_")}`;
              const targetId = `${rel.targetType}_${rel.targetName.toLowerCase().replace(/\s+/g, "_")}`;

              // Only create relation if both entities exist
              if (entityIds.includes(sourceId) || entityIds.includes(targetId)) {
                try {
                  await clients.nebula.createRelation({
                    sourceId,
                    targetId,
                    type: rel.relationType,
                    properties: rel.properties,
                  });
                } catch {
                  // Relation might already exist or entities not found
                }
              }
            }
          }

          // Store in Qdrant
          const id = randomUUID();
          const payload: QdrantPayload = {
            id,
            text,
            category: detectedCategory,
            importance: detectedImportance,
            createdAt: Date.now(),
            language: detectedLanguage,
            entityIds,
          };

          await clients.qdrant.upsert({
            id,
            vector,
            payload,
          });

          // Link memory to entities in Nebula
          if (entityIds.length > 0 && cfg.graphEnrichment) {
            await clients.nebula.linkMemory(id, entityIds);
          }

          const entityNames = entities.map((e) => e.name);
          const entityInfo =
            entityNames.length > 0 ? ` Linked entities: ${entityNames.join(", ")}` : "";

          return {
            content: [{ type: "text", text: `Stored: "${text.slice(0, 100)}..."${entityInfo}` }],
            details: {
              action: "created",
              id,
              category: detectedCategory,
              importance: detectedImportance,
              entities: entityNames,
            },
          };
        },
      },
      { name: "memory_store" },
    );

    api.registerTool(
      {
        name: "memory_graph",
        label: "Memory Graph",
        description: "Explore the knowledge graph to find relationships and connected memories.",
        parameters: Type.Object({
          entity: Type.String({ description: "Entity name to explore" }),
          maxHops: Type.Optional(
            Type.Number({ description: "Max relationship depth (default: 2)" }),
          ),
        }),
        async execute(_toolCallId, params) {
          const { entity, maxHops = 2 } = params as { entity: string; maxHops?: number };

          const clients = await ensureClients();
          const result = await clients.nebula.exploreEntity(entity, maxHops);

          if (!result) {
            return {
              content: [{ type: "text", text: `Entity "${entity}" not found in knowledge graph.` }],
              details: { found: false },
            };
          }

          // Format relationships
          const relationships = result.related.map((r) => {
            const direction = r.direction === "out" ? "->" : "<-";
            return `  ${direction} [${r.relation}] ${r.entity.name}`;
          });

          const relText =
            relationships.length > 0
              ? `Relationships:\n${relationships.join("\n")}`
              : "No relationships found.";

          const memText =
            result.memories.length > 0
              ? `\n\nLinked memories: ${result.memories.length}`
              : "\n\nNo linked memories.";

          return {
            content: [
              {
                type: "text",
                text: `Entity: ${result.entity.name} (${result.entity.type})\n\n${relText}${memText}`,
              },
            ],
            details: {
              entity: {
                id: result.entity.id,
                name: result.entity.name,
                type: result.entity.type,
              },
              relationships: result.related.map((r) => ({
                entity: r.entity.name,
                relation: r.relation,
                direction: r.direction,
              })),
              memoryCount: result.memories.length,
            },
          };
        },
      },
      { name: "memory_graph" },
    );

    api.registerTool(
      {
        name: "memory_forget",
        label: "Memory Forget",
        description: "Delete specific memories. GDPR-compliant with full graph cleanup.",
        parameters: Type.Object({
          query: Type.Optional(Type.String({ description: "Search to find memory" })),
          memoryId: Type.Optional(Type.String({ description: "Specific memory ID" })),
        }),
        async execute(_toolCallId, params) {
          const { query, memoryId } = params as { query?: string; memoryId?: string };

          const clients = await ensureClients();

          if (memoryId) {
            // Delete from Qdrant
            await clients.qdrant.delete(memoryId);
            // Remove from Nebula graph
            await clients.nebula.unlinkMemory(memoryId);

            return {
              content: [{ type: "text", text: `Memory ${memoryId} forgotten.` }],
              details: { action: "deleted", id: memoryId },
            };
          }

          if (query) {
            const vector = await clients.embeddings.embedQuery(query);
            const results = await clients.qdrant.search(vector, 5, 0.7);

            if (results.length === 0) {
              return {
                content: [{ type: "text", text: "No matching memories found." }],
                details: { found: 0 },
              };
            }

            // If single high-confidence match, delete it
            if (results.length === 1 && results[0].score > 0.9) {
              const id = results[0].point.id;
              await clients.qdrant.delete(id);
              await clients.nebula.unlinkMemory(id);

              return {
                content: [{ type: "text", text: `Forgotten: "${results[0].point.payload.text}"` }],
                details: { action: "deleted", id },
              };
            }

            // Multiple candidates - ask for confirmation
            const list = results
              .map((r) => `- [${r.point.id.slice(0, 8)}] ${r.point.payload.text.slice(0, 60)}...`)
              .join("\n");

            const sanitizedCandidates = results.map((r) => ({
              id: r.point.id,
              text: r.point.payload.text,
              category: r.point.payload.category,
              score: r.score,
            }));

            return {
              content: [
                {
                  type: "text",
                  text: `Found ${results.length} candidates. Specify memoryId:\n${list}`,
                },
              ],
              details: { action: "candidates", candidates: sanitizedCandidates },
            };
          }

          return {
            content: [{ type: "text", text: "Provide query or memoryId." }],
            details: { error: "missing_param" },
          };
        },
      },
      { name: "memory_forget" },
    );

    // ========================================================================
    // CLI Commands
    // ========================================================================

    api.registerCli(
      ({ program }) => {
        const mem = program
          .command("qn-memory")
          .description("Qdrant + Nebula memory plugin commands");

        mem
          .command("search")
          .description("Search memories")
          .argument("<query>", "Search query")
          .option("--limit <n>", "Max results", "5")
          .option("--no-graph", "Disable graph search")
          .action(async (query, opts) => {
            const clients = await ensureClients();
            const vector = await clients.embeddings.embedQuery(query);
            const entityNames = extractEntityNames(query);

            const results = await clients.hybridSearch.search(vector, query, entityNames, {
              limit: parseInt(opts.limit),
              includeGraph: opts.graph !== false,
              hybridWeight: cfg.hybridWeight,
            });

            const enriched = await clients.hybridSearch.enrichWithEntities(results);
            const output = sanitizeSearchResults(enriched);
            api.logger.info(JSON.stringify(output, null, 2));
          });

        mem
          .command("graph")
          .description("Explore entity in knowledge graph")
          .argument("<entity>", "Entity name")
          .option("--depth <n>", "Max depth", "2")
          .action(async (entity, opts) => {
            const clients = await ensureClients();
            const result = await clients.nebula.exploreEntity(entity, parseInt(opts.depth));
            api.logger.info(JSON.stringify(result, null, 2));
          });

        mem
          .command("stats")
          .description("Show memory statistics")
          .action(async () => {
            const clients = await ensureClients();
            const qdrantStats = await clients.qdrant.getCollectionInfo();
            const nebulaStats = await clients.nebula.getStats();
            api.logger.debug(
              JSON.stringify(
                {
                  qdrant: qdrantStats,
                  nebula: nebulaStats,
                },
                null,
                2,
              ),
            );
          });

        mem
          .command("sync")
          .description("Synchronize Qdrant and Nebula (rebuild graph links)")
          .action(async () => {
            const clients = await ensureClients();

            // Get all memory IDs from Qdrant
            const ids = await clients.qdrant.getAllIds();
            api.logger.debug(`Found ${ids.length} memories in Qdrant`);

            let synced = 0;
            for (const id of ids) {
              const point = await clients.qdrant.getById(id);
              if (!point) {
                continue;
              }

              // Re-extract entities
              const entities = extractEntities(point.payload.text);
              if (entities.length === 0) {
                continue;
              }

              // Ensure entities in graph
              const entityIds = await clients.nebula.ensureEntities(
                entities.map((e) => ({
                  type: e.type,
                  name: e.name,
                  properties: e.properties,
                })),
              );

              // Update Qdrant payload
              await clients.qdrant.updatePayload(id, { entityIds });

              // Link in Nebula
              await clients.nebula.linkMemory(id, entityIds);

              synced++;
            }

            console.log(`Synced ${synced} memories with entities`);
          });
      },
      { commands: ["qn-memory"] },
    );

    // ========================================================================
    // Lifecycle Hooks
    // ========================================================================

    // Auto-recall: inject relevant memories before agent starts
    if (cfg.autoRecall) {
      api.on("before_agent_start", async (event) => {
        if (!event.prompt || event.prompt.length < 5) {
          return;
        }

        try {
          const clients = await ensureClients();
          const vector = await clients.embeddings.embedQuery(event.prompt);
          const entityNames = extractEntityNames(event.prompt);

          const results = await clients.hybridSearch.search(vector, event.prompt, entityNames, {
            limit: 3,
            minScore: 0.3,
            includeGraph: cfg.graphEnrichment,
            hybridWeight: cfg.hybridWeight,
          });

          if (results.length === 0) {
            return;
          }

          // Enrich with entities
          const enriched = cfg.graphEnrichment
            ? await clients.hybridSearch.enrichWithEntities(results)
            : results;

          const memoryContext = enriched
            .map((r) => {
              let line = `- [${r.memory.category}] ${r.memory.text}`;
              if (r.memory.entities && r.memory.entities.length > 0) {
                line += ` (linked: ${r.memory.entities.map((e) => e.name).join(", ")})`;
              }
              return line;
            })
            .join("\n");

          api.logger.info?.(
            `memory-qdrant-nebula: injecting ${results.length} memories into context`,
          );

          return {
            prependContext: `<relevant-memories>\nThe following memories may be relevant to this conversation:\n${memoryContext}\n</relevant-memories>`,
          };
        } catch (err) {
          api.logger.warn(`memory-qdrant-nebula: recall failed: ${String(err)}`);
        }
      });
    }

    // Auto-capture: analyze and store important information after agent ends
    if (cfg.autoCapture) {
      api.on("agent_end", async (event) => {
        if (!event.success || !event.messages || event.messages.length === 0) {
          api.logger.debug?.(
            `memory-qdrant-nebula: auto-capture skip (success=${event.success}, messages=${event.messages?.length ?? 0})`,
          );
          return;
        }

        try {
          const clients = await ensureClients();

          // Extract text content from messages
          const texts = extractMessageTexts(event.messages);
          api.logger.debug?.(`memory-qdrant-nebula: extracted ${texts.length} texts from messages`);
          for (const t of texts) {
            api.logger.trace?.(
              `memory-qdrant-nebula: text (${t.length} chars): "${t.slice(0, 80)}..."`,
            );
          }

          // Filter for capturable content
          const toCapture = texts.filter((text) => shouldCapture(text, cfg.languages));
          api.logger.debug?.(
            `memory-qdrant-nebula: ${toCapture.length}/${texts.length} passed shouldCapture (languages: ${cfg.languages.join(",")})`,
          );
          if (toCapture.length === 0) {
            return;
          }

          // Store each capturable piece (limit to 3 per conversation)
          let stored = 0;
          for (const text of toCapture.slice(0, 3)) {
            const category = detectCategory(text);
            const language = detectLanguage(text);
            const importance = calculateImportance(text);
            const vector = await clients.embeddings.embedQuery(text);

            // Check for duplicates
            const existing = await clients.qdrant.search(vector, 1, 0.95);
            if (existing.length > 0) {
              continue;
            }

            // Extract entities and relations
            const entities = extractEntities(text);
            const relations = extractRelations(text);
            let entityIds: string[] = [];

            if (entities.length > 0 && cfg.graphEnrichment) {
              entityIds = await clients.nebula.ensureEntities(
                entities.map((e) => ({
                  type: e.type,
                  name: e.name,
                  properties: e.properties,
                })),
              );

              // Create relations between entities
              for (const rel of relations) {
                const sourceId = `${rel.sourceType}_${rel.sourceName.toLowerCase().replace(/\s+/g, "_")}`;
                const targetId = `${rel.targetType}_${rel.targetName.toLowerCase().replace(/\s+/g, "_")}`;

                if (entityIds.includes(sourceId) || entityIds.includes(targetId)) {
                  try {
                    await clients.nebula.createRelation({
                      sourceId,
                      targetId,
                      type: rel.relationType,
                      properties: rel.properties,
                    });
                  } catch {
                    // Relation might already exist
                  }
                }
              }
            }

            // Store
            const id = randomUUID();
            await clients.qdrant.upsert({
              id,
              vector,
              payload: {
                id,
                text,
                category,
                importance,
                createdAt: Date.now(),
                language,
                entityIds,
              },
            });

            // Link in graph
            if (entityIds.length > 0 && cfg.graphEnrichment) {
              await clients.nebula.linkMemory(id, entityIds);
            }

            stored++;
          }

          if (stored > 0) {
            api.logger.info(`memory-qdrant-nebula: auto-captured ${stored} memories`);
          }
        } catch (err) {
          api.logger.warn(`memory-qdrant-nebula: capture failed: ${String(err)}`);
        }
      });
    }

    // ========================================================================
    // Service
    // ========================================================================

    api.registerService({
      id: "memory-qdrant-nebula",
      start: () => {
        api.logger.info(
          `memory-qdrant-nebula: initialized (qdrant: ${cfg.qdrant.url}, nebula: ${cfg.nebula.host}:${cfg.nebula.port}, embedding: ${cfg.embedding.provider}/${cfg.embedding.model})`,
        );
      },
      stop: async () => {
        if (nebula) {
          await nebula.close();
        }
        api.logger.info("memory-qdrant-nebula: stopped");
      },
    });
  },
};

export default memoryQdrantNebulaPlugin;
