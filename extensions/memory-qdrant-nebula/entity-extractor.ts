/**
 * Entity extraction from text for knowledge graph population.
 *
 * Uses Az.js for Russian morphological analysis:
 * - Proper name validation via grammemes (Name, Surn, Patr)
 * - Normalization to nominative/base form
 * - POS-based false positive filtering
 * - Geographical name detection (Geox)
 */

import type { EntityType } from "./config.js";
import {
  normalize,
  isProperName,
  isGeoName,
  isFalsePositiveName,
  isMorphReady,
} from "./morph.js";

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
  relationType:
    | "knows"
    | "works_at"
    | "belongs_to"
    | "related_to"
    | "lives_in"
    | "uses"
    | "manages"
    | "studies_at"
    | "interested_in";
  properties: Record<string, string | number | boolean>;
  confidence: number;
};

// ============================================================================
// Helpers
// ============================================================================

/** Collect all regex matches from text using matchAll */
function allMatches(text: string, pattern: RegExp): RegExpExecArray[] {
  // Ensure global flag is set for matchAll
  const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
  const globalPattern = new RegExp(pattern.source, flags);
  return [...text.matchAll(globalPattern)] as RegExpExecArray[];
}

/**
 * Validate and normalize a candidate person name using Az.js morphology.
 * Returns the normalized (nominative) name if valid, or null if rejected.
 */
function validateAndNormalizePerson(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < 2) return null;

  // Short false-positive list for common words that start with uppercase
  const commonFalsePositives = new Set([
    "это",
    "то",
    "the",
    "a",
    "an",
    "that",
    "this",
    "после",
    "может",
    "однако",
    "поэтому",
    "также",
    "потому",
    "кроме",
    "около",
    "между",
    "через",
    "перед",
    "возле",
    "вместо",
    "кстати",
    "например",
    "конечно",
    "наверное",
    "возможно",
    "пожалуй",
    "видимо",
    "очевидно",
    "правда",
    "сегодня",
    "завтра",
    "вчера",
  ]);
  if (commonFalsePositives.has(trimmed.toLowerCase())) return null;

  // Multi-word name: normalize each word
  const words = trimmed.split(/\s+/);
  const normalizedParts: string[] = [];

  for (const word of words) {
    if (!/^[A-ZА-ЯЁ]/.test(word)) return null; // Each part must start with uppercase

    // Use Az.js if available (for Cyrillic words)
    if (isMorphReady() && /[А-ЯЁа-яё]/.test(word)) {
      // Check for false positives via POS
      if (isFalsePositiveName(word)) return null;
      // Normalize to nominative form
      normalizedParts.push(capitalize(normalize(word)));
    } else {
      normalizedParts.push(word);
    }
  }

  return normalizedParts.join(" ");
}

/** Capitalize first letter */
function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Validate and normalize an organization name.
 * Strips guillemets/quotes, normalizes individual words when useful.
 */
function normalizeOrgName(name: string): string {
  return name.trim().replace(/[«»""]/g, "").trim();
}

/**
 * Validate and normalize a location name using Az.js (Geox grammeme + normalize).
 */
function validateAndNormalizeLocation(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < 2) return null;

  // Multi-word location (e.g. "Санкт-Петербург", "Нижний Новгород")
  const words = trimmed.split(/[\s-]+/);
  const normalizedParts: string[] = [];

  for (const word of words) {
    if (isMorphReady() && /[А-ЯЁа-яё]/.test(word)) {
      normalizedParts.push(capitalize(normalize(word)));
    } else {
      normalizedParts.push(word);
    }
  }

  // Rejoin with original separator (hyphen or space)
  const separator = trimmed.includes("-") ? "-" : " ";
  return normalizedParts.join(separator);
}

// ============================================================================
// Patterns for Entity Extraction
// ============================================================================

// --- Person patterns ---

