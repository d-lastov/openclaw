/**
 * Memory Plugin Tests: Qdrant + Nebula
 *
 * Tests include:
 * - Plugin registration and configuration
 * - Multi-language triggers (EN/RU/CS)
 * - Entity extraction
 * - Category detection
 * - Hybrid search logic
 */

import { describe, test, expect } from "vitest";
import { memoryQdrantNebulaConfigSchema, vectorDimsForModel } from "./config.js";
import { extractEntities, extractEntityNames } from "./entity-extractor.js";
import {
  shouldCapture,
  detectCategory,
  detectLanguage,
  calculateImportance,
  MEMORY_TRIGGERS_EN,
  MEMORY_TRIGGERS_RU,
  MEMORY_TRIGGERS_CS,
} from "./triggers.js";

// ============================================================================
// Config Tests
// ============================================================================

describe("config schema", () => {
  test("parses valid config", () => {
    const config = memoryQdrantNebulaConfigSchema.parse({
      qdrant: {
        url: "http://localhost:6333",
        apiKey: "test-key",
      },
      nebula: {
        host: "localhost",
        password: "nebula",
      },
      embedding: {
        provider: "openai",
        model: "text-embedding-3-small",
        remote: {
          apiKey: "sk-test",
        },
      },
    });

    expect(config.qdrant.url).toBe("http://localhost:6333");
    expect(config.nebula.host).toBe("localhost");
    expect(config.nebula.port).toBe(9669);
    expect(config.embedding.provider).toBe("openai");
    expect(config.autoCapture).toBe(true);
    expect(config.autoRecall).toBe(true);
    expect(config.graphEnrichment).toBe(true);
  });

  test("applies defaults", () => {
    const config = memoryQdrantNebulaConfigSchema.parse({
      qdrant: {
        url: "http://localhost:6333",
      },
      nebula: {
        host: "localhost",
        password: "nebula",
      },
    });

    expect(config.qdrant.collectionPrefix).toBe("openclaw_memories");
    expect(config.nebula.port).toBe(9669);
    expect(config.nebula.user).toBe("root");
    expect(config.nebula.space).toBe("openclaw_memory");
    expect(config.embedding.provider).toBe("auto");
    expect(config.embedding.model).toBe("text-embedding-3-small");
    expect(config.hybridWeight).toBe(0.7);
    expect(config.languages).toEqual(["en", "ru"]);
  });

  test("resolves env vars", () => {
    process.env.TEST_QDRANT_KEY = "qdrant-key-123";
    process.env.TEST_NEBULA_PASS = "nebula-pass-456";

    const config = memoryQdrantNebulaConfigSchema.parse({
      qdrant: {
        url: "http://localhost:6333",
        apiKey: "${TEST_QDRANT_KEY}",
      },
      nebula: {
        host: "localhost",
        password: "${TEST_NEBULA_PASS}",
      },
    });

    expect(config.qdrant.apiKey).toBe("qdrant-key-123");
    expect(config.nebula.password).toBe("nebula-pass-456");

    delete process.env.TEST_QDRANT_KEY;
    delete process.env.TEST_NEBULA_PASS;
  });

  test("rejects missing required fields", () => {
    expect(() => {
      memoryQdrantNebulaConfigSchema.parse({
        qdrant: {},
        nebula: { host: "localhost", password: "test" },
      });
    }).toThrow("qdrant.url is required");

    expect(() => {
      memoryQdrantNebulaConfigSchema.parse({
        qdrant: { url: "http://localhost:6333" },
        nebula: { host: "localhost" },
      });
    }).toThrow("nebula.host and nebula.password are required");
  });
});

describe("vectorDimsForModel", () => {
  test("returns correct dimensions for known models", () => {
    expect(vectorDimsForModel("text-embedding-3-small")).toBe(1536);
    expect(vectorDimsForModel("text-embedding-3-large")).toBe(3072);
    expect(vectorDimsForModel("gemini-embedding-001")).toBe(768);
    expect(vectorDimsForModel("text-search-doc/latest")).toBe(256);
  });

  test("returns default for unknown models", () => {
    expect(vectorDimsForModel("unknown-model")).toBe(1536);
  });

  test("handles partial matches in paths", () => {
    expect(vectorDimsForModel("hf:org/embeddinggemma-300M-Q8_0.gguf")).toBe(1024);
  });
});

// ============================================================================
// Trigger Tests
// ============================================================================

