/**
 * Az.js morphological analyzer wrapper for Russian language.
 *
 * Provides lazy-initialized access to Az.Morph for:
 * - Normalizing words to nominative/base form (Дмитрия -> Дмитрий)
 * - Detecting proper names (Name, Surn, Patr grammemes)
 * - Detecting geographical names (Geox grammeme)
 * - POS-based filtering (reject verbs/adjectives misidentified as names)
 */

import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Az.js is CJS-only; use createRequire to load it in ESM context
const require = createRequire(import.meta.url);

// Az types (Az.js has no TS declarations, so we define minimal shapes)
type AzParse = {
  word: string;
  tag: {
    POS: string | null;
    CAse: string | null;
    /** Proper first name */
    Name: boolean;
    /** Surname */
    Surn: boolean;
    /** Patronymic */
    Patr: boolean;
    /** Geographical name */
    Geox: boolean;
    /** Organization name */
    Orgn: boolean;
    toString(): string;
  };
  normalize(): AzParse;
  inflect(grammemes: Record<string, string>): AzParse | null;
};

type AzMorphFn = {
  (word: string, config?: Record<string, unknown>): AzParse[];
  init(path: string, callback: (err?: Error) => void): void;
  init(callback: (err?: Error) => void): void;
};

type AzModule = {
  Morph: AzMorphFn;
};

let Az: AzModule | null = null;
let initialized = false;
let initPromise: Promise<void> | null = null;

/**
 * Ensure Az.Morph dictionaries are loaded (one-time async init).
 * After first call, all Az.Morph() calls are synchronous.
 */
export async function ensureMorphInit(): Promise<void> {
  if (initialized) return;
  if (initPromise) return initPromise;

  initPromise = new Promise<void>((resolve, reject) => {
    try {
      Az = require("az") as AzModule;
    } catch (err) {
      reject(new Error(`Failed to load az module: ${err}`));
      return;
    }

    // Az.Morph.init loads DAWG dictionaries from the az package's dicts/ folder.
    // Pass no path arg to use the default dicts bundled with the package.
    Az.Morph.init((err?: Error) => {
      if (err) {
        reject(new Error(`Az.Morph.init failed: ${err.message}`));
        return;
      }
      initialized = true;
      resolve();
    });
  });

  return initPromise;
}

/**
 * Parse a Russian word with Az.Morph. Returns array of parse variants
 * sorted by descending plausibility.
 */
function parse(word: string): AzParse[] {
  if (!Az || !initialized) return [];
  try {
    return Az.Morph(word);
  } catch {
    return [];
  }
}

/**
 * Normalize a Russian word to its base/nominative form.
 * Returns the original word if normalization fails or Az is not initialized.
 */
export function normalize(word: string): string {
  const parses = parse(word);
  if (parses.length === 0) return word;
  try {
    const norm = parses[0].normalize();
    return norm?.word || word;
  } catch {
    return word;
  }
}

/**
 * Check if a word is a proper first name (Name grammeme in OpenCorpora).
 * Returns false if Az is not initialized or word is unknown.
 */
export function isProperName(word: string): boolean {
  const parses = parse(word);
  if (parses.length === 0) return false;
  // Check top parse variants (word may have multiple interpretations)
  return parses.some((p) => p.tag.Name || p.tag.Surn || p.tag.Patr);
}

/**
 * Check if a word is a geographical name (Geox grammeme).
 */
export function isGeoName(word: string): boolean {
  const parses = parse(word);
  if (parses.length === 0) return false;
  return parses.some((p) => p.tag.Geox);
}

/**
 * Check if a word is an organization name (Orgn grammeme).
 */
export function isOrgName(word: string): boolean {
  const parses = parse(word);
  if (parses.length === 0) return false;
  return parses.some((p) => p.tag.Orgn);
}

/**
 * Get the POS (part of speech) for the most likely parse of a word.
 * Common POS values: NOUN, VERB, ADJF, ADJS, ADVB, PREP, CONJ, PRTF, GRND, INFN, etc.
 */
export function getPOS(word: string): string | null {
  const parses = parse(word);
  if (parses.length === 0) return null;
  return parses[0].tag.POS;
}

/**
 * Check if a word is likely a false positive for person name extraction.
 * Returns true if the word is a verb, adjective, adverb, preposition, conjunction, etc.
 */
export function isFalsePositiveName(word: string): boolean {
  const parses = parse(word);
  if (parses.length === 0) return false;

  const tag = parses[0].tag;
  const pos = tag.POS;

  // If top parse is a proper name, not a false positive
  if (tag.Name || tag.Surn || tag.Patr || tag.Geox) {
    return false;
  }

  // Reject common POS types that aren't names
  const falsePosTags = new Set([
    "VERB",
    "INFN",
    "GRND",
    "PRTF",
    "PRTS",
    "ADJF",
    "ADJS",
    "ADVB",
    "PREP",
    "CONJ",
    "PRCL",
    "INTJ",
    "PRED",
    "NPRO", // pronoun
  ]);

  if (pos && falsePosTags.has(pos)) {
    return true;
  }

  return false;
}

/**
 * Batch normalize multiple words. Returns array of normalized forms.
 */
export function normalizeAll(words: string[]): string[] {
  return words.map(normalize);
}

/**
 * Check whether the Az morphology engine is ready.
 */
export function isMorphReady(): boolean {
  return initialized;
}
