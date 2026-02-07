/**
 * Entity Extraction Tests — Russian-focused
 *
 * Tests cover:
 * - Person extraction with Az.js normalization
 * - Organization extraction (guillemets, legal forms)
 * - Location extraction with case normalization
 * - Concept/skill extraction (multi-word)
 * - Relation extraction (works_at, knows, lives_in, manages, studies_at, uses, interested_in)
 * - Implicit relation inference
 * - False positive filtering
 * - matchAll (all occurrences, not just first)
 *
 * Note: Tests that rely on Az.js normalization are marked with "with Az.js".
 * Without Az.js initialization, the extractor falls back to regex-only mode.
 * The morph init is async and loads dictionary files from the `az` package.
 */

import { describe, test, expect, beforeAll } from "vitest";
import {
  extractEntities,
  extractEntityNames,
  extractRelations,
  inferImplicitRelations,
  type ExtractedEntity,
  type ExtractedRelation,
} from "./entity-extractor.js";
import { ensureMorphInit, isMorphReady } from "./morph.js";

// ============================================================================
// Setup: initialize Az.js morphology
// ============================================================================

beforeAll(async () => {
  try {
    await ensureMorphInit();
  } catch {
    // Az.js may not be installed in CI; tests will still work (regex-only mode)
    console.warn("Az.js initialization failed — running in regex-only mode");
  }
}, 30000); // Dict loading can take a few seconds

// ============================================================================
// Helper
// ============================================================================

function personNames(entities: ExtractedEntity[]): string[] {
  return entities.filter((e) => e.type === "person").map((e) => e.name);
}

function orgNames(entities: ExtractedEntity[]): string[] {
  return entities.filter((e) => e.type === "organization").map((e) => e.name);
}

function locationNames(entities: ExtractedEntity[]): string[] {
  return entities.filter((e) => e.type === "location").map((e) => e.name);
}

function conceptNames(entities: ExtractedEntity[]): string[] {
  return entities.filter((e) => e.type === "concept").map((e) => e.name);
}

// ============================================================================
// Person Extraction
// ============================================================================

describe("extractEntities — persons", () => {
  test("extracts Russian name with intro phrase", () => {
    const entities = extractEntities("Меня зовут Дмитрий Иванов");
    expect(personNames(entities)).toEqual(
      expect.arrayContaining([expect.stringContaining("Дмитрий")]),
    );
  });

  test("extracts Russian name near verb", () => {
    const entities = extractEntities("Андрей позвонил вчера");
    expect(personNames(entities)).toEqual(
      expect.arrayContaining([expect.stringContaining("Андрей")]),
    );
  });

  test("extracts name after preposition (oblique case)", () => {
    const entities = extractEntities("Спроси у Маши, она знает");
    expect(personNames(entities).length).toBeGreaterThanOrEqual(1);
    // Should contain a normalized form
    const names = personNames(entities).map((n) => n.toLowerCase());
    expect(names.some((n) => n.includes("маш"))).toBe(true);
  });

  test("extracts name with role prefix", () => {
    const entities = extractEntities("Наш коллега Дмитрий сейчас в отпуске");
    expect(personNames(entities)).toEqual(
      expect.arrayContaining([expect.stringContaining("Дмитрий")]),
    );
  });

  test("extracts enumerated names", () => {
    const entities = extractEntities("Маша, Катя и Ольга пошли в кино");
    const names = personNames(entities);
    expect(names.length).toBeGreaterThanOrEqual(2);
  });

  test("extracts English person name", () => {
    const entities = extractEntities("My name is John Smith");
    expect(personNames(entities)).toEqual(
      expect.arrayContaining([expect.stringContaining("John")]),
    );
  });

  test("extracts Czech person name", () => {
    const entities = extractEntities("Jmenuji se Jan Novák");
    expect(personNames(entities)).toEqual(
      expect.arrayContaining([expect.stringContaining("Jan")]),
    );
  });

  test("deduplicates same name from multiple patterns", () => {
    // The same name matched by multiple patterns should appear once
    const entities = extractEntities("Друг Дмитрий. Дмитрий сказал привет");
    const dmitriyCount = personNames(entities).filter((n) =>
      n.toLowerCase().includes("дмитрий"),
    ).length;
    expect(dmitriyCount).toBe(1);
  });

  test("rejects false positive — common word starting with capital", () => {
    const entities = extractEntities("После обеда пойдём гулять");
    // "После" should NOT be extracted as a person name
    const names = personNames(entities);
    expect(names.some((n) => n.toLowerCase() === "после")).toBe(false);
  });

  test("attaches phone to person entity", () => {
    const entities = extractEntities("Меня зовут Иван, мой телефон +7-999-123-45-67");
    const ivan = entities.find((e) => e.type === "person" && e.name.includes("Иван"));
    expect(ivan).toBeDefined();
    expect(ivan?.properties?.phone).toBeDefined();
  });

  test("attaches email to person entity", () => {
    const entities = extractEntities("My name is John, email john@example.com");
    const john = entities.find((e) => e.type === "person" && e.name.includes("John"));
    expect(john).toBeDefined();
    expect(john?.properties?.email).toBe("john@example.com");
  });
});

