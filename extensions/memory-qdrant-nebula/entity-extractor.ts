/**
 * Entity extraction from text for knowledge graph population
 */

import type { EntityType } from "./config.js";

// ============================================================================
// Types
// ============================================================================

export type ExtractedEntity = {
  type: EntityType;
  name: string;
  properties: Record<string, string | number | boolean>;
  confidence: number;
};

export type ExtractedRelation = {
  sourceType: EntityType;
  sourceName: string;
  targetType: EntityType;
  targetName: string;
  relationType: "knows" | "works_at" | "belongs_to" | "related_to";
  properties: Record<string, string | number | boolean>;
  confidence: number;
};

// ============================================================================
// Patterns for Entity Extraction
// ============================================================================

// Person name patterns
const PERSON_PATTERNS = [
  // English
  /(?:my name is|i am|i'm|call me)\s+([A-ZА-ЯЁ][a-zа-яё]+(?:\s+[A-ZА-ЯЁ][a-zа-яё]+)?)/i,
  // Russian - explicit patterns
  /(?:меня зовут|я|я -)\s+([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)/i,
  // Russian - name at start of sentence with verb (Дима любит, Маша сказала)
  /^([А-ЯЁ][а-яё]{2,})\s+(?:очень\s+)?(?:любит|нравится|хочет|говорит|сказал[аи]?|думает|знает|работает|живёт|живет)/i,
  // Russian - name in "X is/has" pattern
  /(?:^|\.\s+)([А-ЯЁ][а-яё]{2,})\s+[-–—]\s+(?:это|мой|моя|наш|наша)/i,
  // Czech
  /(?:jmenuji se|jsem)\s+([A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][a-záčďéěíňóřšťúůýž]+(?:\s+[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][a-záčďéěíňóřšťúůýž]+)?)/i,
  // Name mention with role
  /([A-ZА-ЯЁ][a-zа-яё]+(?:\s+[A-ZА-ЯЁ][a-zа-яё]+)?)\s+(?:is|был|была|je)\s+(?:my|мой|моя|můj|moje)\s+(?:friend|colleague|boss|друг|коллега|начальник|přítel|kolega|šéf)/i,
];

// Organization name patterns
const ORGANIZATION_PATTERNS = [
  // English
  /(?:work(?:s|ing)?\s+(?:at|for)|employed\s+(?:by|at))\s+([A-ZА-ЯЁ][A-Za-zА-Яа-яЁё\s&.-]+?)(?:\s+(?:as|since|for)|[,.!?]|$)/i,
  // Russian
  /(?:работаю?\s+(?:в|на)|трудоустроен\s+в)\s+([A-ZА-ЯЁ«"][A-Za-zА-Яа-яЁё\s&.»"-]+?)(?:\s+(?:на\s+должности|с|уже)|[,.!?]|$)/i,
  // Czech
  /(?:pracuji?\s+(?:v|pro|u))\s+([A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][A-Za-záčďéěíňóřšťúůýž\s&.-]+?)(?:\s+(?:jako|od)|[,.!?]|$)/i,
  // Company mention
  /(?:company|компания|firma)\s+(?:called|named|под названием|s názvem)?\s*([A-ZА-ЯЁ«"][A-Za-zА-Яа-яЁё\s&.»"-]+)/i,
];

// Contact info patterns
const PHONE_PATTERN =
  /(?:(?:phone|телефон|telefon)\s*(?:is|:)?\s*)?(\+?[0-9]{1,3}[-.\s]?(?:\([0-9]{2,3}\)|[0-9]{2,3})[-.\s]?[0-9]{3}[-.\s]?[0-9]{2}[-.\s]?[0-9]{2})/i;
const EMAIL_PATTERN =
  /(?:(?:email|почта|e-?mail)\s*(?:is|:)?\s*)?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i;

// Role patterns
const ROLE_PATTERNS = [
  // English
  /(?:i am|i'm|work(?:ing)?\s+as)\s+(?:a\s+)?([a-zа-яё]+(?:\s+[a-zа-яё]+)?)\s+(?:at|for|in)/i,
  // Russian
  /(?:я|работаю)\s+([а-яё]+(?:\s+[а-яё]+)?(?:ом|ем|ёром|истом)?)/i,
  // Czech
  /(?:jsem|pracuji jako)\s+([a-záčďéěíňóřšťúůýž]+)/i,
];

// Concept patterns (topics, technologies, etc.)
const CONCEPT_PATTERNS = [
  // Preferences for things (English)
  /(?:prefer|like|love|use|using)\s+([A-Za-zА-Яа-яЁё0-9#+.-]+)/i,
  // Preferences for things (Russian) - любит X, нравится X
  /(?:любит|любят|люблю|нравится|нравятся|предпочитает|предпочитаю|использует|использую)\s+([А-Яа-яЁё0-9#+.-]+(?:\s+(?:и|,)\s+[А-Яа-яЁё0-9#+.-]+)*)/i,
  // Czech preferences
  /(?:preferuji|používám|mám rád)\s+([A-Za-záčďéěíňóřšťúůýž0-9#+.-]+)/i,
  // Technology mentions
  /(?:написан(?:о|а)?\s+на|written\s+in|napsáno\s+v)\s+([A-Za-z0-9#+]+)/i,
];

// ============================================================================
// Relation Patterns
// ============================================================================

// "X works at Y" patterns
const WORKS_AT_PATTERNS = [
  // English
  /([A-ZА-ЯЁ][a-zа-яё]+(?:\s+[A-ZА-ЯЁ][a-zа-яё]+)?)\s+(?:works?|working)\s+(?:at|for)\s+([A-ZА-ЯЁ][A-Za-zА-Яа-яЁё\s&.-]+?)(?:\s+(?:as|since)|[,.!?]|$)/i,
  // Russian
  /([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)\s+работает\s+(?:в|на)\s+([A-ZА-ЯЁ«"][A-Za-zА-Яа-яЁё\s&.»"-]+?)(?:\s+(?:на\s+должности|уже)|[,.!?]|$)/i,
];

// "X knows Y" patterns
const KNOWS_PATTERNS = [
  // English
  /([A-ZА-ЯЁ][a-zа-яё]+(?:\s+[A-ZА-ЯЁ][a-zа-яё]+)?)\s+(?:knows?|met|is\s+friends?\s+with)\s+([A-ZА-ЯЁ][a-zа-яё]+(?:\s+[A-ZА-ЯЁ][a-zа-яё]+)?)/i,
  // Russian
  /([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)\s+(?:знает|знаком[аы]?\s+с|дружит\s+с)\s+([А-ЯЁ][а-яё]+(?:ом|ой|ем)?(?:\s+[А-ЯЁ][а-яё]+(?:ым|ой)?)?)/i,
];

// "X is Y's friend/colleague" patterns
const RELATIONSHIP_PATTERNS = [
  // English
  /([A-ZА-ЯЁ][a-zа-яё]+)\s+is\s+([A-ZА-ЯЁ][a-zа-яё]+)(?:'s|s)?\s+(friend|colleague|boss|brother|sister|wife|husband)/i,
  // Russian
  /([А-ЯЁ][а-яё]+)\s+[-–—]\s+(друг|коллега|начальник|брат|сестра|жена|муж)\s+([А-ЯЁ][а-яё]+(?:а|и|ы)?)/i,
];

// ============================================================================
// Entity Extraction Functions
// ============================================================================

/**
 * Extract person entities from text
 */
function extractPersons(text: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];

  for (const pattern of PERSON_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const name = match[1].trim();
      // Skip common words that might be false positives
      if (name.length < 2 || /^(the|a|an|это|то|это|that|this)$/i.test(name)) {
        continue;
      }

      const entity: ExtractedEntity = {
        type: "person",
        name,
        properties: {},
        confidence: 0.8,
      };

      // Try to extract phone
      const phoneMatch = text.match(PHONE_PATTERN);
      if (phoneMatch && phoneMatch[1]) {
        entity.properties.phone = phoneMatch[1].replace(/[-.\s]/g, "");
      }

      // Try to extract email
      const emailMatch = text.match(EMAIL_PATTERN);
      if (emailMatch && emailMatch[1]) {
        entity.properties.email = emailMatch[1].toLowerCase();
      }

      // Try to extract role
      for (const rolePattern of ROLE_PATTERNS) {
        const roleMatch = text.match(rolePattern);
        if (roleMatch && roleMatch[1]) {
          entity.properties.role = roleMatch[1].trim();
          break;
        }
      }

      entities.push(entity);
    }
  }

  return entities;
}

/**
 * Extract organization entities from text
 */
function extractOrganizations(text: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];

  for (const pattern of ORGANIZATION_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const name = match[1].trim().replace(/[«»""]/g, "");
      // Skip if too short or common word
      if (name.length < 2 || /^(a|an|the|одна|один|jedna)$/i.test(name)) {
        continue;
      }

      entities.push({
        type: "organization",
        name,
        properties: {},
        confidence: 0.7,
      });
    }
  }

  return entities;
}

/**
 * Extract concept entities from text
 */
function extractConcepts(text: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];

  for (const pattern of CONCEPT_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const name = match[1].trim();
      // Skip if too short
      if (name.length < 2) {
        continue;
      }

      entities.push({
        type: "concept",
        name,
        properties: {
          category: "technology",
        },
        confidence: 0.6,
      });
    }
  }

  return entities;
}

/**
 * Extract contact info as standalone entities (when no person name found)
 */
function extractContactInfo(text: string, existingEntities: ExtractedEntity[]): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];

  // Check if we already have a person entity
  const hasPerson = existingEntities.some((e) => e.type === "person");

  // If no person found but contact info present, create generic contact entity
  if (!hasPerson) {
    const phoneMatch = text.match(PHONE_PATTERN);
    const emailMatch = text.match(EMAIL_PATTERN);

    if (phoneMatch || emailMatch) {
      const properties: Record<string, string> = {};
      if (phoneMatch && phoneMatch[1]) {
        properties.phone = phoneMatch[1].replace(/[-.\s]/g, "");
      }
      if (emailMatch && emailMatch[1]) {
        properties.email = emailMatch[1].toLowerCase();
      }

      entities.push({
        type: "person",
        name: emailMatch ? emailMatch[1].split("@")[0] : "Contact",
        properties,
        confidence: 0.5,
      });
    }
  }

  return entities;
}

// ============================================================================
// Relation Extraction Functions
// ============================================================================

/**
 * Extract relations between entities from text
 */
export function extractRelations(text: string): ExtractedRelation[] {
  const relations: ExtractedRelation[] = [];

  // Extract "works at" relations
  for (const pattern of WORKS_AT_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[1] && match[2]) {
      const personName = match[1].trim();
      const orgName = match[2].trim().replace(/[«»""]/g, "");

      if (personName.length >= 2 && orgName.length >= 2) {
        relations.push({
          sourceType: "person",
          sourceName: personName,
          targetType: "organization",
          targetName: orgName,
          relationType: "works_at",
          properties: {},
          confidence: 0.8,
        });
      }
    }
  }

  // Extract "knows" relations
  for (const pattern of KNOWS_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[1] && match[2]) {
      const person1 = match[1].trim();
      // Clean up Russian case endings
      const person2 = match[2]
        .trim()
        .replace(/(ом|ой|ем|ым)$/i, "а")
        .replace(/а$/, "");

      if (
        person1.length >= 2 &&
        person2.length >= 2 &&
        person1.toLowerCase() !== person2.toLowerCase()
      ) {
        relations.push({
          sourceType: "person",
          sourceName: person1,
          targetType: "person",
          targetName: person2,
          relationType: "knows",
          properties: { relationship: "acquaintance", strength: 0.5 },
          confidence: 0.7,
        });
      }
    }
  }

  // Extract relationship patterns (friend, colleague, etc.)
  for (const pattern of RELATIONSHIP_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      // English pattern: X is Y's friend
      if (match[3] && /friend|colleague|boss|brother|sister|wife|husband/i.test(match[3])) {
        const person1 = match[1].trim();
        const person2 = match[2].trim();
        const relType = match[3].toLowerCase();

        relations.push({
          sourceType: "person",
          sourceName: person1,
          targetType: "person",
          targetName: person2,
          relationType: "knows",
          properties: { relationship: relType, strength: 0.8 },
          confidence: 0.8,
        });
      }
      // Russian pattern: X — друг Y
      else if (match[2] && /друг|коллега|начальник|брат|сестра|жена|муж/i.test(match[2])) {
        const person1 = match[1].trim();
        const relType = match[2].toLowerCase();
        const person2 = match[3]?.trim().replace(/(а|и|ы)$/i, "") || "";

        if (person2.length >= 2) {
          relations.push({
            sourceType: "person",
            sourceName: person1,
            targetType: "person",
            targetName: person2,
            relationType: "knows",
            properties: { relationship: relType, strength: 0.8 },
            confidence: 0.8,
          });
        }
      }
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  const unique: ExtractedRelation[] = [];
  for (const r of relations) {
    const key = `${r.sourceName.toLowerCase()}-${r.relationType}-${r.targetName.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(r);
    }
  }

  return unique;
}

// ============================================================================
// Main Extraction Function
// ============================================================================

/**
 * Extract all entities from text
 */
export function extractEntities(text: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];

  // Extract different entity types
  entities.push(...extractPersons(text));
  entities.push(...extractOrganizations(text));
  entities.push(...extractConcepts(text));

  // Extract standalone contact info
  entities.push(...extractContactInfo(text, entities));

  // Deduplicate by name (case-insensitive)
  const seen = new Set<string>();
  const unique: ExtractedEntity[] = [];
  for (const e of entities) {
    const key = `${e.type}:${e.name.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(e);
    }
  }

  return unique;
}

/**
 * Extract entity names for quick search (without full entity data)
 */
export function extractEntityNames(text: string): string[] {
  const entities = extractEntities(text);
  return entities.map((e) => e.name);
}