describe("memory triggers", () => {
  describe("English triggers", () => {
    const testCases = [
      { text: "Remember that I prefer dark mode", expected: true },
      { text: "Don't forget my email is test@example.com", expected: true },
      { text: "I like TypeScript better than JavaScript", expected: true },
      { text: "I want to use React for this project", expected: true },
      { text: "We decided to use PostgreSQL", expected: true },
      { text: "My name is John Smith", expected: true },
      { text: "I work as a developer at Google", expected: true },
      { text: "This is always important to me", expected: true },
      { text: "Call me at +12025551234", expected: true },
      { text: "Just a random message", expected: false },
    ];

    for (const { text, expected } of testCases) {
      test(`"${text.slice(0, 40)}..." should ${expected ? "match" : "not match"}`, () => {
        const matches = MEMORY_TRIGGERS_EN.some((r) => r.test(text));
        expect(matches).toBe(expected);
      });
    }
  });

  describe("Russian triggers", () => {
    const testCases = [
      { text: "Запомни, что я предпочитаю темную тему", expected: true },
      { text: "Не забудь мой email test@example.com", expected: true },
      { text: "Мне нравится TypeScript", expected: true },
      { text: "Я хочу использовать React", expected: true },
      { text: "Мы решили использовать PostgreSQL", expected: true },
      { text: "Меня зовут Иван Петров", expected: true },
      { text: "Я работаю в компании Яндекс", expected: true },
      { text: "Это всегда важно для меня", expected: true },
      { text: "Мой телефон +79991234567", expected: true },
      { text: "Просто случайное сообщение", expected: false },
    ];

    for (const { text, expected } of testCases) {
      test(`"${text.slice(0, 40)}..." should ${expected ? "match" : "not match"}`, () => {
        const matches = MEMORY_TRIGGERS_RU.some((r) => r.test(text));
        expect(matches).toBe(expected);
      });
    }
  });

  describe("Czech triggers", () => {
    const testCases = [
      { text: "Zapamatuj si, že preferuji tmavý režim", expected: true },
      { text: "Nezapomeň můj email test@example.com", expected: true },
      { text: "Líbí se mi TypeScript", expected: true },
      { text: "Nechci používat JavaScript", expected: true },
      { text: "Rozhodli jsme se použít PostgreSQL", expected: true },
      { text: "Jmenuji se Jan Novák", expected: true },
      { text: "Pracuji v společnosti Seznam", expected: true },
      { text: "Je to vždy důležité", expected: true },
      { text: "Jen náhodná zpráva", expected: false },
    ];

    for (const { text, expected } of testCases) {
      test(`"${text.slice(0, 40)}..." should ${expected ? "match" : "not match"}`, () => {
        const matches = MEMORY_TRIGGERS_CS.some((r) => r.test(text));
        expect(matches).toBe(expected);
      });
    }
  });
});

describe("shouldCapture", () => {
  test("captures preference statements", () => {
    expect(shouldCapture("I prefer dark mode for all my applications", ["en"])).toBe(true);
    expect(shouldCapture("Я предпочитаю темную тему везде", ["ru"])).toBe(true);
    expect(shouldCapture("Preferuji tmavý režim ve všech aplikacích", ["cs"])).toBe(true);
  });

  test("captures decision statements", () => {
    expect(shouldCapture("We decided to use PostgreSQL for the database", ["en"])).toBe(true);
    expect(shouldCapture("Мы решили использовать PostgreSQL для базы", ["ru"])).toBe(true);
  });

  test("captures contact info", () => {
    expect(shouldCapture("My email is developer@example.com please note it", ["en"])).toBe(true);
    expect(shouldCapture("Мой телефон +79991234567 запиши", ["ru"])).toBe(true);
  });

  test("rejects short text", () => {
    expect(shouldCapture("Short", ["en"])).toBe(false);
    expect(shouldCapture("Кор", ["ru"])).toBe(false);
  });

  test("rejects injected memory context", () => {
    expect(shouldCapture("<relevant-memories>I prefer dark mode</relevant-memories>", ["en"])).toBe(
      false,
    );
  });

  test("rejects markdown-heavy responses", () => {
    expect(shouldCapture("**Header**\n- Item 1\n- Item 2\n- Item 3", ["en"])).toBe(false);
  });

  test("rejects emoji-heavy text", () => {
    expect(shouldCapture("Great job! 🎉🎊🎉🎊 Amazing work!", ["en"])).toBe(false);
  });

  test("rejects code blocks", () => {
    expect(shouldCapture("Here's the code:\n```\nconst x = 1;\n```", ["en"])).toBe(false);
    expect(shouldCapture("function myFunc() { return true; }", ["en"])).toBe(false);
  });
});

// ============================================================================
// Category Detection Tests
// ============================================================================