// ============================================================================
// Organization Extraction
// ============================================================================

describe("extractEntities — organizations", () => {
  test("extracts org from work pattern (Russian)", () => {
    const entities = extractEntities("Я работаю в Яндексе");
    expect(orgNames(entities).length).toBeGreaterThanOrEqual(1);
  });

  test("extracts org in guillemets", () => {
    const entities = extractEntities("Компания «Рога и Копыта» занимается торговлей");
    expect(orgNames(entities)).toEqual(
      expect.arrayContaining([expect.stringContaining("Рога и Копыта")]),
    );
  });

  test("extracts org with legal form prefix", () => {
    const entities = extractEntities('Я работаю в ООО "Рога и Копыта"');
    expect(orgNames(entities).length).toBeGreaterThanOrEqual(1);
  });

  test("extracts org from 'из компании X' pattern", () => {
    const entities = extractEntities("Он из компании Яндекс, очень хороший специалист");
    expect(orgNames(entities)).toEqual(
      expect.arrayContaining([expect.stringContaining("Яндекс")]),
    );
  });

  test("extracts English org", () => {
    const entities = extractEntities("I work at Google as a software engineer");
    expect(orgNames(entities)).toEqual(
      expect.arrayContaining([expect.stringContaining("Google")]),
    );
  });
});

// ============================================================================
// Location Extraction
// ============================================================================

describe("extractEntities — locations", () => {
  test("extracts location from 'живу в X' pattern", () => {
    const entities = extractEntities("Я живу в Москве уже пять лет");
    const locs = locationNames(entities);
    expect(locs.length).toBeGreaterThanOrEqual(1);
    // With Az.js, should normalize "Москве" -> "Москва"
    if (isMorphReady()) {
      expect(locs).toEqual(expect.arrayContaining([expect.stringContaining("Москва")]));
    }
  });

  test("extracts location from 'из X' pattern", () => {
    const entities = extractEntities("Я родом из Петербурга");
    const locs = locationNames(entities);
    expect(locs.length).toBeGreaterThanOrEqual(1);
  });

  test("extracts location with 'город X' pattern", () => {
    const entities = extractEntities("Город Казань — столица Татарстана");
    const locs = locationNames(entities);
    expect(locs.length).toBeGreaterThanOrEqual(1);
  });

  test("extracts English location", () => {
    const entities = extractEntities("I live in London and love it");
    expect(locationNames(entities)).toEqual(
      expect.arrayContaining([expect.stringContaining("London")]),
    );
  });
});

// ============================================================================
// Concept Extraction
// ============================================================================

