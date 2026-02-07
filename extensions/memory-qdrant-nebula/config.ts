/**
 * Configuration types and schema for Qdrant + Nebula memory plugin
 */

import { homedir } from "node:os";
import { join } from "node:path";

// ============================================================================
// Types
// ============================================================================

export type SupportedLanguage = "en" | "ru" | "cs";

export type EmbeddingProviderType = "openai" | "gemini" | "local" | "yandex" | "auto";
export type EmbeddingFallbackType = "openai" | "gemini" | "local" | "none";

export type QdrantConfig = {
  url: string;
  apiKey?: string;
  collectionPrefix?: string;
};

export type NebulaConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  space: string;
};

export type EmbeddingConfig = {
  provider: EmbeddingProviderType;
  model: string;
  remote?: {
    baseUrl?: string;
    apiKey?: string;
    headers?: Record<string, string>;
  };
  fallback: EmbeddingFallbackType;
  local?: {
    modelPath?: string;
    modelCacheDir?: string;
  };
};

export type MemoryQdrantNebulaConfig = {
  qdrant: QdrantConfig;
  nebula: NebulaConfig;
  embedding: EmbeddingConfig;
  autoCapture: boolean;
  autoRecall: boolean;
  graphEnrichment: boolean;
  hybridWeight: number;
  languages: SupportedLanguage[];
};

export const MEMORY_CATEGORIES = ["preference", "fact", "decision", "entity", "other"] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export const ENTITY_TYPES = ["person", "organization", "concept"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

// ============================================================================
// Embedding dimensions by model
// ============================================================================

const EMBEDDING_DIMENSIONS: Record<string, number> = {
  // OpenAI
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
  "text-embedding-ada-002": 1536,
  // Gemini
  "gemini-embedding-001": 768,
  "text-embedding-004": 768,
  // Local (embeddinggemma)
  "embeddinggemma-300M-Q8_0.gguf": 1024,
  // Yandex
  "text-search-doc/latest": 256,
  "text-search-query/latest": 256,
};

const DEFAULT_EMBEDDING_DIM = 1536;

export function vectorDimsForModel(model: string): number {
  // Try exact match first
  if (EMBEDDING_DIMENSIONS[model]) {
    return EMBEDDING_DIMENSIONS[model];
  }
  // Try partial match (for full paths like "hf:org/model/file.gguf")
  for (const [key, dims] of Object.entries(EMBEDDING_DIMENSIONS)) {
    if (model.includes(key)) {
      return dims;
    }
  }
  // Default fallback
  return DEFAULT_EMBEDDING_DIM;
}

// ============================================================================
// Defaults
// ============================================================================

const DEFAULTS = {
  qdrant: {
    url: "http://localhost:6333",
    collectionPrefix: "openclaw_memories",
  },
  nebula: {
    port: 9669,
    user: "root",
    space: "openclaw_memory",
  },
  embedding: {
    provider: "auto" as EmbeddingProviderType,
    model: "text-embedding-3-small",
    fallback: "none" as EmbeddingFallbackType,
  },
  autoCapture: true,
  autoRecall: true,
  graphEnrichment: true,
  hybridWeight: 0.7,
  languages: ["en", "ru"] as SupportedLanguage[],
};

// ============================================================================
// Helper functions
// ============================================================================

function assertAllowedKeys(value: Record<string, unknown>, allowed: string[], label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new Error(`${label} has unknown keys: ${unknown.join(", ")}`);
  }
}

function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, envVar) => {
    const envValue = process.env[envVar];
    if (!envValue) {
      throw new Error(`Environment variable ${envVar} is not set`);
    }
    return envValue;
  });
}

function parseQdrantConfig(cfg: Record<string, unknown>): QdrantConfig {
  const qdrant = cfg.qdrant as Record<string, unknown> | undefined;
  if (!qdrant || typeof qdrant.url !== "string") {
    throw new Error("qdrant.url is required");
  }
  assertAllowedKeys(qdrant, ["url", "apiKey", "collectionPrefix"], "qdrant config");

  return {
    url: qdrant.url,
    apiKey: typeof qdrant.apiKey === "string" ? resolveEnvVars(qdrant.apiKey) : undefined,
    collectionPrefix:
      typeof qdrant.collectionPrefix === "string"
        ? qdrant.collectionPrefix
        : DEFAULTS.qdrant.collectionPrefix,
  };
}

