/**
 * Qdrant vector database adapter
 */

import type { QdrantClient as QdrantClientType } from "@qdrant/js-client-rest";
import type { QdrantConfig, MemoryCategory } from "./config.js";

// ============================================================================
// Types
// ============================================================================

export type QdrantPayload = {
  id: string;
  text: string;
  category: MemoryCategory;
  importance: number;
  createdAt: number;
  language: "en" | "ru" | "cs";
  entityIds: string[];
};

export type QdrantPoint = {
  id: string;
  vector: number[];
  payload: QdrantPayload;
};

export type QdrantSearchResult = {
  point: QdrantPoint;
  score: number;
};

// ============================================================================
// Qdrant Client Wrapper
// ============================================================================

export class QdrantMemoryClient {
  private client: QdrantClientType | null = null;
  private initPromise: Promise<void> | null = null;
  private collectionName: string;

  constructor(
    private readonly config: QdrantConfig,
    private readonly agentId: string,
    private readonly vectorDim: number,
  ) {
    const prefix = config.collectionPrefix || "openclaw_memories";
    this.collectionName = `${prefix}_${agentId}`;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.client) {
      return;
    }
    if (this.initPromise) {
      return this.initPromise;
    }
    this.initPromise = this.doInitialize();
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    // Dynamic import to avoid bundling issues
    const { QdrantClient } = await import("@qdrant/js-client-rest");

    this.client = new QdrantClient({
      url: this.config.url,
      apiKey: this.config.apiKey,
    });

    // Check if collection exists, create if not
    const collections = await this.client.getCollections();
    const exists = collections.collections.some((c) => c.name === this.collectionName);

    if (!exists) {
      await this.client.createCollection(this.collectionName, {
        vectors: {
          size: this.vectorDim,
          distance: "Cosine",
        },
      });

      // Create payload indexes for filtering
      await this.client.createPayloadIndex(this.collectionName, {
        field_name: "category",
        field_schema: "keyword",
      });
      await this.client.createPayloadIndex(this.collectionName, {
        field_name: "language",
        field_schema: "keyword",
      });
      await this.client.createPayloadIndex(this.collectionName, {
        field_name: "importance",
        field_schema: "float",
      });
    }
  }

  /**
   * Insert or update a memory point
   */
  async upsert(point: QdrantPoint): Promise<void> {
    await this.ensureInitialized();
    await this.client!.upsert(this.collectionName, {
      wait: true,
      points: [
        {
          id: point.id,
          vector: point.vector,
          payload: point.payload,
        },
      ],
    });
  }

  /**
   * Search for similar memories
   */
  async search(
    vector: number[],
    limit = 5,
    minScore = 0.3,
    filter?: {
      category?: MemoryCategory;
      language?: "en" | "ru" | "cs";
    },
  ): Promise<QdrantSearchResult[]> {
    await this.ensureInitialized();

    const searchParams: Parameters<QdrantClientType["search"]>[1] = {
      vector,
      limit,
      score_threshold: minScore,
      with_payload: true,
      with_vector: true,
    };

    // Build filter conditions
    const must: Array<Record<string, unknown>> = [];
    if (filter?.category) {
      must.push({ key: "category", match: { value: filter.category } });
    }
    if (filter?.language) {
      must.push({ key: "language", match: { value: filter.language } });
    }
    if (must.length > 0) {
      searchParams.filter = { must };
    }

    const results = await this.client!.search(this.collectionName, searchParams);

    return results.map((r) => ({
      point: {
        id: r.id as string,
        vector: r.vector as number[],
        payload: r.payload as QdrantPayload,
      },
      score: r.score,
    }));
  }

  /**
   * Delete a memory by ID
   */
  async delete(id: string): Promise<void> {
    await this.ensureInitialized();
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      throw new Error(`Invalid memory ID format: ${id}`);
    }
    await this.client!.delete(this.collectionName, {
      wait: true,
      points: [id],
    });
  }

  /**
   * Update payload fields for a point
   */
  async updatePayload(id: string, payload: Partial<QdrantPayload>): Promise<void> {
    await this.ensureInitialized();
    await this.client!.setPayload(this.collectionName, {
      wait: true,
      points: [id],
      payload,
    });
  }

  /**
   * Get collection info (for stats)
   */
  async getCollectionInfo(): Promise<{
    pointsCount: number;
    vectorsCount: number;
    indexedVectorsCount: number;
    segmentsCount: number;
  }> {
    await this.ensureInitialized();
    const info = await this.client!.getCollection(this.collectionName);
    return {
      pointsCount: info.points_count ?? 0,
      vectorsCount: info.vectors_count ?? 0,
      indexedVectorsCount: info.indexed_vectors_count ?? 0,
      segmentsCount: info.segments_count ?? 0,
    };
  }

  /**
   * Get all memory IDs (for sync)
   */
  async getAllIds(limit = 1000): Promise<string[]> {
    await this.ensureInitialized();
    const results = await this.client!.scroll(this.collectionName, {
      limit,
      with_payload: false,
      with_vector: false,
    });
    return results.points.map((p) => p.id as string);
  }

  /**
   * Get a specific point by ID
   */
  async getById(id: string): Promise<QdrantPoint | null> {
    await this.ensureInitialized();
    try {
      const results = await this.client!.retrieve(this.collectionName, {
        ids: [id],
        with_payload: true,
        with_vector: true,
      });
      if (results.length === 0) {
        return null;
      }
      const r = results[0];
      return {
        id: r.id as string,
        vector: r.vector as number[],
        payload: r.payload as QdrantPayload,
      };
    } catch {
      return null;
    }
  }
}