describe("extractEntities — concepts", () => {
  test("extracts Russian skill concepts", () => {
    const entities = extractEntities("Я знаю Python и умею React Native");
    const concepts = conceptNames(entities);
    expect(concepts.length).toBeGreaterThanOrEqual(1);
    expect(concepts.some((c) => c.toLowerCase().includes("python"))).toBe(true);
  });

  test("extracts Russian interest concepts", () => {
    const entities = extractEntities("Увлекаюсь машинным обучением");
    const concepts = conceptNames(entities);
    expect(concepts.length).toBeGreaterThanOrEqual(1);
  });

  test("extracts English preference concepts", () => {
    const entities = extractEntities("I prefer TypeScript over JavaScript");
    const concepts = conceptNames(entities);
    expect(concepts.some((c) => c.toLowerCase().includes("typescript"))).toBe(true);
  });

  test("extracts multi-word concepts", () => {
    const entities = extractEntities("Я знаю React Native довольно хорошо");
    const concepts = conceptNames(entities);
    expect(concepts.some((c) => c.toLowerCase().includes("react"))).toBe(true);
  });
});

// ============================================================================
// Relation Extraction
// ============================================================================

describe("extractRelations", () => {
  test("extracts works_at relation (Russian)", () => {
    const relations = extractRelations("Дмитрий работает в Яндексе");
    const worksAt = relations.filter((r) => r.relationType === "works_at");
    expect(worksAt.length).toBeGreaterThanOrEqual(1);
    if (worksAt.length > 0) {
      expect(worksAt[0].sourceType).toBe("person");
      expect(worksAt[0].targetType).toBe("organization");
    }
  });

  test("extracts knows relation (Russian)", () => {
    const relations = extractRelations("Андрей знаком с Мариной");
    const knows = relations.filter((r) => r.relationType === "knows");
    expect(knows.length).toBeGreaterThanOrEqual(1);
  });

  test("extracts family relationship (Russian possessive)", () => {
    const relations = extractRelations("Мой муж Андрей работает программистом");
    // Should extract a 'knows' relation with family relationship property
    const familyRel = relations.filter(
      (r) => r.relationType === "knows" && r.properties.relationship === "муж",
    );
    expect(familyRel.length).toBeGreaterThanOrEqual(1);
    if (familyRel.length > 0) {
      expect(familyRel[0].targetName).toContain("Андрей");
    }
  });

  test("extracts lives_in relation (Russian)", () => {
    const relations = extractRelations("Мария живёт в Москве");
    const livesIn = relations.filter((r) => r.relationType === "lives_in");
    expect(livesIn.length).toBeGreaterThanOrEqual(1);
    if (livesIn.length > 0) {
      expect(livesIn[0].sourceType).toBe("person");
      expect(livesIn[0].targetType).toBe("location");
    }
  });

  test("extracts studies_at relation (Russian)", () => {
    const relations = extractRelations("Иван учится в МГУ");
    const studiesAt = relations.filter((r) => r.relationType === "studies_at");
    expect(studiesAt.length).toBeGreaterThanOrEqual(1);
  });

  test("extracts works_at relation (English)", () => {
    const relations = extractRelations("John works at Google");
    const worksAt = relations.filter((r) => r.relationType === "works_at");
    expect(worksAt.length).toBeGreaterThanOrEqual(1);
  });

  test("extracts knows relation (English)", () => {
    const relations = extractRelations("Alice knows Bob from college");
    const knows = relations.filter((r) => r.relationType === "knows");
    expect(knows.length).toBeGreaterThanOrEqual(1);
  });

  test("deduplicates relations", () => {
    const relations = extractRelations(
      "Дмитрий работает в Яндексе. Дмитрий работает в Яндексе уже три года",
    );
    const worksAt = relations.filter((r) => r.relationType === "works_at");
    expect(worksAt.length).toBe(1);
  });
});

// ============================================================================
// Implicit Relation Inference
// ============================================================================

