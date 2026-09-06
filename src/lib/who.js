// WHO Child Growth Standards, weight-for-age, birth to two years.
//
// The tables are the WHO's daily LMS parameters (src/data/who-wfa-*.json): at
// each completed day of age, a Box-Cox power L, a median M (kg) and a
// coefficient of variation S. A weight becomes a z-score with
//   z = ((w / M)^L − 1) / (L · S)          (L ≠ 0; ln(w / M) / S when L = 0)
// and a z-score becomes a weight with the inverse. Percentiles are the normal
// CDF of z. This is exactly the arithmetic behind the printed charts, so the
// number here matches the one a health nurse reads off paper.

import girls from '../data/who-wfa-girls.json';
import boys from '../data/who-wfa-boys.json';

const TABLES = { girl: girls.lms, boy: boys.lms };

export const MAX_AGE_DAYS = 730;
export const SEXES = ['girl', 'boy'];

/** The bands the chart draws, as z-scores, and how the printed charts name them. */
export const BAND_Z = { outer: 2, inner: 1 };
export const MAJOR_LINES = [-2, -1, 0, 1, 2];   // 3rd · 15th · 50th · 85th · 97th

/** [L, M, S] for a sex at an age, clamped to the table. Null for a bad sex. */
export function lmsAt(sex, ageDays) {
  const table = TABLES[sex];
  if (!table) return null;
  const d = Math.min(MAX_AGE_DAYS, Math.max(0, Math.round(ageDays)));
  return table[d];
}

/** z-score of a weight in GRAMS at an age. Null when it cannot be computed. */
export function zScore(sex, ageDays, grams) {
  const lms = lmsAt(sex, ageDays);
  if (!lms || !(grams > 0)) return null;
  const [L, M, S] = lms;
  const ratio = grams / 1000 / M;
  const z = L === 0 ? Math.log(ratio) / S : (Math.pow(ratio, L) - 1) / (L * S);
  return Number.isFinite(z) ? z : null;
}

/** Weight in grams at a given z-score and age. */
export function weightAtZ(sex, ageDays, z) {
  const lms = lmsAt(sex, ageDays);
  if (!lms) return null;
  const [L, M, S] = lms;
  const kg = L === 0 ? M * Math.exp(S * z) : M * Math.pow(1 + L * S * z, 1 / L);
  return Number.isFinite(kg) ? Math.round(kg * 1000) : null;
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
