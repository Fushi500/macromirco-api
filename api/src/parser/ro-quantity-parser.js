/**
 * Romanian food text parser.
 *
 * Takes free-text like "am mâncat 3 sarmale" or "jumătate de pizza"
 * and extracts: { food_query, quantity, unit, grams }.
 *
 * All nutrient values in Meilisearch are per 100g, so grams is the key
 * multiplier the client needs.
 */

// ── Romanian number words ──────────────────────────────────────────
const NUMBER_WORDS = {
  'un': 1, 'una': 1, 'unu': 1, 'o': 1,
  'doi': 2, 'doua': 2, 'două': 2,
  'trei': 3,
  'patru': 4,
  'cinci': 5,
  'sase': 6, 'șase': 6,
  'sapte': 7, 'șapte': 7,
  'opt': 8,
  'noua': 9, 'nouă': 9,
  'zece': 10,
  'unsprezece': 11, 'unspe': 11,
  'doisprezece': 12, 'doispe': 12,
  'treisprezece': 13,
  'paisprezece': 14,
  'cincisprezece': 15,
  'sasesprezece': 16, 'șasesprezece': 16,
  'saptesprezece': 17, 'șaptesprezece': 17,
  'optsprezece': 18,
  'nouasprezece': 19, 'nouăsprezece': 19,
  'douazeci': 20, 'douăzeci': 20,
};

// ── Fraction words ─────────────────────────────────────────────────
const FRACTION_WORDS = {
  'jumatate': 0.5, 'jumătate': 0.5, 'juma': 0.5,
  'sfert': 0.25,
  'treime': 1 / 3,
};

// ── Filler phrases to strip (ordered longest → shortest) ──────────
const FILLER_PATTERNS = [
  /\bam\s+m[aâ]ncat\b/i,
  /\bam\s+b[aă]ut\b/i,
  /\bam\s+luat\b/i,
  /\bam\s+avut\b/i,
  /\bvreau\s+s[aă]\s+m[aă]n[aâ]nc\b/i,
  /\bvreau\b/i,
  /\bm[aâ]n[aâ]nc\b/i,
  /\bbeau\b/i,
  /\bca\s+la\b/i,
  /\bcam\b/i,
  /\baproximativ\b/i,
  /\bpe\s+la\b/i,
  /\bceva\b/i,
  /\bniste\b/i, /\bniște\b/i,
  /\bpuțin[aă]?\b/i, /\bputin[aă]?\b/i,
];

// ── Unit aliases → canonical unit + default grams ──────────────────
// default_grams is used when we can't match a portion from USDA
const UNIT_MAP = {
  // metric
  'g': { unit: 'g', g: 1 },
  'gr': { unit: 'g', g: 1 },
  'gram': { unit: 'g', g: 1 },
  'grame': { unit: 'g', g: 1 },
  'kg': { unit: 'kg', g: 1000 },
  'kilogram': { unit: 'kg', g: 1000 },
  'kilograme': { unit: 'kg', g: 1000 },
  'ml': { unit: 'ml', g: 1 },
  'mililitri': { unit: 'ml', g: 1 },
  'l': { unit: 'l', g: 1000 },
  'litru': { unit: 'l', g: 1000 },
  'litri': { unit: 'l', g: 1000 },
  // volume / household
  'cana': { unit: 'cup', g: 240 },
  'cană': { unit: 'cup', g: 240 },
  'cani': { unit: 'cup', g: 240 },
  'cup': { unit: 'cup', g: 240 },
  'pahar': { unit: 'cup', g: 240 },
  'pahare': { unit: 'cup', g: 240 },
  'lingura': { unit: 'tbsp', g: 15 },
  'lingură': { unit: 'tbsp', g: 15 },
  'linguri': { unit: 'tbsp', g: 15 },
  'tbsp': { unit: 'tbsp', g: 15 },
  'lingurita': { unit: 'tsp', g: 5 },
  'lingurița': { unit: 'tsp', g: 5 },
  'lingurite': { unit: 'tsp', g: 5 },
  'tsp': { unit: 'tsp', g: 5 },
  // portions
  'felie': { unit: 'slice', g: 30 },
  'felii': { unit: 'slice', g: 30 },
  'bucata': { unit: 'piece', g: null },
  'bucată': { unit: 'piece', g: null },
  'bucati': { unit: 'piece', g: null },
  'bucăți': { unit: 'piece', g: null },
  'buc': { unit: 'piece', g: null },
  'portie': { unit: 'serving', g: null },
  'porție': { unit: 'serving', g: null },
  'portii': { unit: 'serving', g: null },
  'porții': { unit: 'serving', g: null },
  'farfurie': { unit: 'plate', g: 300 },
  'farfurii': { unit: 'plate', g: 300 },
};

// Preposition words to strip between quantity/unit and food name
const PREPOSITIONS = new Set(['de', 'cu', 'din', 'la']);

/**
 * Normalize Romanian diacritics for matching.
 * ă→a, â→a, î→i, ș→s, ț→t
 */
function stripDiacritics(s) {
  return s
    .replace(/[ăâ]/g, 'a')
    .replace(/[îì]/g, 'i')
    .replace(/[șş]/g, 's')
    .replace(/[țţ]/g, 't');
}