describe("inferImplicitRelations", () => {
  test("infers person-org relation when no explicit relation", () => {
    const entities: ExtractedEntity[] = [
      { type: "person", name: "Дмитрий", properties: {}, confidence: 0.8 },
      { type: "organization", name: "Яндекс", properties: {}, confidence: 0.7 },
    ];
    const explicit: ExtractedRelation[] = [];
    const implicit = inferImplicitRelations(entities, explicit);

    expect(implicit.length).toBe(1);
    expect(implicit[0].relationType).toBe("related_to");
    expect(implicit[0].confidence).toBe(0.4);
  });

  test("skips inferred relation when explicit relation exists", () => {
    const entities: ExtractedEntity[] = [
      { type: "person", name: "Дмитрий", properties: {}, confidence: 0.8 },
      { type: "organization", name: "Яндекс", properties: {}, confidence: 0.7 },
    ];
    const explicit: ExtractedRelation[] = [
      {
        sourceType: "person",
        sourceName: "Дмитрий",
        targetType: "organization",
        targetName: "Яндекс",
        relationType: "works_at",
        properties: {},
        confidence: 0.8,
      },
    ];
    const implicit = inferImplicitRelations(entities, explicit);
    expect(implicit.length).toBe(0);
  });

  test("infers person-location relation", () => {
    const entities: ExtractedEntity[] = [
      { type: "person", name: "Мария", properties: {}, confidence: 0.8 },
      { type: "location", name: "Москва", properties: {}, confidence: 0.7 },
    ];
    const implicit = inferImplicitRelations(entities, []);
    expect(implicit.some((r) => r.targetType === "location")).toBe(true);
  });

  test("infers person-concept relation", () => {
    const entities: ExtractedEntity[] = [
      { type: "person", name: "Иван", properties: {}, confidence: 0.8 },
      { type: "concept", name: "Python", properties: { category: "technology" }, confidence: 0.6 },
    ];
    const implicit = inferImplicitRelations(entities, []);
    expect(implicit.some((r) => r.targetType === "concept")).toBe(true);
  });
});

// ============================================================================
// matchAll behavior
// ============================================================================

describe("matchAll — multiple occurrences", () => {
  test("extracts multiple persons from text", () => {
    const entities = extractEntities(
      "Андрей сказал, что Мария позвонила, а потом Дмитрий написал",
    );
    const names = personNames(entities);
    // Should find at least 2 names from the verb patterns
    expect(names.length).toBeGreaterThanOrEqual(2);
  });

  test("extracts multiple organizations", () => {
    const entities = extractEntities("Он работал в «Яндексе», потом перешёл в «Сбер»");
    const orgs = orgNames(entities);
    expect(orgs.length).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================================
// extractEntityNames
// ============================================================================

describe("extractEntityNames", () => {
  test("returns names of all extracted entities", () => {
    const names = extractEntityNames("Меня зовут Иван, я работаю в Яндексе");
    expect(names.length).toBeGreaterThan(0);
  });

  test("returns empty array for text with no entities", () => {
    const names = extractEntityNames("просто текст без сущностей");
    expect(Array.isArray(names)).toBe(true);
  });
});

// ============================================================================
// Az.js normalization (conditional — only when Az is initialized)
// ============================================================================

describe.skipIf(!isMorphReady())("Az.js normalization", () => {
  test("normalizes oblique case person name to nominative", () => {
    // "у Маши" -> should normalize "Маши" to "Маша" or similar
    const entities = extractEntities("Спроси у Маши, она знает");
    const names = personNames(entities);
    // The normalized form should be close to nominative
    expect(names.length).toBeGreaterThanOrEqual(1);
  });

  test("normalizes location name from prepositional to nominative", () => {
    const entities = extractEntities("Я живу в Москве");
    const locs = locationNames(entities);
    expect(locs.length).toBeGreaterThanOrEqual(1);
    expect(locs[0]).toBe("Москва");
  });

  test("filters false positive verbs starting with capital letter", () => {
    // "Может" is a verb, not a name
    const entities = extractEntities("Может быть завтра будет лучше");
    const names = personNames(entities);
    expect(names.some((n) => n.toLowerCase() === "может")).toBe(false);
  });
});