describe("detectCategory", () => {
  test("detects preferences", () => {
    expect(detectCategory("I prefer dark mode")).toBe("preference");
    expect(detectCategory("I like TypeScript")).toBe("preference");
    expect(detectCategory("I love React")).toBe("preference");
    expect(detectCategory("I hate bugs")).toBe("preference");
    expect(detectCategory("Я предпочитаю React")).toBe("preference");
    expect(detectCategory("Мне нравится темная тема")).toBe("preference");
    expect(detectCategory("Preferuji TypeScript")).toBe("preference");
  });

  test("detects decisions", () => {
    expect(detectCategory("We decided to use PostgreSQL")).toBe("decision");
    expect(detectCategory("I will use React for this")).toBe("decision");
    expect(detectCategory("Мы решили использовать Docker")).toBe("decision");
    expect(detectCategory("Договорились использовать Git")).toBe("decision");
    expect(detectCategory("Rozhodli jsme se pro React")).toBe("decision");
  });

  test("detects entities", () => {
    expect(detectCategory("My name is John")).toBe("entity");
    expect(detectCategory("Contact me at test@example.com")).toBe("entity");
    expect(detectCategory("My phone is +12025551234")).toBe("entity");
    expect(detectCategory("Меня зовут Иван")).toBe("entity");
    expect(detectCategory("Мой телефон +79991234567")).toBe("entity");
    expect(detectCategory("Jmenuji se Jan")).toBe("entity");
  });

  test("detects facts", () => {
    expect(detectCategory("The server is running on port 3000")).toBe("fact");
    expect(detectCategory("This API has rate limits")).toBe("fact");
    // Russian: "это" is the fact marker
    expect(detectCategory("Это сервер на порту 3000")).toBe("fact");
    // Czech: "je" is the fact marker
    expect(detectCategory("Server je na portu 3000")).toBe("fact");
  });

  test("returns other for unmatched", () => {
    expect(detectCategory("Something completely random")).toBe("other");
  });
});

// ============================================================================
// Language Detection Tests
// ============================================================================

describe("detectLanguage", () => {
  test("detects Russian", () => {
    expect(detectLanguage("Привет, меня зовут Иван")).toBe("ru");
    expect(detectLanguage("Я предпочитаю темную тему")).toBe("ru");
    expect(detectLanguage("Мой email: test@example.com")).toBe("ru");
  });

  test("detects Czech", () => {
    expect(detectLanguage("Jmenuji se Jan Novák")).toBe("cs");
    expect(detectLanguage("Preferuji tmavý režim")).toBe("cs");
    expect(detectLanguage("Můj email je test@example.com")).toBe("cs");
  });

  test("defaults to English", () => {
    expect(detectLanguage("My name is John Smith")).toBe("en");
    expect(detectLanguage("I prefer dark mode")).toBe("en");
    expect(detectLanguage("Contact me at test@example.com")).toBe("en");
  });
});

// ============================================================================
// Importance Calculation Tests
// ============================================================================

describe("calculateImportance", () => {
  test("base score is 0.5", () => {
    const score = calculateImportance("Just a regular message without triggers");
    expect(score).toBeGreaterThanOrEqual(0.5);
    expect(score).toBeLessThanOrEqual(0.6);
  });

  test("important keywords increase score", () => {
    const importantScore = calculateImportance("This is important information");
    const criticalScore = calculateImportance("This is critical information");
    const baseScore = calculateImportance("This is some information");

    expect(importantScore).toBeGreaterThan(baseScore);
    expect(criticalScore).toBeGreaterThan(baseScore);
  });

  test("explicit memory commands increase score", () => {
    const rememberScore = calculateImportance("Remember this information");
    const zapomniScore = calculateImportance("Запомни эту информацию");
    const baseScore = calculateImportance("Note this information");

    expect(rememberScore).toBeGreaterThan(baseScore);
    expect(zapomniScore).toBeGreaterThan(baseScore);
  });

  test("contact info increases score", () => {
    const emailScore = calculateImportance("My email is test@example.com");
    const phoneScore = calculateImportance("My phone is +12025551234");
    const baseScore = calculateImportance("My preference is dark mode");

    expect(emailScore).toBeGreaterThan(baseScore);
    expect(phoneScore).toBeGreaterThan(baseScore);
  });

  test("score is capped at 1.0", () => {
    const maxScore = calculateImportance(
      "Remember this is critically important! My phone +12025551234, меня зовут Иван, мы решили использовать",
    );
    expect(maxScore).toBeLessThanOrEqual(1.0);
  });
});

// ============================================================================
// Entity Extraction Tests
// ============================================================================

