/**
 * Hybrid search combining vector (Qdrant) and graph (Nebula) results
 */

import type { MemoryCategory } from "./config.js";
import type { NebulaMemoryClient, GraphExplorationResult } from "./nebula-client.js";
import type { QdrantMemoryClient, QdrantSearchResult, QdrantPayload } from "./qdrant-client.js";

// ============================================================================
// Types
// ============================================================================

export type HybridSearchResult = {
  memory: {
    id: string;
    text: string;
    category: MemoryCategory;
    importance: number;
    language: "en" | "ru" | "cs";
    createdAt: number;
    entities?: Array<{
      id: string;
      name: string;
      type: string;
    }>;
  };
  vectorScore: number;
  graphScore: number;
  combinedScore: number;
  source: "vector" | "graph" | "both";
};

export type HybridSearchOptions = {
  limit?: number;
  minScore?: number;
  hybridWeight?: number;
  includeGraph?: boolean;
  category?: MemoryCategory;
  language?: "en" | "ru" | "cs";
};

// ============================================================================
// Hybrid Search Implementation
// ============================================================================

export class HybridSearch {
  constructor(
    private readonly qdrant: QdrantMemoryClient,
    private readonly nebula: NebulaMemoryClient,
  ) {}

  /**
   * Perform hybrid search combining vector and graph results
   */
  async search(
    vector: number[],
    query: string,
    entityNames: string[],
    options: HybridSearchOptions = {},
  ): Promise<HybridSearchResult[]> {
    const {
      limit = 5,
      minScore = 0.3,
      hybridWeight = 0.7,
      includeGraph = true,
      category,
      language,
    } = options;

    // 1. Vector search in Qdrant
    const vectorResults = await this.qdrant.search(vector, limit * 2, minScore, {
      category,
      language,
    });

    // 2. Graph search in Nebula (if enabled and entities found)
    let graphMemoryIds: Set<string> = new Set();
    if (includeGraph && entityNames.length > 0) {
      const graphIds = await this.nebula.findRelatedMemories(entityNames);
      graphMemoryIds = new Set(graphIds);
    }

    // 3. Combine results
    const resultsMap = new Map<string, HybridSearchResult>();

    // Process vector results
    for (const vr of vectorResults) {
      const id = vr.point.id;
      const isInGraph = graphMemoryIds.has(id);

      resultsMap.set(id, {
        memory: {
          id,
          text: vr.point.payload.text,
          category: vr.point.payload.category,
          importance: vr.point.payload.importance,
          language: vr.point.payload.language,
          createdAt: vr.point.payload.createdAt,
        },
        vectorScore: vr.score,
        graphScore: isInGraph ? 0.5 : 0, // Boost if found in graph
        combinedScore: 0, // Will calculate below
        source: isInGraph ? "both" : "vector",
      });
    }

    // Add graph-only results (fetch from Qdrant if not already present)
    for (const graphId of graphMemoryIds) {
      if (!resultsMap.has(graphId)) {
        try {
          const point = await this.qdrant.getById(graphId);
          if (point) {
            resultsMap.set(graphId, {
              memory: {
                id: graphId,
                text: point.payload.text,
                category: point.payload.category,
                importance: point.payload.importance,
                language: point.payload.language,
                createdAt: point.payload.createdAt,
              },
              vectorScore: 0,
              graphScore: 0.7, // Higher score for graph matches without vector
              combinedScore: 0,
              source: "graph",
            });
          }
        } catch {
          // Skip if can't fetch
        }
      }
    }

    // 4. Calculate combined scores and sort
    const results = Array.from(resultsMap.values());
    for (const r of results) {
      // Weighted combination of vector and graph scores
      const vectorComponent = r.vectorScore * hybridWeight;
      const graphComponent = r.graphScore * (1 - hybridWeight);

      // Boost for importance
      const importanceBoost = r.memory.importance * 0.1;

      r.combinedScore = vectorComponent + graphComponent + importanceBoost;
    }

    // Sort by combined score (descending)
    results.sort((a, b) => b.combinedScore - a.combinedScore);

    // Return top results
    return results.slice(0, limit);
  }

  /**
   * Enrich results with entity information from the graph
   */
  async enrichWithEntities(results: HybridSearchResult[]): Promise<HybridSearchResult[]> {
    const enriched: HybridSearchResult[] = [];

    for (const r of results) {
      try {
        // Get entities linked to this memory from Qdrant payload
        const point = await this.qdrant.getById(r.memory.id);
        if (point && point.payload.entityIds && point.payload.entityIds.length > 0) {
          const entities: Array<{ id: string; name: string; type: string }> = [];

          // For each entity ID, try to get info from graph
          for (const entityId of point.payload.entityIds) {
            // Extract type and name from ID (format: type_name)
            const parts = entityId.split("_");
            if (parts.length >= 2) {
              const type = parts[0];
              const name = parts.slice(1).join(" ").replace(/_/g, " ");
              // Capitalize first letter of each word
              const formattedName = name.replace(/\b\w/g, (c) => c.toUpperCase());
              entities.push({ id: entityId, type, name: formattedName });
            }
          }

          enriched.push({
            ...r,
            memory: {
              ...r.memory,
              entities,
            },
          });
        } else {
          enriched.push(r);
        }
      } catch {
        // Keep original result if enrichment fails
        enriched.push(r);
      }
    }

    return enriched;
  }

  /**
   * Merge vector and graph results with deduplication
   */
  static mergeResults(
    vectorResults: QdrantSearchResult[],
    graphMemoryIds: string[],
    hybridWeight: number,
  ): Map<string, { vectorScore: number; graphScore: number }> {
    const merged = new Map<string, { vectorScore: number; graphScore: number }>();

    // Add vector results
    for (const vr of vectorResults) {
      merged.set(vr.point.id, {
        vectorScore: vr.score,
        graphScore: 0,
      });
    }

    // Add/update graph results
    for (const id of graphMemoryIds) {
      const existing = merged.get(id);
      if (existing) {
        existing.graphScore = 0.5; // Found in both
      } else {
        merged.set(id, {
          vectorScore: 0,
          graphScore: 0.7, // Graph only
        });
      }
    }

    return merged;
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format search results for display
 */
export function formatSearchResults(results: HybridSearchResult[]): string {
  if (results.length === 0) {
    return "No relevant memories found.";
  }

  return results
    .map((r, i) => {
      let line = `${i + 1}. [${r.memory.category}] ${r.memory.text} (${(r.combinedScore * 100).toFixed(0)}%)`;

      if (r.memory.entities && r.memory.entities.length > 0) {
        const entityNames = r.memory.entities.map((e) => e.name).join(", ");
        line += `\n   Linked: ${entityNames}`;
      }

      return line;
    })
    .join("\n\n");
}

/**
 * Prepare results for JSON serialization (strip non-essential data)
 */
export function sanitizeSearchResults(results: HybridSearchResult[]): Array<{
  id: string;
  text: string;
  category: MemoryCategory;
  importance: number;
  score: number;
  source: string;
  entities?: Array<{ name: string; type: string }>;
}> {
  return results.map((r) => ({
    id: r.memory.id,
    text: r.memory.text,
    category: r.memory.category,
    importance: r.memory.importance,
    score: r.combinedScore,
    source: r.source,
    entities: r.memory.entities?.map((e) => ({ name: e.name, type: e.type })),
  }));
}
