// WHO Child Growth Standards: weight, length and head for age, birth to two
// years, and weight for length.
//
// The tables are the WHO's LMS parameters (src/data/who-*.json): at each
// completed day of age (or each 0.1 cm of length), a Box-Cox power L, a median M (kg or cm) and a
// coefficient of variation S. A measurement becomes a z-score with
//   z = ((v / M)^L − 1) / (L · S)          (L ≠ 0; ln(v / M) / S when L = 0)
// and a z-score becomes a measurement with the inverse. Percentiles are the normal
// CDF of z. This is exactly the arithmetic behind the printed charts, so the
// number here matches the one a health nurse reads off paper.

import wfaGirls from '../data/who-wfa-girls.json';
import wfaBoys from '../data/who-wfa-boys.json';
import lhfaGirls from '../data/who-lhfa-girls.json';
import lhfaBoys from '../data/who-lhfa-boys.json';
import hcfaGirls from '../data/who-hcfa-girls.json';
import hcfaBoys from '../data/who-hcfa-boys.json';
import wflGirls from '../data/who-wfl-girls.json';
import wflBoys from '../data/who-wfl-boys.json';

/**
 * Each indicator's tables and the axis they are indexed by. Age-indexed
 * tables step one day from birth; weight-for-length steps 0.1 cm from 45 cm,
 * and is read by length, so corrected age plays no part in it.
 *   wfa  — weight (kg) for age      lhfa — length (cm) for age
 *   hcfa — head (cm) for age        wfl  — weight (kg) for length
 */
const TABLES = {
  wfa: { girl: wfaGirls.lms, boy: wfaBoys.lms, start: 0, step: 1 },
  lhfa: { girl: lhfaGirls.lms, boy: lhfaBoys.lms, start: 0, step: 1 },
  hcfa: { girl: hcfaGirls.lms, boy: hcfaBoys.lms, start: 0, step: 1 },
  wfl: { girl: wflGirls.lms, boy: wflBoys.lms, start: wflGirls.start, step: wflGirls.step },
};

export const MAX_AGE_DAYS = 730;
export const SEXES = ['girl', 'boy'];
export const INDICATORS = Object.keys(TABLES);

/** The bands the chart draws, as z-scores, and how the printed charts name them. */
export const BAND_Z = { outer: 2, inner: 1 };
export const MAJOR_LINES = [-2, -1, 0, 1, 2];   // 3rd · 15th · 50th · 85th · 97th

/** [L, M, S] for an indicator and sex at x (days, or cm for wfl), clamped to the table. */
export function lmsFor(indicator, sex, x) {
  const t = TABLES[indicator];
  const table = t && t[sex];
  if (!table || !Number.isFinite(Number(x))) return null;
  const i = Math.min(table.length - 1, Math.max(0, Math.round((Number(x) - t.start) / t.step)));
  return table[i];
}

/** z-score of a value in the table's own unit (kg or cm). Null when it cannot be computed. */
export function zOf(indicator, sex, x, value) {
  const lms = lmsFor(indicator, sex, x);
  if (!lms || !(value > 0)) return null;
  const [L, M, S] = lms;
  const ratio = value / M;
  const z = L === 0 ? Math.log(ratio) / S : (Math.pow(ratio, L) - 1) / (L * S);
  return Number.isFinite(z) ? z : null;
}

/** The value (kg or cm) at a z-score. */
export function valueAt(indicator, sex, x, z) {
  const lms = lmsFor(indicator, sex, x);
  if (!lms) return null;
  const [L, M, S] = lms;
  const v = L === 0 ? M * Math.exp(S * z) : M * Math.pow(1 + L * S * z, 1 / L);
  return Number.isFinite(v) ? v : null;
}

// Weight-for-age in grams: the names the weight card was built on.

/** [L, M, S] for weight-for-age at an age. Null for a bad sex. */
export function lmsAt(sex, ageDays) {
  return lmsFor('wfa', sex, ageDays);
}

/** z-score of a weight in GRAMS at an age. */
export function zScore(sex, ageDays, grams) {
  return grams > 0 ? zOf('wfa', sex, ageDays, grams / 1000) : null;
}

/** Weight in grams at a given z-score and age. */
export function weightAtZ(sex, ageDays, z) {
  const kg = valueAt('wfa', sex, ageDays, z);
  return kg == null ? null : Math.round(kg * 1000);
}

/** Standard normal CDF (Abramowitz & Stegun 26.2.17, error < 7.5e-8). */
export function normalCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const tail = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI) * poly;
  return z >= 0 ? 1 - tail : tail;
}

/** 0–100 percentile for a z-score. */
export function percentile(z) {
  return normalCdf(z) * 100;
}

/** "72nd", "3rd", "50th"; under 1 and over 99 read as "<1st" / ">99th". */
export function ordinal(p) {
  const n = Math.round(p);
  if (n < 1) return '<1st';
  if (n > 99) return '>99th';
  const mod100 = n % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th'
    : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  return `${n}${suffix}`;
}

/** How many of the printed major lines lie strictly between two z-scores. */
export function linesCrossed(z1, z2) {
  if (z1 == null || z2 == null) return 0;
  const lo = Math.min(z1, z2);
  const hi = Math.max(z1, z2);
  return MAJOR_LINES.filter((line) => line > lo && line < hi).length;
}
