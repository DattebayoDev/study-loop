import { mapScore, GRADE_DISPLAY_VALUE, isAccurate, isGraded, avgDisplayGrade } from '../src/grade-mapper';

describe('mapScore', () => {
  test('0 → again', () => expect(mapScore(0)).toBe('again'));
  test('0.5 → hard', () => expect(mapScore(0.5)).toBe('hard'));
  test('1 → good', () => expect(mapScore(1)).toBe('good'));
  test('1.5 → easy', () => expect(mapScore(1.5)).toBe('easy'));

  // All the "other" QueueInteractionScore values
  test('0.01 (TOO_EARLY) → other', () => expect(mapScore(0.01)).toBe('other'));
  test('2 (VIEWED_AS_LEECH) → other', () => expect(mapScore(2)).toBe('other'));
  test('3 (RESET) → other', () => expect(mapScore(3)).toBe('other'));
  test('4 (MANUAL_DATE) → other', () => expect(mapScore(4)).toBe('other'));
  test('5 (MANUAL_EASE) → other', () => expect(mapScore(5)).toBe('other'));
  test('unknown value → other', () => expect(mapScore(99)).toBe('other'));
});

describe('GRADE_DISPLAY_VALUE', () => {
  test('again = 0', () => expect(GRADE_DISPLAY_VALUE.again).toBe(0));
  test('hard = 2.5', () => expect(GRADE_DISPLAY_VALUE.hard).toBe(2.5));
  test('good = 4', () => expect(GRADE_DISPLAY_VALUE.good).toBe(4));
  test('easy = 5', () => expect(GRADE_DISPLAY_VALUE.easy).toBe(5));
  test('other = null', () => expect(GRADE_DISPLAY_VALUE.other).toBeNull());
});

describe('isAccurate', () => {
  test('good → true', () => expect(isAccurate('good')).toBe(true));
  test('easy → true', () => expect(isAccurate('easy')).toBe(true));
  test('again → false', () => expect(isAccurate('again')).toBe(false));
  test('hard → false', () => expect(isAccurate('hard')).toBe(false));
  test('other → false', () => expect(isAccurate('other')).toBe(false));
});

describe('isGraded', () => {
  test('again → true', () => expect(isGraded('again')).toBe(true));
  test('hard → true', () => expect(isGraded('hard')).toBe(true));
  test('good → true', () => expect(isGraded('good')).toBe(true));
  test('easy → true', () => expect(isGraded('easy')).toBe(true));
  test('other → false', () => expect(isGraded('other')).toBe(false));
});

describe('avgDisplayGrade', () => {
  test('all "other" → 0', () => expect(avgDisplayGrade(['other', 'other'])).toBe(0));
  test('empty → 0', () => expect(avgDisplayGrade([])).toBe(0));
  test('mixed grades', () => {
    // again=0, good=4, easy=5 → avg = (0+4+5)/3 = 3
    expect(avgDisplayGrade(['again', 'good', 'easy'])).toBeCloseTo(3, 5);
  });
  test('excludes "other" from average', () => {
    // good=4, other=null → avg = 4
    expect(avgDisplayGrade(['good', 'other'])).toBeCloseTo(4, 5);
  });
  test('all easy → 5', () => expect(avgDisplayGrade(['easy', 'easy', 'easy'])).toBe(5));
});
