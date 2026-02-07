/**
 * Multi-language memory capture triggers and categorization
 */

import type { MemoryCategory, SupportedLanguage } from "./config.js";

// ============================================================================
// Memory Trigger Patterns
// ============================================================================

export const MEMORY_TRIGGERS_EN: RegExp[] = [
  // Explicit memory commands
  /\b(remember|don't forget|keep in mind|note that)\b/i,
  // Preferences
  /\b(i\s+)?(prefer|like|love|hate|want|need|don't\s+want|don't\s+like)\b/i,
  // Decisions
  /\b(decided|will\s+use|chose|agreed|going\s+to\s+use)\b/i,
  // Personal info
  /\b(my\s+(name|phone|email|address)\s+(is|are))\b/i,
  /\b(i\s+(am|work|live)\s+(at|in|as))\b/i,
  /\b(call\s+me)\b/i,
  // Contact info patterns
  /\+\d{10,}/,
  /[\w.-]+@[\w.-]+\.\w{2,}/,
  // Important markers
  /\b(always|never|important|critical|essential)\b/i,
];

export const MEMORY_TRIGGERS_RU: RegExp[] = [
  // Explicit memory commands (Russian) - no \b for Cyrillic
  /(^|\s)(запомни|помни|сохрани|не\s+забудь|учти)(\s|$|[,.])/i,
  // Preferences (Russian)
  /(^|\s)(предпочитаю|нравится|не\s+нравится|люблю|ненавижу|хочу|не\s+хочу)(\s|$|[,.])/i,
  // Decisions (Russian)
  /(^|\s)(решили|будем\s+использовать|выбрали|договорились|остановились\s+на)/i,
  // Personal info (Russian)
  /(мой\s+телефон|моя\s+почта|мой\s+адрес|меня\s+зовут)/i,
  /(^|\s)(я\s+работаю|я\s+живу|моя\s+должность)/i,
  // Important markers (Russian)
  /(^|\s)(всегда|никогда|обязательно|важно|критично)(\s|$|[,.])/i,
  // Organization mentions (Russian)
  /(работаю\s+в|работаю\s+на|компания)/i,

  // --- Expanded Russian triggers ---

  // Relationship patterns: "мой коллега", "наш друг", "моя подруга"
  /(мой|моя|мои|наш|наша|наши)\s+(коллега|друг|подруга|начальник|руководитель|брат|сестра|муж|жена|отец|мать|сын|дочь|знакомый|знакомая|сосед|соседка)/i,
  // Project/product patterns: "наш проект", "наше приложение"
  /(наш|наша|наше|наши)\s+(проект|продукт|стек|приложение|сервис|система|платформа|бот|команда)/i,
  // Temporal facts: deadlines, meetings, plans
  /(дедлайн|встреча|созвон|митинг|завтра\s+у\s+нас|послезавтра|на\s+следующей\s+неделе|в\s+понедельник|во\s+вторник|в\s+среду|в\s+четверг|в\s+пятницу|через\s+неделю)/i,
  // Skill/experience patterns
  /(знаю|умею|владею|изучаю|опыт\s+работы|опыт\s+с|опыт\s+в|освоил|выучил)/i,
  // Emotional preferences
  /(обожаю|терпеть\s+не\s+могу|бесит|раздражает|нравится\s+как|не\s+нравится\s+как)/i,
  // Location patterns
  /(живу\s+в|переехал|родом\s+из|нахожусь\s+в)/i,
  // Learning/education
  /(учусь|учился|закончил|окончил|поступил)\s+(в|на)/i,
  // Name introductions (broader)
  /(зовут|его\s+зовут|её\s+зовут|их\s+зовут)/i,
];

export const MEMORY_TRIGGERS_CS: RegExp[] = [
  // Explicit memory commands (Czech)
  /\b(zapamatuj\s+si|pamatuj|nezapomeň|poznamenej)\b/i,
  // Preferences (Czech)
  /\b(preferuji|radši|nechci|líbí\s+se\s+mi|nelíbí\s+se\s+mi)\b/i,
  // Decisions (Czech)
  /\b(rozhodli\s+jsme|budeme\s+používat|vybrali\s+jsme|dohodli\s+jsme)\b/i,
  // Personal info (Czech)
  /\b(můj\s+telefon|můj\s+email|moje\s+adresa|jmenuji\s+se)\b/i,
  /\b(pracuji\s+v|bydlím\s+v|moje\s+pozice)\b/i,
  // Important markers (Czech)
  /\b(vždy|nikdy|důležité|kritické)\b/i,
];

const TRIGGERS_BY_LANGUAGE: Record<SupportedLanguage, RegExp[]> = {
  en: MEMORY_TRIGGERS_EN,
  ru: MEMORY_TRIGGERS_RU,
  cs: MEMORY_TRIGGERS_CS,
};

// ============================================================================
// Category Detection Patterns
// ============================================================================

const PREFERENCE_PATTERNS: RegExp[] = [
  // English
  /\b(prefer|like|love|hate|want|don't\s+want|favorite)\b/i,
  // Russian - no \b for Cyrillic
  /(предпочитаю|нравится|не\s+нравится|люблю|ненавижу|хочу|не\s+хочу|любимый|обожаю|терпеть\s+не\s+могу)/i,
  // Czech
  /\b(preferuji|líbí|nelíbí|miluju|nesnáším|chci|nechci|oblíbený)\b/i,
];

const DECISION_PATTERNS: RegExp[] = [
  // English
  /\b(decided|will\s+use|chose|agreed|going\s+to|selected)\b/i,
  // Russian - no \b for Cyrillic
  /(решили|будем|выбрали|договорились|остановились|используем)/i,
  // Czech
  /\b(rozhodli|budeme|vybrali|dohodli|použijeme)\b/i,
];

const ENTITY_PATTERNS: RegExp[] = [
  // Names
  /\b(my\s+name\s+is|i\s+am|call\s+me)\b/i,
  /(меня\s+зовут|зовут)/i,
  /\b(jmenuji\s+se|jsem)\b/i,
  // Contact info
  /\+\d{10,}/,
  /[\w.-]+@[\w.-]+\.\w{2,}/,
  // Phone/email keywords
  /(телефон|почта)/i,
  /\b(email|phone)\b/i,
  /\b(telefon|e-?mail)\b/i,
  // Organization
  /\b(works?\s+(at|for)|employed\s+by)\b/i,
  /(работаю\s+в|работаю\s+на)/i,
  /\b(pracuji\s+v|pracuji\s+pro)\b/i,
  // Location
  /(живу\s+в|переехал|родом\s+из)/i,
  /\b(live[sd]?\s+in|moved\s+to|from)\b/i,
];

const FACT_PATTERNS: RegExp[] = [
  // English fact patterns
  /\b(is|are|has|have|was|were|will\s+be)\b/i,
  // Russian fact patterns - no \b for Cyrillic
  /(это|является|есть|был|была|будет)/i,
  // Czech fact patterns
  /\b(je|jsou|má|mají|byl|byla|bude)\b/i,
];

// ============================================================================
// Language Detection
// ============================================================================

const CYRILLIC_PATTERN = /[\u0400-\u04FF]/;
const CZECH_PATTERN = /[ěščřžýáíéúůďťňó]/i;

export function detectLanguage(text: string): SupportedLanguage {
  if (CYRILLIC_PATTERN.test(text)) {
    return "ru";
  }
  if (CZECH_PATTERN.test(text)) {
    return "cs";
  }
  return "en";
}

// ============================================================================
// Capture Logic
// ============================================================================

/**
 * Check if text should be captured as a memory
 */
export function shouldCapture(text: string, languages: SupportedLanguage[]): boolean {
  // Length checks — raised max from 500 to 2000
  if (text.length < 10 || text.length > 2000) {
    return false;
  }

  // Skip injected context from memory recall
  if (text.includes("<relevant-memories>")) {
    return false;
  }

  // Skip system-generated content
  if (text.startsWith("<") && text.includes("</")) {
    return false;
  }

  // Skip agent summary responses (markdown formatting)
  if (text.includes("**") && text.includes("\n-")) {
    return false;
  }

  // Skip emoji-heavy responses
  const emojiCount = (text.match(/[\u{1F300}-\u{1F9FF}]/gu) || []).length;
  if (emojiCount > 3) {
    return false;
  }

  // Skip code blocks — only if >50% of text looks like code
  // (fixed: previously rejected any text with "const " or "function ")
  const codeIndicators = ["```", "const ", "function ", "=> {", "import ", "export ", "class ", "var ", "let "];
  let codeTokenCount = 0;
  for (const indicator of codeIndicators) {
    if (text.includes(indicator)) codeTokenCount++;
  }
  const codeRatio = codeTokenCount / codeIndicators.length;
  if (codeRatio > 0.5 || text.includes("```")) {
    return false;
  }

  // Check triggers for enabled languages
  for (const lang of languages) {
    const triggers = TRIGGERS_BY_LANGUAGE[lang];
    if (triggers && triggers.some((r) => r.test(text))) {
      return true;
    }
  }

  return false;
}

/**
 * Detect the category of a memory text
 */
export function detectCategory(text: string): MemoryCategory {
  const lower = text.toLowerCase();

  // Check preference patterns
  if (PREFERENCE_PATTERNS.some((p) => p.test(lower))) {
    return "preference";
  }

  // Check decision patterns
  if (DECISION_PATTERNS.some((p) => p.test(lower))) {
    return "decision";
  }

  // Check entity patterns
  if (ENTITY_PATTERNS.some((p) => p.test(lower))) {
    return "entity";
  }

  // Check fact patterns
  if (FACT_PATTERNS.some((p) => p.test(lower))) {
    return "fact";
  }

  return "other";
}

/**
 * Calculate importance score based on text content.
 * Includes entity density boost.
 */
export function calculateImportance(text: string, entityCount?: number): number {
  let score = 0.5; // Base score

  // Important keywords increase score
  if (/\b(важно|important|критично|critical|essential|обязательно)\b/i.test(text)) {
    score += 0.2;
  }

  // Explicit memory commands increase score
  if (/\b(remember|don't\s+forget)\b/i.test(text) || /(запомни|помни|сохрани)/i.test(text)) {
    score += 0.15;
  }

  // Contact info increases score
  if (/\+\d{10,}|[\w.-]+@[\w.-]+\.\w{2,}/.test(text)) {
    score += 0.1;
  }

  // Personal info increases score
  if (/\b(my\s+name|меня\s+зовут|jmenuji\s+se)\b/i.test(text)) {
    score += 0.1;
  }

  // Decision patterns increase score
  if (/\b(решили|decided|договорились|agreed)\b/i.test(text)) {
    score += 0.1;
  }

  // Relationship mentions increase score
  if (/(мой|моя|наш)\s+(коллега|друг|начальник|брат|сестра|муж|жена)/i.test(text)) {
    score += 0.1;
  }

  // Entity density boost: +0.05 per entity, max +0.15
  if (entityCount && entityCount > 0) {
    score += Math.min(entityCount * 0.05, 0.15);
  }

  // Cap at 1.0
  return Math.min(score, 1.0);
}

/**
 * Extract text content from messages
 */
export function extractMessageTexts(messages: unknown[]): string[] {
  const texts: string[] = [];

  for (const msg of messages) {
    if (!msg || typeof msg !== "object") {
      continue;
    }
    const msgObj = msg as Record<string, unknown>;

    // Only process user and assistant messages
    const role = msgObj.role;
    if (role !== "user" && role !== "assistant") {
      continue;
    }

    const content = msgObj.content;

    // Handle string content directly
    if (typeof content === "string") {
      texts.push(content);
      continue;
    }

    // Handle array content (content blocks)
    if (Array.isArray(content)) {
      for (const block of content) {
        if (
          block &&
          typeof block === "object" &&
          "type" in block &&
          (block as Record<string, unknown>).type === "text" &&
          "text" in block &&
          typeof (block as Record<string, unknown>).text === "string"
        ) {
          texts.push((block as Record<string, unknown>).text as string);
        }
      }
    }
  }

  return texts;
}
