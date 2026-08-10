import { Grade } from './types';

/**
 * QueueInteractionScore buckets from the RemNote SDK.
 * AGAIN=0, HARD=0.5, GOOD=1, EASY=1.5
 * Everything else (TOO_EARLY=0.01, VIEWED_AS_LEECH=2, RESET=3, MANUAL_DATE=4, MANUAL_EASE=5)
 * maps to "other" and is excluded from accuracy calculations.
 */
export function mapScore(score: number): Grade {
  if (score === 0) return 'again';
  if (score === 0.5) return 'hard';
  if (score === 1) return 'good';
  if (score === 1.5) return 'easy';
  return 'other';
}

/**
 * Display-scale grade values (0–5) for the weekly report average.
 * "other" returns null and is excluded from the average.
 */
export const GRADE_DISPLAY_VALUE: Record<Grade, number | null> = {
  again: 0,
  hard: 2.5,
  good: 4,
  easy: 5,
  other: null,
};

/** True for grades that count toward accuracy (good + easy). */
export function isAccurate(grade: Grade): boolean {
  return grade === 'good' || grade === 'easy';
}

/** True for grades that count toward the graded total (excludes "other"). */
export function isGraded(grade: Grade): boolean {
  return grade !== 'other';
}

/** Compute the display-scale average grade from a list of grades. Excludes "other". */
export function avgDisplayGrade(grades: Grade[]): number {
  const values = grades
    .map(g => GRADE_DISPLAY_VALUE[g])
    .filter((v): v is number => v !== null);
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