describe("extractEntities", () => {
  test("extracts person names (English)", () => {
    const entities = extractEntities("My name is John Smith and I am a developer");
    const personEntity = entities.find((e) => e.type === "person");

    expect(personEntity).toBeDefined();
    expect(personEntity?.name).toContain("John");
  });

  test("extracts person names (Russian)", () => {
    const entities = extractEntities("Меня зовут Иван Петров");
    const personEntity = entities.find((e) => e.type === "person");

    expect(personEntity).toBeDefined();
    expect(personEntity?.name).toContain("Иван");
  });

  test("extracts person names (Czech)", () => {
    const entities = extractEntities("Jmenuji se Jan Novák");
    const personEntity = entities.find((e) => e.type === "person");

    expect(personEntity).toBeDefined();
    expect(personEntity?.name).toContain("Jan");
  });

  test("extracts organizations (English)", () => {
    const entities = extractEntities("I work at Google as a software engineer");
    const orgEntity = entities.find((e) => e.type === "organization");

    expect(orgEntity).toBeDefined();
    expect(orgEntity?.name).toContain("Google");
  });

  test("extracts organizations (Russian)", () => {
    const entities = extractEntities("Я работаю в компании Яндекс программистом");
    const orgEntity = entities.find((e) => e.type === "organization");

    expect(orgEntity).toBeDefined();
    expect(orgEntity?.name).toContain("Яндекс");
  });

  test("extracts email addresses", () => {
    const entities = extractEntities("Contact me at developer@example.com");
    const personEntity = entities.find((e) => e.type === "person");

    expect(personEntity).toBeDefined();
    expect(personEntity?.properties?.email).toBe("developer@example.com");
  });

  test("extracts phone numbers", () => {
    const entities = extractEntities("My name is John and my phone is +1-202-555-1234");
    const personEntity = entities.find((e) => e.type === "person");

    expect(personEntity).toBeDefined();
    expect(personEntity?.properties?.phone).toBeDefined();
  });

  test("deduplicates entities", () => {
    const entities = extractEntities("My name is John. Call me John.");
    const johnEntities = entities.filter(
      (e) => e.type === "person" && e.name.toLowerCase().includes("john"),
    );

    expect(johnEntities.length).toBeLessThanOrEqual(1);
  });
});

describe("extractEntityNames", () => {
  test("returns array of names", () => {
    const names = extractEntityNames("My name is John and I work at Google");
    expect(names.length).toBeGreaterThan(0);
    expect(names.some((n) => n.includes("John") || n.includes("Google"))).toBe(true);
  });
});

// ============================================================================
// Plugin Registration Tests
// ============================================================================

describe("plugin definition", () => {
  test("has correct metadata", async () => {
    const { default: plugin } = await import("./index.js");

    expect(plugin.id).toBe("memory-qdrant-nebula");
    expect(plugin.name).toBe("Memory (Qdrant + Nebula)");
    expect(plugin.kind).toBe("memory");
    expect(plugin.configSchema).toBeDefined();
    expect(plugin.register).toBeInstanceOf(Function);
  });
});

// ============================================================================
// Live Tests (require real backends)
// ============================================================================

const QDRANT_URL = process.env.QDRANT_URL;
const NEBULA_HOST = process.env.NEBULA_HOST;
const NEBULA_PASSWORD = process.env.NEBULA_PASSWORD;
const liveEnabled =
  Boolean(QDRANT_URL) &&
  Boolean(NEBULA_HOST) &&
  Boolean(NEBULA_PASSWORD) &&
  process.env.OPENCLAW_LIVE_TEST === "1";

const describeLive = liveEnabled ? describe : describe.skip;

describeLive("memory plugin live tests", () => {
  test("qdrant client connects and creates collection", async () => {
    const { QdrantMemoryClient } = await import("./qdrant-client.js");
    const client = new QdrantMemoryClient(
      { url: QDRANT_URL!, collectionPrefix: "test_memories" },
      "test-agent",
      1536,
    );

    // Should be able to get collection info (creates if not exists)
    const info = await client.getCollectionInfo();
    expect(info).toBeDefined();
    expect(typeof info.pointsCount).toBe("number");
  });

  test("nebula client connects and creates schema", async () => {
    const { NebulaMemoryClient } = await import("./nebula-client.js");
    const client = new NebulaMemoryClient({
      host: NEBULA_HOST!,
      port: 9669,
      user: "root",
      password: NEBULA_PASSWORD!,
      space: "test_memory",
    });

    // Should be able to get stats (creates schema if needed)
    const stats = await client.getStats();
    expect(stats).toBeDefined();
    expect(typeof stats.personCount).toBe("number");

    await client.close();
  });
});
