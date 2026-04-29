'use strict';

// Romanian diacritics → ASCII equivalents (both Unicode variants per character)
const DIACRITICS_MAP = {
  'ă': 'a', 'â': 'a', 'î': 'i',
  'ș': 's', 'ş': 's',   // U+0219 and U+015F
  'ț': 't', 'ţ': 't',   // U+021B and U+0163
  'Ă': 'A', 'Â': 'A', 'Î': 'I',
  'Ș': 'S', 'Ş': 'S',
  'Ț': 'T', 'Ţ': 'T',
};

function removeDiacritics(str) {
  return str.replace(/[ăâîșşțţĂÂÎȘŞȚŢ]/g, c => DIACRITICS_MAP[c] ?? c);
}

// Maps every accepted alias → canonical value.
// Keys are already lowercase + diacritics-stripped.
const MEAL_ALIASES = {
  'mic dejun':  'breakfast',
  'mic_dejun':  'breakfast',
  'dejun':      'breakfast',
  'breakfast':  'breakfast',
  'pranz':      'lunch',
  'lunch':      'lunch',
  'cina':       'dinner',
  'dinner':     'dinner',
  'gustare':    'snack',
  'snack':      'snack',
  'altul':      'other',
  'altele':     'other',
  'other':      'other',
};

/**
 * Accept any free-form meal_type string from the client and return one of:
 *   breakfast | lunch | dinner | snack | other
 *
 * Never throws — unknown values fall back to 'other'.
 */
function normalizeMealType(raw) {
  if (!raw || typeof raw !== 'string') return 'other';

  const key = removeDiacritics(raw.trim().toLowerCase())
    .replace(/[-_]/g, ' ')   // mic_dejun / mic-dejun → mic dejun
    .replace(/\s+/g, ' ');   // collapse multiple spaces

  return MEAL_ALIASES[key] ?? 'other';
}

/**
 * Accept any entry_type string; persist only 'food' or 'drink'.
 * Unknown values fall back to 'food'.
 */
function normalizeEntryType(raw) {
  if (raw === 'drink') return 'drink';
  return 'food';
}

module.exports = { normalizeMealType, normalizeEntryType, removeDiacritics };