/**
 * Parse a Romanian food text input.
 *
 * @param {string} text - User input, e.g. "am mâncat 3 sarmale"
 * @returns {{ food_query: string, quantity: number, unit: string, grams: number|null, raw: string }}
 */
function parseRomanianFoodText(text) {
  const raw = text.trim();
  let s = raw.toLowerCase().trim();

  // Strip filler phrases
  for (const pat of FILLER_PATTERNS) {
    s = s.replace(pat, ' ');
  }
  s = s.replace(/\s+/g, ' ').trim();

  let quantity = 1;
  let unit = 'serving';
  let gramsPerUnit = null;

  // ── Try to extract quantity ──────────────────────────────────────

  // Pattern 1: numeric quantity with optional unit — "200g", "3 linguri", "1.5 kg"
  const numericRe = /^(\d+(?:[.,]\d+)?)\s*([a-zA-ZăâîșțĂÂÎȘȚ]*)\s*/;
  const numMatch = s.match(numericRe);

  if (numMatch) {
    quantity = parseFloat(numMatch[1].replace(',', '.'));
    const maybeUnit = numMatch[2].toLowerCase();
    s = s.slice(numMatch[0].length).trim();

    if (maybeUnit && UNIT_MAP[maybeUnit]) {
      unit = UNIT_MAP[maybeUnit].unit;
      gramsPerUnit = UNIT_MAP[maybeUnit].g;
    } else if (maybeUnit && UNIT_MAP[stripDiacritics(maybeUnit)]) {
      const m = UNIT_MAP[stripDiacritics(maybeUnit)];
      unit = m.unit;
      gramsPerUnit = m.g;
    } else if (maybeUnit) {
      // The "unit" text is actually part of the food name — put it back
      s = maybeUnit + ' ' + s;
      s = s.trim();
    }
  } else {
    // Pattern 2: fraction word — "jumătate de pizza"
    const words = s.split(/\s+/);
    const firstNorm = stripDiacritics(words[0]);
    if (FRACTION_WORDS[firstNorm] != null) {
      quantity = FRACTION_WORDS[firstNorm];
      words.shift();
      s = words.join(' ');
    } else if (FRACTION_WORDS[words[0]] != null) {
      quantity = FRACTION_WORDS[words[0]];
      words.shift();
      s = words.join(' ');
    } else {
      // Pattern 3: number word — "trei sarmale"
      if (NUMBER_WORDS[words[0]] != null) {
        quantity = NUMBER_WORDS[words[0]];
        words.shift();
        s = words.join(' ');
      } else if (NUMBER_WORDS[firstNorm] != null) {
        quantity = NUMBER_WORDS[firstNorm];
        words.shift();
        s = words.join(' ');
      }
    }

    // After extracting number/fraction word, check if next word is a unit
    const remainingWords = s.split(/\s+/);
    if (remainingWords.length > 0) {
      const maybeUnit = remainingWords[0].toLowerCase();
      const maybeUnitNorm = stripDiacritics(maybeUnit);
      if (UNIT_MAP[maybeUnit]) {
        unit = UNIT_MAP[maybeUnit].unit;
        gramsPerUnit = UNIT_MAP[maybeUnit].g;
        remainingWords.shift();
        s = remainingWords.join(' ');
      } else if (UNIT_MAP[maybeUnitNorm]) {
        unit = UNIT_MAP[maybeUnitNorm].unit;
        gramsPerUnit = UNIT_MAP[maybeUnitNorm].g;
        remainingWords.shift();
        s = remainingWords.join(' ');
      }
    }
  }

  // ── Strip leading prepositions ───────────────────────────────────
  let foodWords = s.split(/\s+/).filter(Boolean);
  while (foodWords.length > 1 && PREPOSITIONS.has(foodWords[0])) {
    foodWords.shift();
  }
  const food_query = foodWords.join(' ').trim();

  // ── Calculate grams if possible ──────────────────────────────────
  let grams = null;
  if (gramsPerUnit != null) {
    grams = Math.round(quantity * gramsPerUnit);
  }

  return { food_query, quantity, unit, grams, raw };
}

/**
 * Split a multi-food input into individual items.
 *
 * Separators: comma, semicolon, newline, " și ", " si ", " and ", " plus "
 * Examples:
 *   "2 pizza, 1 cola" → ["2 pizza", "1 cola"]
 *   "am mâncat 3 sarmale și am băut un pahar de suc" → ["am mâncat 3 sarmale", "am băut un pahar de suc"]
 *
 * @param {string} text - Raw user input
 * @returns {string[]} Individual food items
 */
function splitMultiFoodInput(text) {
  // Split on: comma, semicolon, newline, " și ", " si ", " and ", " plus "
  const parts = text
    .split(/\s*[,;]\s*|\n+|\s+(?:și|si|and|plus)\s+/i)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  return parts.length > 0 ? parts : [text.trim()];
}

/**
 * Parse a multi-food input. Returns an array of parsed results.
 *
 * @param {string} text - User input, possibly containing multiple foods
 * @returns {Array<{ food_query, quantity, unit, grams, raw }>}
 */
function parseMultiFoodText(text) {
  const items = splitMultiFoodInput(text);
  return items.map(item => parseRomanianFoodText(item));
}

module.exports = { parseRomanianFoodText, splitMultiFoodInput, parseMultiFoodText };