const PERSON_PATTERNS_EN: RegExp[] = [
  // "my name is X", "I am X", "call me X"
  /(?:my name is|i am|i'm|call me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi,
  // "X is my friend/colleague"
  /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+is\s+(?:my|our)\s+(?:friend|colleague|boss|manager|brother|sister|wife|husband)/gi,
];

const PERSON_PATTERNS_RU: RegExp[] = [
  // "меня зовут X", "я X", "я - X" (also at start of sentence: Меня/Я)
  /(?:[Мм]еня\s+зовут|[Яя]\s+-?\s*)\s+([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+){0,2})/g,
  // "зовут X" (without "меня")
  /зовут\s+([А-ЯЁ][а-яё]{2,})/g,
  // Name + verb (3rd person): "Дмитрий сказал", "Маша позвонила"
  /([А-ЯЁ][а-яё]{2,})\s+(?:сказал[аи]?|говорит|позвонил[аи]?|написал[аи]?|приехал[аи]?|пришёл|пришла|пришли|рассказал[аи]?|спросил[аи]?|ответил[аи]?|предложил[аи]?|решил[аи]?|хочет|думает|знает|любит|работает|живёт|живет|учится|уехал[аи]?|вернулся|вернулась)/g,
  // Preposition + oblique case name: "у Маши", "от Дмитрия", "для Ольги", "с Андреем", "к Петру", "про Сашу"
  /(?:у|от|для|с|к|про|без|после|перед|возле|напротив)\s+([А-ЯЁ][а-яё]{2,})/g,
  // Role + name: "коллега Дмитрий", "друг Андрей", "начальник Иванов"
  /(?:коллега|друг|подруга|начальник|руководитель|менеджер|директор|брат|сестра|муж|жена|мать|отец|сын|дочь|знакомый|знакомая|сосед|соседка|товарищ)\s+([А-ЯЁ][а-яё]{2,}(?:\s+[А-ЯЁ][а-яё]{2,})?)/g,
  // Name + role apposition: "Дмитрий, мой коллега"
  /([А-ЯЁ][а-яё]{2,})\s*[,–—-]\s*(?:мой|моя|наш|наша)\s+(?:коллега|друг|подруга|начальник|руководитель)/g,
  // "X - это мой Y": "Андрей — это мой друг"
  /([А-ЯЁ][а-яё]{2,})\s+[-–—]\s+(?:это\s+)?(?:мой|моя|наш|наша)\s+/g,
  // Enumeration: "Маша, Катя и Ольга"
  /([А-ЯЁ][а-яё]{2,})(?:\s*,\s*([А-ЯЁ][а-яё]{2,}))*\s+и\s+([А-ЯЁ][а-яё]{2,})/g,
];

const PERSON_PATTERNS_CS: RegExp[] = [
  /(?:jmenuji se|jsem)\s+([A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][a-záčďéěíňóřšťúůýž]+(?:\s+[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][a-záčďéěíňóřšťúůýž]+)?)/gi,
  /([A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][a-záčďéěíňóřšťúůýž]+(?:\s+[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][a-záčďéěíňóřšťúůýž]+)?)\s+(?:je)\s+(?:můj|moje)\s+(?:přítel|kolega|šéf|kamarád)/gi,
];

// --- Organization patterns ---

const ORGANIZATION_PATTERNS_EN: RegExp[] = [
  /(?:work(?:s|ing)?\s+(?:at|for)|employed\s+(?:by|at))\s+([A-Z][A-Za-z\s&.-]+?)(?:\s+(?:as|since|for)|[,.!?]|$)/gi,
  /(?:company|firm)\s+(?:called|named)?\s*([A-Z][A-Za-z\s&.-]+)/gi,
];

const ORGANIZATION_PATTERNS_RU: RegExp[] = [
  // Work patterns: "работаю в X", "Работаю в X"
  /(?:[Рр]аботаю|[Рр]аботает|[Рр]аботал[аи]?|[Тт]рудится|[Тт]рудоустроен[а]?|[Уу]строился|[Уу]строилась)\s+(?:в|на)\s+([A-ZА-ЯЁ«"][A-Za-zА-Яа-яЁё\s&.»"-]+?)(?:\s+(?:на\s+должности|с|уже)|[,.!?]|$)/g,
  // Guillemet-quoted: «Яндекс», «Газпром»
  /«([^»]+)»/g,
  // Legal form prefix: ООО "Рога и копыта"
  /(?:ООО|ОАО|ЗАО|АО|ПАО|ИП|ГК)\s*[«"]?([^»",.]+)[»"]?/g,
  // "из компании/фирмы X"
  /(?:из|в)\s+(?:компании|фирмы|организации|корпорации)\s+([А-ЯЁ«"][А-Яа-яЁё\sA-Za-z&.»"-]+?)(?:[,.!?]|$)/g,
  // "компания X"
  /(?:компания|фирма|организация|корпорация)\s+(?:под\s+названием\s+)?([А-ЯЁ«"][А-Яа-яЁё\sA-Za-z&.»"-]+?)(?:[,.!?]|$)/g,
];

const ORGANIZATION_PATTERNS_CS: RegExp[] = [
  /(?:pracuji?\s+(?:v|pro|u))\s+([A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][A-Za-záčďéěíňóřšťúůýž\s&.-]+?)(?:\s+(?:jako|od)|[,.!?]|$)/gi,
  /(?:firma)\s+(?:s názvem)?\s*([A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][A-Za-záčďéěíňóřšťúůýž\s&.-]+)/gi,
];

// --- Location patterns ---

const LOCATION_PATTERNS_RU: RegExp[] = [
  // "живу/нахожусь/переехал в X" (also at start of sentence)
  /(?:[Жж]иву|[Жж]ивём|[Жж]ивет|[Жж]ивёт|[Нн]ахожусь|[Пп]ереехал[аи]?|[Пп]ереезжаю|[Рр]одился|[Рр]одилась|[Рр]одом)\s+в\s+([А-ЯЁ][а-яё]+(?:[-\s][А-ЯЁа-яё]+)*)/g,
  // "из X" (origin)
  /(?:из|[Рр]одом\s+из)\s+([А-ЯЁ][а-яё]+(?:[-\s][А-ЯЁа-яё]+)*)/g,
  // "город/село/деревня X" (also Город at start of sentence)
  /(?:[Гг]ород|[Сс]ело|[Дд]еревня|[Пп]осёлок|[Пп]оселок)\s+([А-ЯЁ][а-яё]+(?:[-\s][А-ЯЁа-яё]+)*)/g,
  // "в городе X"
  /в\s+(?:городе|селе|деревне|посёлке|поселке)\s+([А-ЯЁ][а-яё]+(?:[-\s][А-ЯЁа-яё]+)*)/g,
];

const LOCATION_PATTERNS_EN: RegExp[] = [
  /(?:live[sd]?\s+in|from|moved\s+to|born\s+in|based\s+in|located\s+in)\s+([A-Z][a-z]+(?:[\s-][A-Z][a-z]+)*)/gi,
  /(?:city|town|village)\s+(?:of\s+)?([A-Z][a-z]+(?:[\s-][A-Z][a-z]+)*)/gi,
];

// --- Concept patterns ---

const CONCEPT_PATTERNS_EN: RegExp[] = [
  // "prefer/like/love/use X"
  /(?:prefer|like|love|use|using)\s+([\w#+.-]+(?:\s+[\w#+.-]+){0,2})/gi,
  // "written in X"
  /(?:written\s+in|built\s+with)\s+([\w#+.-]+(?:\s+[\w#+.-]+){0,2})/gi,
];

const CONCEPT_PATTERNS_RU: RegExp[] = [
  // Skill verbs: "знаю Python", "владею React Native" (also at start of sentence)
  /(?:[Зз]наю|[Уу]мею|[Вв]ладею|[Ии]зучаю|[Оо]своил[а]?|[Уу]чу|[Вв]ыучил[а]?)\s+([\wА-Яа-яЁё#+.-]+(?:\s+[\wА-Яа-яЁё#+.-]+){0,2})/g,
  // Interest verbs: "увлекаюсь машинным обучением" (also at start of sentence)
  /(?:[Уу]влекаюсь|[Зз]анимаюсь|[Ии]нтересуюсь)\s+([\wА-Яа-яЁё#+.-]+(?:\s+[\wА-Яа-яЁё#+.-]+){0,2})/g,
  // Preference verbs: "люблю X", "нравится X" (also at start of sentence)
  /(?:[Лл]юблю|[Нн]равится|[Пп]редпочитаю|[Ии]спользую)\s+([\wА-Яа-яЁё#+.-]+(?:\s+[\wА-Яа-яЁё#+.-]+){0,2})/g,
  // Tech mentions: "написано на X", "работает на X"
  /(?:написано?\s+на|работает\s+на|на\s+базе|на\s+основе)\s+([\wА-Яа-яЁё#+.-]+(?:\s+[\wА-Яа-яЁё#+.-]+){0,2})/g,
];

const CONCEPT_PATTERNS_CS: RegExp[] = [
  /(?:preferuji|používám|mám rád)\s+([A-Za-záčďéěíňóřšťúůýž0-9#+.-]+(?:\s+[A-Za-záčďéěíňóřšťúůýž0-9#+.-]+){0,2})/gi,
  /(?:napsáno\s+v)\s+([A-Za-z0-9#+]+)/gi,
];

// --- Contact info patterns ---

const PHONE_PATTERN =
  /(?:(?:phone|телефон|telefon)\s*(?:is|:)?\s*)?(\+?[0-9]{1,3}[-.\s]?(?:\([0-9]{2,3}\)|[0-9]{2,3})[-.\s]?[0-9]{3}[-.\s]?[0-9]{2}[-.\s]?[0-9]{2})/gi;
const EMAIL_PATTERN =
  /(?:(?:email|почта|e-?mail)\s*(?:is|:)?\s*)?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;

// --- Role patterns ---

const ROLE_PATTERNS = [
  /(?:i am|i'm|work(?:ing)?\s+as)\s+(?:a\s+)?([a-zа-яё]+(?:\s+[a-zа-яё]+)?)\s+(?:at|for|in)/i,
  /(?:я|работаю)\s+([а-яё]+(?:\s+[а-яё]+)?(?:ом|ем|ёром|истом)?)/i,
  /(?:jsem|pracuji jako)\s+([a-záčďéěíňóřšťúůýž]+)/i,
];

// ============================================================================
// Relation Patterns
// ============================================================================

// works_at patterns
const WORKS_AT_PATTERNS: RegExp[] = [
  // English
  /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:works?|working)\s+(?:at|for)\s+([A-Z][A-Za-z\s&.-]+?)(?:\s+(?:as|since)|[,.!?]|$)/gi,
  // Russian (no i flag — Cyrillic case-sensitive for name detection)
  /([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)\s+(?:работает|работал[а]?|трудится|устроился|устроилась)\s+(?:в|на)\s+([A-ZА-ЯЁ«"][A-Za-zА-Яа-яЁё\s&.»"-]+?)(?:\s+(?:на\s+должности|уже)|[,.!?]|$)/g,
];

// knows patterns
const KNOWS_PATTERNS: RegExp[] = [
  // English
  /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:knows?|met|is\s+friends?\s+with)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi,
  // Russian
  /([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)\s+(?:знает|знаком[аы]?\s+с|дружит\s+с|общается\s+с)\s+([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)/g,
];

// Family / relationship patterns
const RELATIONSHIP_PATTERNS_EN: RegExp[] = [
  // English: "X is Y's friend"
  /([A-Z][a-z]+)\s+is\s+([A-Z][a-z]+)(?:'s|s)?\s+(friend|colleague|boss|brother|sister|wife|husband)/gi,
];

// Russian: "X — друг Y"
const RELATIONSHIP_PATTERNS_RU_DASH: RegExp[] = [
  /([А-ЯЁ][а-яё]+)\s+[-–—]\s+(друг|подруга|коллега|начальник|руководитель|брат|сестра|жена|муж|отец|мать|сын|дочь)\s+([А-ЯЁ][а-яё]+(?:[а-яё]*)?)/g,
];

// Russian: "мой муж/жена X", "моя жена Ольга" (possessive + role + name)
const RELATIONSHIP_PATTERNS_RU_POSS: RegExp[] = [
  /(?:[Мм]ой|[Мм]оя|[Мм]ои)\s+(муж|жена|брат|сестра|сын|дочь|отец|мать|друг|подруга|коллега|начальник)\s+[-–—]?\s*([А-ЯЁ][а-яё]{2,})/g,
];

// lives_in patterns
const LIVES_IN_PATTERNS: RegExp[] = [
  // Russian
  /([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)\s+(?:живёт|живет|проживает|переехал[а]?)\s+в\s+([А-ЯЁ][а-яё]+(?:[-\s][А-ЯЁа-яё]+)*)/g,
  // English
  /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:lives?\s+in|moved\s+to|resides\s+in)\s+([A-Z][a-z]+(?:[\s-][A-Z][a-z]+)*)/gi,
];

// manages patterns
const MANAGES_PATTERNS: RegExp[] = [
  /([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)\s+(?:руководит|управляет|возглавляет)\s+([A-ZА-ЯЁ«"][A-Za-zА-Яа-яЁё\s&.»"-]+?)(?:[,.!?]|$)/g,
  /([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)\s+[-–—]\s+(?:начальник|руководитель|директор|глава)\s+([A-ZА-ЯЁ«"][A-Za-zА-Яа-яЁё\s&.»"-]+?)(?:[,.!?]|$)/g,
];

// studies_at patterns
const STUDIES_AT_PATTERNS: RegExp[] = [
  /([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)\s+(?:учится|учился|училась|закончил[а]?|окончил[а]?|поступил[а]?)\s+(?:в|на)\s+([A-ZА-ЯЁ«"][A-Za-zА-Яа-яЁё\s&.»"-]+?)(?:[,.!?]|$)/g,
  /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:studies|studied|graduated\s+from|attends?)\s+([A-Z][A-Za-z\s&.-]+?)(?:[,.!?]|$)/gi,
];

// uses patterns
const USES_PATTERNS: RegExp[] = [
  /([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)\s+(?:использует|пользуется|перешёл\s+на|перешел\s+на|работает\s+(?:с|на|в))\s+([\wА-Яа-яЁё#+.-]+(?:\s+[\wА-Яа-яЁё#+.-]+){0,2})/g,
];

// interested_in patterns
const INTERESTED_IN_PATTERNS: RegExp[] = [
  /([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)\s+(?:увлекается|занимается|интересуется)\s+([\wА-Яа-яЁё#+.-]+(?:\s+[\wА-Яа-яЁё#+.-]+){0,2})/g,
];

// ============================================================================
// Entity Extraction Functions
// ============================================================================

/**
 * Extract person entities from text.
 * Uses matchAll for all occurrences, Az.js for validation and normalization.
 */
function extractPersons(text: string): ExtractedEntity[] {
  const candidates = new Map<string, ExtractedEntity>();
  const allPatterns = [...PERSON_PATTERNS_EN, ...PERSON_PATTERNS_RU, ...PERSON_PATTERNS_CS];

  for (const pattern of allPatterns) {
    for (const match of allMatches(text, pattern)) {
      // Handle enumeration pattern specially: captures multiple groups
      const groups = [match[1], match[2], match[3]].filter(Boolean);
      for (const rawName of groups) {
        const name = validateAndNormalizePerson(rawName);
        if (!name) continue;

        const key = name.toLowerCase();
        if (!candidates.has(key)) {
          candidates.set(key, {
            type: "person",
            name,
            properties: {},
            confidence: 0.8,
          });
        }
      }
    }
  }

  // Attach contact info to first person entity
  if (candidates.size > 0) {
    const firstPerson = candidates.values().next().value!;

    for (const phoneMatch of allMatches(text, PHONE_PATTERN)) {
      if (phoneMatch[1]) {
        firstPerson.properties.phone = phoneMatch[1].replace(/[-.\s]/g, "");
        break;
      }
    }

    for (const emailMatch of allMatches(text, EMAIL_PATTERN)) {
      if (emailMatch[1]) {
        firstPerson.properties.email = emailMatch[1].toLowerCase();
        break;
      }
    }

    // Try to extract role
    for (const rolePattern of ROLE_PATTERNS) {
      const roleMatch = text.match(rolePattern);
      if (roleMatch?.[1]) {
        firstPerson.properties.role = roleMatch[1].trim();
        break;
      }
    }
  }

  return [...candidates.values()];
}

/**
 * Extract organization entities from text.
 */
function extractOrganizations(text: string): ExtractedEntity[] {
  const candidates = new Map<string, ExtractedEntity>();
  const allPatterns = [
    ...ORGANIZATION_PATTERNS_EN,
    ...ORGANIZATION_PATTERNS_RU,
    ...ORGANIZATION_PATTERNS_CS,
  ];

  for (const pattern of allPatterns) {
    for (const match of allMatches(text, pattern)) {
      if (!match[1]) continue;
      const name = normalizeOrgName(match[1]);
      if (name.length < 2) continue;
      if (/^(a|an|the|одна|один|jedna)$/i.test(name)) continue;

      const key = name.toLowerCase();
      if (!candidates.has(key)) {
        candidates.set(key, {
          type: "organization",
          name,
          properties: {},
          confidence: 0.7,
        });
      }
    }
  }

  return [...candidates.values()];
}

/**
 * Extract location entities from text.
 * Uses Az.js Geox grammeme for validation and normalize() for case restoration.
 */
function extractLocations(text: string): ExtractedEntity[] {
  const candidates = new Map<string, ExtractedEntity>();
  const allPatterns = [...LOCATION_PATTERNS_RU, ...LOCATION_PATTERNS_EN];

  for (const pattern of allPatterns) {
    for (const match of allMatches(text, pattern)) {
      if (!match[1]) continue;
      const rawName = match[1].trim();
      if (rawName.length < 2) continue;

      const name = validateAndNormalizeLocation(rawName);
      if (!name) continue;

      const key = name.toLowerCase();
      if (!candidates.has(key)) {
        candidates.set(key, {
          type: "location",
          name,
          properties: {},
          confidence: 0.7,
        });
      }
    }
  }

  return [...candidates.values()];
}

/**
 * Extract concept entities (technologies, skills, topics) from text.
 */
function extractConcepts(text: string): ExtractedEntity[] {
  const candidates = new Map<string, ExtractedEntity>();
  const allPatterns = [...CONCEPT_PATTERNS_EN, ...CONCEPT_PATTERNS_RU, ...CONCEPT_PATTERNS_CS];

  for (const pattern of allPatterns) {
    for (const match of allMatches(text, pattern)) {
      if (!match[1]) continue;
      const name = match[1].trim();
      if (name.length < 2) continue;

      // Split on "и"/"and"/"," to handle lists: "знаю Python и React Native"
      const parts = name.split(/\s+(?:и|and|,)\s+/).map((p) => p.trim()).filter((p) => p.length >= 2);
      for (const part of parts.length > 0 ? parts : [name]) {
        const key = part.toLowerCase();
        if (!candidates.has(key)) {
          candidates.set(key, {
            type: "concept",
            name: part,
            properties: { category: "technology" },
            confidence: 0.6,
          });
        }
      }
    }
  }

  return [...candidates.values()];
}

/**
 * Extract contact info as standalone entities (when no person name found).
 */
function extractContactInfo(text: string, existingEntities: ExtractedEntity[]): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];
  const hasPerson = existingEntities.some((e) => e.type === "person");

  if (!hasPerson) {
    const phoneMatches = allMatches(text, PHONE_PATTERN);
    const emailMatches = allMatches(text, EMAIL_PATTERN);

    if (phoneMatches.length > 0 || emailMatches.length > 0) {
      const properties: Record<string, string> = {};
      if (phoneMatches[0]?.[1]) {
        properties.phone = phoneMatches[0][1].replace(/[-.\s]/g, "");
      }
      if (emailMatches[0]?.[1]) {
        properties.email = emailMatches[0][1].toLowerCase();
      }

      entities.push({
        type: "person",
        name: emailMatches[0]?.[1]?.split("@")[0] || "Contact",
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
 * Extract relations between entities from text.
 * Uses matchAll for all occurrences, Az.js for name normalization on both sides.
 */
export function extractRelations(text: string): ExtractedRelation[] {
  const relations: ExtractedRelation[] = [];

  // works_at
  for (const pattern of WORKS_AT_PATTERNS) {
    for (const match of allMatches(text, pattern)) {
      if (!match[1] || !match[2]) continue;
      const personName = validateAndNormalizePerson(match[1]) || match[1].trim();
      const orgName = normalizeOrgName(match[2]);
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

  // knows
  for (const pattern of KNOWS_PATTERNS) {
    for (const match of allMatches(text, pattern)) {
      if (!match[1] || !match[2]) continue;
      const person1 = validateAndNormalizePerson(match[1]) || match[1].trim();
      const person2 = validateAndNormalizePerson(match[2]) || match[2].trim();
      if (person1.length >= 2 && person2.length >= 2 && person1.toLowerCase() !== person2.toLowerCase()) {
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

  // English relationship patterns: "X is Y's friend"
  for (const pattern of RELATIONSHIP_PATTERNS_EN) {
    for (const match of allMatches(text, pattern)) {
      if (match[1] && match[2] && match[3]) {
        const person1 = validateAndNormalizePerson(match[1]) || match[1].trim();
        const person2 = validateAndNormalizePerson(match[2]) || match[2].trim();
        const relType = match[3].toLowerCase();
        if (person1.length >= 2 && person2.length >= 2) {
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

  // Russian dash relationship: "X — друг Y"
  for (const pattern of RELATIONSHIP_PATTERNS_RU_DASH) {
    for (const match of allMatches(text, pattern)) {
      if (match[1] && match[2] && match[3]) {
        const person1 = validateAndNormalizePerson(match[1]) || match[1].trim();
        const relType = match[2].toLowerCase();
        const person2 = validateAndNormalizePerson(match[3]) || match[3].trim();
        if (person1.length >= 2 && person2.length >= 2) {
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

  // Russian possessive relationship: "мой муж Андрей"
  for (const pattern of RELATIONSHIP_PATTERNS_RU_POSS) {
    for (const match of allMatches(text, pattern)) {
      if (match[1] && match[2]) {
        const relType = match[1].toLowerCase();
        const person2 = validateAndNormalizePerson(match[2]) || match[2].trim();
        if (person2.length >= 2) {
          relations.push({
            sourceType: "person",
            sourceName: "я", // Speaker reference — will be resolved by context
            targetType: "person",
            targetName: person2,
            relationType: "knows",
            properties: { relationship: relType, strength: 0.9 },
            confidence: 0.85,
          });
        }
      }
    }
  }

  // lives_in
  for (const pattern of LIVES_IN_PATTERNS) {
    for (const match of allMatches(text, pattern)) {
      if (!match[1] || !match[2]) continue;
      const personName = validateAndNormalizePerson(match[1]) || match[1].trim();
      const locationName = validateAndNormalizeLocation(match[2]) || match[2].trim();
      if (personName.length >= 2 && locationName.length >= 2) {
        relations.push({
          sourceType: "person",
          sourceName: personName,
          targetType: "location",
          targetName: locationName,
          relationType: "lives_in",
          properties: {},
          confidence: 0.7,
        });
      }
    }
  }

  // manages
  for (const pattern of MANAGES_PATTERNS) {
    for (const match of allMatches(text, pattern)) {
      if (!match[1] || !match[2]) continue;
      const personName = validateAndNormalizePerson(match[1]) || match[1].trim();
      const orgName = normalizeOrgName(match[2]);
      if (personName.length >= 2 && orgName.length >= 2) {
        relations.push({
          sourceType: "person",
          sourceName: personName,
          targetType: "organization",
          targetName: orgName,
          relationType: "manages",
          properties: {},
          confidence: 0.7,
        });
      }
    }
  }

  // studies_at
  for (const pattern of STUDIES_AT_PATTERNS) {
    for (const match of allMatches(text, pattern)) {
      if (!match[1] || !match[2]) continue;
      const personName = validateAndNormalizePerson(match[1]) || match[1].trim();
      const orgName = normalizeOrgName(match[2]);
      if (personName.length >= 2 && orgName.length >= 2) {
        relations.push({
          sourceType: "person",
          sourceName: personName,
          targetType: "organization",
          targetName: orgName,
          relationType: "studies_at",
          properties: {},
          confidence: 0.7,
        });
      }
    }
  }

  // uses
  for (const pattern of USES_PATTERNS) {
    for (const match of allMatches(text, pattern)) {
      if (!match[1] || !match[2]) continue;
      const personName = validateAndNormalizePerson(match[1]) || match[1].trim();
      const conceptName = match[2].trim();
      if (personName.length >= 2 && conceptName.length >= 2) {
        relations.push({
          sourceType: "person",
          sourceName: personName,
          targetType: "concept",
          targetName: conceptName,
          relationType: "uses",
          properties: {},
          confidence: 0.6,
        });
      }
    }
  }

  // interested_in
  for (const pattern of INTERESTED_IN_PATTERNS) {
    for (const match of allMatches(text, pattern)) {
      if (!match[1] || !match[2]) continue;
      const personName = validateAndNormalizePerson(match[1]) || match[1].trim();
      const conceptName = match[2].trim();
      if (personName.length >= 2 && conceptName.length >= 2) {
        relations.push({
          sourceType: "person",
          sourceName: personName,
          targetType: "concept",
          targetName: conceptName,
          relationType: "interested_in",
          properties: {},
          confidence: 0.6,
        });
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
// Implicit Relation Inference
// ============================================================================

/**
 * Infer implicit relations when entities co-occur in the same text
 * without an explicit relation pattern. Creates `related_to` with lower confidence.
 */
export function inferImplicitRelations(
  entities: ExtractedEntity[],
  explicitRelations: ExtractedRelation[],
): ExtractedRelation[] {
  const implicit: ExtractedRelation[] = [];

  // Build set of explicitly related pairs
  const explicitPairs = new Set<string>();
  for (const r of explicitRelations) {
    explicitPairs.add(`${r.sourceName.toLowerCase()}-${r.targetName.toLowerCase()}`);
    explicitPairs.add(`${r.targetName.toLowerCase()}-${r.sourceName.toLowerCase()}`);
  }

  const persons = entities.filter((e) => e.type === "person");
  const orgs = entities.filter((e) => e.type === "organization");
  const locations = entities.filter((e) => e.type === "location");
  const concepts = entities.filter((e) => e.type === "concept");

  // Person + Organization co-occurrence
  for (const person of persons) {
    for (const org of orgs) {
      const pairKey = `${person.name.toLowerCase()}-${org.name.toLowerCase()}`;
      if (!explicitPairs.has(pairKey)) {
        implicit.push({
          sourceType: "person",
          sourceName: person.name,
          targetType: "organization",
          targetName: org.name,
          relationType: "related_to",
          properties: { inferred: true },
          confidence: 0.4,
        });
      }
    }

    // Person + Location co-occurrence
    for (const loc of locations) {
      const pairKey = `${person.name.toLowerCase()}-${loc.name.toLowerCase()}`;
      if (!explicitPairs.has(pairKey)) {
        implicit.push({
          sourceType: "person",
          sourceName: person.name,
          targetType: "location",
          targetName: loc.name,
          relationType: "related_to",
          properties: { inferred: true },
          confidence: 0.4,
        });
      }
    }

    // Person + Concept co-occurrence
    for (const concept of concepts) {
      const pairKey = `${person.name.toLowerCase()}-${concept.name.toLowerCase()}`;
      if (!explicitPairs.has(pairKey)) {
        implicit.push({
          sourceType: "person",
          sourceName: person.name,
          targetType: "concept",
          targetName: concept.name,
          relationType: "related_to",
          properties: { inferred: true },
          confidence: 0.4,
        });
      }
    }
  }

  return implicit;
}

// ============================================================================
// Main Extraction Function
// ============================================================================

/**
 * Extract all entities from text.
 * Note: call `ensureMorphInit()` before first use to enable Az.js morphology.
 */
export function extractEntities(text: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];

  entities.push(...extractPersons(text));
  entities.push(...extractOrganizations(text));
  entities.push(...extractLocations(text));
  entities.push(...extractConcepts(text));
  entities.push(...extractContactInfo(text, entities));

  // Deduplicate by normalized name (case-insensitive)
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
 * Extract entity names for quick search (without full entity data).
 */
export function extractEntityNames(text: string): string[] {
  const entities = extractEntities(text);
  return entities.map((e) => e.name);
}
