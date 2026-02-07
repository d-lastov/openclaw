import type { EmbeddingProvider, EmbeddingProviderOptions } from "./embeddings.js";

export type YandexEmbeddingClient = {
  baseUrl: string;
  headers: Record<string, string>;
  model: string;
};

// Native Yandex Foundation Models API
const DEFAULT_YANDEX_BASE_URL = "https://llm.api.cloud.yandex.net/foundationModels/v1";
const DEFAULT_YANDEX_EMBEDDING_MODEL = "text-search-doc/latest";

export function normalizeYandexModel(model: string, folderId?: string): string {
  const trimmed = model.trim();
  if (!trimmed) {
    if (folderId) {
      return `emb://${folderId}/${DEFAULT_YANDEX_EMBEDDING_MODEL}`;
    }
    return DEFAULT_YANDEX_EMBEDDING_MODEL;
  }
  return trimmed;
}

export async function createYandexEmbeddingProvider(
  options: EmbeddingProviderOptions,
): Promise<{ provider: EmbeddingProvider; client: YandexEmbeddingClient }> {
  const client = await resolveYandexEmbeddingClient(options);
  const url = `${client.baseUrl.replace(/\/$/, "")}/textEmbedding`;

  // Yandex Cloud does NOT support batch input - must send one text at a time
  const embedSingle = async (text: string): Promise<number[]> => {
    const res = await fetch(url, {
      method: "POST",
      headers: client.headers,
      body: JSON.stringify({ modelUri: client.model, text }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`yandex embeddings failed: ${res.status} ${errText}`);
    }
    const payload = (await res.json()) as { embedding?: number[] };
    return payload.embedding ?? [];
  };

  return {
    provider: {
      id: "yandex",
      model: client.model,
      embedQuery: embedSingle,
      embedBatch: async (texts) => {
        // Sequential requests - Yandex doesn't support batch
        const results: number[][] = [];
        for (const text of texts) {
          results.push(await embedSingle(text));
        }
        return results;
      },
    },
    client,
  };
}

export async function resolveYandexEmbeddingClient(
  options: EmbeddingProviderOptions,
): Promise<YandexEmbeddingClient> {
  const remote = options.remote;
  const apiKey = remote?.apiKey?.trim() || "";
  const baseUrl = remote?.baseUrl?.trim() || DEFAULT_YANDEX_BASE_URL;
  const headerOverrides = remote?.headers ?? {};
  const folderId = headerOverrides["x-folder-id"] || headerOverrides["OpenAI-Project"];

  if (!apiKey) {
    throw new Error("No API key found for provider yandex. Set memorySearch.remote.apiKey.");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Api-Key ${apiKey}`,
    ...headerOverrides,
  };

  const model = normalizeYandexModel(options.model, folderId);
  return { baseUrl, headers, model };
}
