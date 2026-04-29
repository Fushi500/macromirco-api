'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMealType, normalizeEntryType, removeDiacritics } = require('./mealType');

// ---------------------------------------------------------------------------
// removeDiacritics
// ---------------------------------------------------------------------------
test('removeDiacritics — leaves ASCII untouched', () => {
  assert.equal(removeDiacritics('pranz'), 'pranz');
});

test('removeDiacritics — ă â î ș ț (Unicode U+021x variants)', () => {
  assert.equal(removeDiacritics('ăâîșț'), 'aaist');
});

test('removeDiacritics — ş ţ (cedilla/comma variants)', () => {
  assert.equal(removeDiacritics('şţ'), 'st');
});

test('removeDiacritics — mixed sentence', () => {
  assert.equal(removeDiacritics('prânz și cină'), 'pranz si cina');
});

// ---------------------------------------------------------------------------
// normalizeMealType — canonical inputs
// ---------------------------------------------------------------------------
test('breakfast (en)', () => assert.equal(normalizeMealType('breakfast'), 'breakfast'));
test('lunch (en)',     () => assert.equal(normalizeMealType('lunch'),     'lunch'));
test('dinner (en)',   () => assert.equal(normalizeMealType('dinner'),     'dinner'));
test('snack (en)',    () => assert.equal(normalizeMealType('snack'),      'snack'));
test('other (en)',    () => assert.equal(normalizeMealType('other'),      'other'));

// ---------------------------------------------------------------------------
// normalizeMealType — Romanian aliases (no diacritics)
// ---------------------------------------------------------------------------
test('mic dejun → breakfast',  () => assert.equal(normalizeMealType('mic dejun'),  'breakfast'));
test('mic_dejun → breakfast',  () => assert.equal(normalizeMealType('mic_dejun'),  'breakfast'));
test('dejun → breakfast',      () => assert.equal(normalizeMealType('dejun'),      'breakfast'));
test('pranz → lunch',          () => assert.equal(normalizeMealType('pranz'),      'lunch'));
test('cina → dinner',          () => assert.equal(normalizeMealType('cina'),       'dinner'));
test('gustare → snack',        () => assert.equal(normalizeMealType('gustare'),    'snack'));
test('altul → other',          () => assert.equal(normalizeMealType('altul'),      'other'));
test('altele → other',         () => assert.equal(normalizeMealType('altele'),     'other'));

// ---------------------------------------------------------------------------
// normalizeMealType — Romanian aliases (with diacritics)
// ---------------------------------------------------------------------------
test('prânz → lunch',   () => assert.equal(normalizeMealType('prânz'),  'lunch'));
test('cină → dinner',   () => assert.equal(normalizeMealType('cină'),   'dinner'));
// mic_dejun is already ASCII but confirm robustness
test('Mic Dejun (caps) → breakfast', () => assert.equal(normalizeMealType('Mic Dejun'), 'breakfast'));

// ---------------------------------------------------------------------------
// normalizeMealType — whitespace / casing / separators
// ---------------------------------------------------------------------------
test('  Breakfast  (padded) → breakfast', () => assert.equal(normalizeMealType('  Breakfast  '), 'breakfast'));
test('LUNCH → lunch',                     () => assert.equal(normalizeMealType('LUNCH'),         'lunch'));
test('mic-dejun (hyphen) → breakfast',    () => assert.equal(normalizeMealType('mic-dejun'),     'breakfast'));

// ---------------------------------------------------------------------------
// normalizeMealType — unknown / edge cases fall back to 'other'
// ---------------------------------------------------------------------------
test('unknown string → other',  () => assert.equal(normalizeMealType('elevenses'),  'other'));
test('empty string → other',    () => assert.equal(normalizeMealType(''),           'other'));
test('null → other',            () => assert.equal(normalizeMealType(null),         'other'));
test('undefined → other',       () => assert.equal(normalizeMealType(undefined),    'other'));
test('number → other',          () => assert.equal(normalizeMealType(42),           'other'));

// ---------------------------------------------------------------------------
// normalizeEntryType
// ---------------------------------------------------------------------------
test('food → food',        () => assert.equal(normalizeEntryType('food'),    'food'));
test('drink → drink',      () => assert.equal(normalizeEntryType('drink'),   'drink'));
test('other → food',       () => assert.equal(normalizeEntryType('other'),   'food'));
test('beverage → food',    () => assert.equal(normalizeEntryType('beverage'),'food'));
test('null → food',        () => assert.equal(normalizeEntryType(null),      'food'));
test('undefined → food',   () => assert.equal(normalizeEntryType(undefined), 'food'));