function parseNebulaConfig(cfg: Record<string, unknown>): NebulaConfig {
  const nebula = cfg.nebula as Record<string, unknown> | undefined;
  if (!nebula || typeof nebula.host !== "string" || typeof nebula.password !== "string") {
    throw new Error("nebula.host and nebula.password are required");
  }
  assertAllowedKeys(nebula, ["host", "port", "user", "password", "space"], "nebula config");

  return {
    host: nebula.host,
    port: typeof nebula.port === "number" ? nebula.port : DEFAULTS.nebula.port,
    user: typeof nebula.user === "string" ? nebula.user : DEFAULTS.nebula.user,
    password: resolveEnvVars(nebula.password),
    space: typeof nebula.space === "string" ? nebula.space : DEFAULTS.nebula.space,
  };
}

function parseEmbeddingConfig(cfg: Record<string, unknown>): EmbeddingConfig {
  const embedding = (cfg.embedding as Record<string, unknown>) || {};
  assertAllowedKeys(
    embedding,
    ["provider", "model", "remote", "fallback", "local"],
    "embedding config",
  );

  const remote = embedding.remote as Record<string, unknown> | undefined;
  const local = embedding.local as Record<string, unknown> | undefined;

  return {
    provider:
      typeof embedding.provider === "string"
        ? (embedding.provider as EmbeddingProviderType)
        : DEFAULTS.embedding.provider,
    model: typeof embedding.model === "string" ? embedding.model : DEFAULTS.embedding.model,
    remote: remote
      ? {
          baseUrl: typeof remote.baseUrl === "string" ? remote.baseUrl : undefined,
          apiKey: typeof remote.apiKey === "string" ? resolveEnvVars(remote.apiKey) : undefined,
          headers: remote.headers as Record<string, string> | undefined,
        }
      : undefined,
    fallback:
      typeof embedding.fallback === "string"
        ? (embedding.fallback as EmbeddingFallbackType)
        : DEFAULTS.embedding.fallback,
    local: local
      ? {
          modelPath: typeof local.modelPath === "string" ? local.modelPath : undefined,
          modelCacheDir: typeof local.modelCacheDir === "string" ? local.modelCacheDir : undefined,
        }
      : undefined,
  };
}

function parseLanguages(cfg: Record<string, unknown>): SupportedLanguage[] {
  if (!Array.isArray(cfg.languages)) {
    return DEFAULTS.languages;
  }
  const valid: SupportedLanguage[] = [];
  for (const lang of cfg.languages) {
    if (lang === "en" || lang === "ru" || lang === "cs") {
      valid.push(lang);
    }
  }
  return valid.length > 0 ? valid : DEFAULTS.languages;
}

// ============================================================================
// Config Schema
// ============================================================================

export const memoryQdrantNebulaConfigSchema = {
  parse(value: unknown): MemoryQdrantNebulaConfig {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("memory-qdrant-nebula config required");
    }
    const cfg = value as Record<string, unknown>;
    assertAllowedKeys(
      cfg,
      [
        "qdrant",
        "nebula",
        "embedding",
        "autoCapture",
        "autoRecall",
        "graphEnrichment",
        "hybridWeight",
        "languages",
      ],
      "memory-qdrant-nebula config",
    );

    return {
      qdrant: parseQdrantConfig(cfg),
      nebula: parseNebulaConfig(cfg),
      embedding: parseEmbeddingConfig(cfg),
      autoCapture: cfg.autoCapture !== false,
      autoRecall: cfg.autoRecall !== false,
      graphEnrichment: cfg.graphEnrichment !== false,
      hybridWeight: typeof cfg.hybridWeight === "number" ? cfg.hybridWeight : DEFAULTS.hybridWeight,
      languages: parseLanguages(cfg),
    };
  },
};
