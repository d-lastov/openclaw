import { describe, expect, it, vi, beforeEach } from "vitest";
import type { EmbeddingProviderOptions } from "./embeddings.js";
import {
  createYandexEmbeddingProvider,
  normalizeYandexModel,
  resolveYandexEmbeddingClient,
} from "./embeddings-yandex.js";

describe("embeddings-yandex", () => {
  describe("normalizeYandexModel", () => {
    it("returns default model with folderId when model is empty", () => {
      const result = normalizeYandexModel("", "folder123");
      expect(result).toBe("emb://folder123/text-search-doc/latest");
    });

    it("returns default model without folderId when both are empty", () => {
      const result = normalizeYandexModel("");
      expect(result).toBe("text-search-doc/latest");
    });

    it("returns trimmed model when provided", () => {
      const result = normalizeYandexModel("  emb://my/model  ");
      expect(result).toBe("emb://my/model");
    });
  });

  describe("resolveYandexEmbeddingClient", () => {
    it("throws when apiKey is missing", async () => {
      const options: EmbeddingProviderOptions = {
        config: {},
        provider: "yandex",
        model: "",
        fallback: "none",
      };

      await expect(resolveYandexEmbeddingClient(options)).rejects.toThrow(
        "No API key found for provider yandex",
      );
    });

    it("resolves client with correct headers", async () => {
      const options: EmbeddingProviderOptions = {
        config: {},
        provider: "yandex",
        model: "emb://folder/model",
        fallback: "none",
        remote: {
          apiKey: "test-api-key",
          headers: {
            "x-folder-id": "folder123",
          },
        },
      };

      const client = await resolveYandexEmbeddingClient(options);

      expect(client.headers["Authorization"]).toBe("Api-Key test-api-key");
      expect(client.headers["Content-Type"]).toBe("application/json");
      expect(client.headers["x-folder-id"]).toBe("folder123");
      expect(client.model).toBe("emb://folder/model");
    });

    it("uses default baseUrl when not provided", async () => {
      const options: EmbeddingProviderOptions = {
        config: {},
        provider: "yandex",
        model: "",
        fallback: "none",
        remote: {
          apiKey: "test-key",
          headers: { "x-folder-id": "folder123" },
        },
      };

      const client = await resolveYandexEmbeddingClient(options);
      expect(client.baseUrl).toBe("https://llm.api.cloud.yandex.net/foundationModels/v1");
    });
  });

  describe("createYandexEmbeddingProvider", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("creates provider with correct id", async () => {
      // Native Yandex response format
      const mockResponse = {
        embedding: [0.1, 0.2, 0.3],
        numTokens: "5",
        modelVersion: "06.12.2023",
      };

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        }),
      );

      const options: EmbeddingProviderOptions = {
        config: {},
        provider: "yandex",
        model: "emb://folder/model",
        fallback: "none",
        remote: {
          apiKey: "test-key",
        },
      };

      const { provider } = await createYandexEmbeddingProvider(options);

      expect(provider.id).toBe("yandex");
      expect(provider.model).toBe("emb://folder/model");
    });

    it("embedQuery returns embedding vector", async () => {
      // Native Yandex response format
      const mockResponse = {
        embedding: [0.1, 0.2, 0.3, 0.4, 0.5],
        numTokens: "3",
        modelVersion: "06.12.2023",
      };

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        }),
      );

      const options: EmbeddingProviderOptions = {
        config: {},
        provider: "yandex",
        model: "emb://folder/model",
        fallback: "none",
        remote: {
          apiKey: "test-key",
        },
      };

      const { provider } = await createYandexEmbeddingProvider(options);
      const embedding = await provider.embedQuery("test text");

      expect(embedding).toEqual([0.1, 0.2, 0.3, 0.4, 0.5]);
      expect(fetch).toHaveBeenCalledWith(
        "https://llm.api.cloud.yandex.net/foundationModels/v1/textEmbedding",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ modelUri: "emb://folder/model", text: "test text" }),
        }),
      );
    });

    it("embedBatch processes texts sequentially", async () => {
      let callCount = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation(() => {
          callCount++;
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ embedding: [callCount * 0.1, callCount * 0.2] }),
          });
        }),
      );

      const options: EmbeddingProviderOptions = {
        config: {},
        provider: "yandex",
        model: "emb://folder/model",
        fallback: "none",
        remote: {
          apiKey: "test-key",
        },
      };

      const { provider } = await createYandexEmbeddingProvider(options);
      const embeddings = await provider.embedBatch(["text1", "text2", "text3"]);

      expect(embeddings).toHaveLength(3);
      expect(fetch).toHaveBeenCalledTimes(3);
    });

    it("throws on API error", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
          text: () => Promise.resolve('{"error": "Unauthorized"}'),
        }),
      );

      const options: EmbeddingProviderOptions = {
        config: {},
        provider: "yandex",
        model: "emb://folder/model",
        fallback: "none",
        remote: {
          apiKey: "bad-key",
        },
      };

      const { provider } = await createYandexEmbeddingProvider(options);

      await expect(provider.embedQuery("test")).rejects.toThrow("yandex embeddings failed: 401");
    });
  });
});
