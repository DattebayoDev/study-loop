import { computeWeeklyStats, formatMarkdownReport, formatJsonReport, isoWeekLabel } from '../src/weekly-report-engine';
import { Review, CardMeta } from '../src/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2024-01-22T12:00:00Z').getTime(); // known Monday
const WEEK_AGO = NOW - 7 * DAY;

function makeReview(overrides: Partial<Review> & { card_id: string; grade: Review['grade'] }): Review {
  const ts = overrides.reviewed_at ? new Date(overrides.reviewed_at).getTime() : NOW - DAY;
  return {
    ...overrides,
    review_id: overrides.review_id ?? `${overrides.card_id}:${ts}`,
    reviewed_at: overrides.reviewed_at ?? new Date(ts).toISOString(),
    rating: overrides.rating ?? 1,
    response_time_ms: overrides.response_time_ms ?? null,
    interval: null,
    ease: null,
  };
}

function meta(card_id: string, tech_path: string, concepts: string[]): CardMeta {
  return { card_id, tech_path, concepts };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const cardMetas: CardMeta[] = [
  meta('aurora1', 'AWS/Database/Aurora', ['resilience']),
  meta('kafka1', 'Kafka/Delivery', ['resilience', 'consistency']),
  meta('java1', 'Java/Concurrency', ['performance']),
  meta('ecs1', 'AWS/Compute/ECS', []),
];

const currentReviews: Review[] = [
  makeReview({ card_id: 'aurora1', grade: 'good' }),
  makeReview({ card_id: 'aurora1', grade: 'easy' }),
  makeReview({ card_id: 'aurora1', grade: 'good' }),
  makeReview({ card_id: 'kafka1', grade: 'again' }),
  makeReview({ card_id: 'kafka1', grade: 'again' }),
  makeReview({ card_id: 'kafka1', grade: 'hard' }),
  makeReview({ card_id: 'java1', grade: 'good' }),
  makeReview({ card_id: 'ecs1', grade: 'easy' }),
  makeReview({ card_id: 'ecs1', grade: 'other' }), // should be excluded from graded stats
];

// ── isoWeekLabel ──────────────────────────────────────────────────────────────

describe('isoWeekLabel', () => {
  test('returns YYYY-WW string', () => {
    expect(isoWeekLabel(NOW)).toMatch(/^\d{4}-\d{2}$/);
  });
  test('2024-01-22 is week 2024-04', () => {
    expect(isoWeekLabel(NOW)).toBe('2024-04');
  });
});

// ── computeWeeklyStats ────────────────────────────────────────────────────────

describe('computeWeeklyStats — basic', () => {
  let stats: ReturnType<typeof computeWeeklyStats>;

  beforeAll(() => {
    stats = computeWeeklyStats({
      currentReviews,
      prevReviews: [],
      cardMetas,
      periodStart: WEEK_AGO,
      periodEnd: NOW,
    });
  });

  test('total reviews includes all (incl. other)', () => {
    expect(stats.totalReviews).toBe(9);
  });

  test('distinct cards reviewed', () => {
    expect(stats.totalCardsReviewed).toBe(4);
  });

  test('avgGrade excludes "other"', () => {
    // grades: good(4), easy(5), good(4), again(0), again(0), hard(2.5), good(4), easy(5)
    // avg = (4+5+4+0+0+2.5+4+5)/8 = 24.5/8 = 3.0625
    expect(stats.avgGrade).toBeCloseTo(3.0625, 3);
  });

  test('gradedReviews excludes "other"', () => {
    expect(stats.gradedReviews).toBe(8);
  });
});

describe('computeWeeklyStats — byTech accuracy with rollup', () => {
  let stats: ReturnType<typeof computeWeeklyStats>;

  beforeAll(() => {
    stats = computeWeeklyStats({
      currentReviews,
      prevReviews: [],
      cardMetas,
      periodStart: WEEK_AGO,
      periodEnd: NOW,
    });
  });

  test('leaf-path accuracy: AWS/Database/Aurora should be 100% (3/3 good+easy)', () => {
    const t = stats.byTech.find(t => t.path === 'AWS/Database/Aurora')!;
    expect(t).toBeDefined();
    expect(t.accuracy).toBeCloseTo(1.0, 3);
    expect(t.total).toBe(3);
  });

  test('leaf-path accuracy: Kafka/Delivery = 0/3 (0 good+easy out of 3 graded)', () => {
    const t = stats.byTech.find(t => t.path === 'Kafka/Delivery')!;
    expect(t).toBeDefined();
    expect(t.accuracy).toBeCloseTo(0, 3);
    expect(t.total).toBe(3);
  });

  test('rollup: AWS includes Aurora AND ECS (3 good+easy from Aurora + 1 from ECS = 4/4)', () => {
    const t = stats.byTech.find(t => t.path === 'AWS')!;
    expect(t).toBeDefined();
    // aurora: 3 graded (all good+easy), ecs: 1 graded easy (1 "other" excluded)
    // total graded = 3+1 = 4, good+easy = 4
    expect(t.goodPlusEasy).toBe(4);
    expect(t.total).toBe(4);
    expect(t.accuracy).toBeCloseTo(1.0, 3);
  });

  test('rollup: AWS/Compute exists as intermediate with 1 graded review (other excluded)', () => {
    const t = stats.byTech.find(t => t.path === 'AWS/Compute')!;
    expect(t).toBeDefined();
    expect(t.total).toBe(1); // ecs1 easy; the "other" review is excluded by isGraded
  });

  test('sorted weakest→strongest', () => {
    const accuracies = stats.byTech.map(t => t.accuracy);
    for (let i = 0; i < accuracies.length - 1; i++) {
      expect(accuracies[i]).toBeLessThanOrEqual(accuracies[i + 1]);
    }
  });
});

describe('computeWeeklyStats — byConcept aggregation', () => {
  let stats: ReturnType<typeof computeWeeklyStats>;

  beforeAll(() => {
    stats = computeWeeklyStats({
      currentReviews,
      prevReviews: [],
      cardMetas,
      periodStart: WEEK_AGO,
      periodEnd: NOW,
    });
  });

  test('#resilience spans Aurora AND Kafka', () => {
    const c = stats.byConcept.find(c => c.concept === 'resilience')!;
    expect(c).toBeDefined();
    expect(c.techPaths).toContain('AWS/Database/Aurora');
    expect(c.techPaths).toContain('Kafka/Delivery');
  });

  test('#resilience accuracy = 3 good+easy out of 6 graded (Aurora:3/3 + Kafka:0/3)', () => {
    const c = stats.byConcept.find(c => c.concept === 'resilience')!;
    expect(c.goodPlusEasy).toBe(3);
    expect(c.total).toBe(6);
    expect(c.accuracy).toBeCloseTo(0.5, 3);
  });

  test('#performance only from Java', () => {
    const c = stats.byConcept.find(c => c.concept === 'performance')!;
    expect(c.techPaths).toEqual(['Java/Concurrency']);
    expect(c.accuracy).toBeCloseTo(1.0, 3);
  });

  test('ecs card with no concepts does not create a concept entry', () => {
    // ecs1 has concepts=[] so it shouldn't appear in byConcept
    const conceptNames = stats.byConcept.map(c => c.concept);
    expect(conceptNames).not.toContain('');
  });

  test('sorted weakest→strongest', () => {
    const accuracies = stats.byConcept.map(c => c.accuracy);
    for (let i = 0; i < accuracies.length - 1; i++) {
      expect(accuracies[i]).toBeLessThanOrEqual(accuracies[i + 1]);
    }
  });
});

describe('computeWeeklyStats — repeatedly missed', () => {
  test('flags cards with ≥2 "again" this week', () => {
    const stats = computeWeeklyStats({
      currentReviews,
      prevReviews: [],
      cardMetas,
      periodStart: WEEK_AGO,
      periodEnd: NOW,
    });
    const missed = stats.repeatedlyMissed;
    expect(missed.find(m => m.card_id === 'kafka1')).toBeDefined();
    expect(missed.find(m => m.card_id === 'kafka1')!.againCount).toBe(2);
  });

  test('does not flag cards with only 1 "again"', () => {
    const oneAgain = [makeReview({ card_id: 'aurora1', grade: 'again' })];
    const stats = computeWeeklyStats({
      currentReviews: oneAgain,
      prevReviews: [],
      cardMetas,
      periodStart: WEEK_AGO,
      periodEnd: NOW,
    });
    expect(stats.repeatedlyMissed).toHaveLength(0);
  });
});

describe('computeWeeklyStats — volume and trend', () => {
  test('no previous week → volumeChange is null', () => {
    const stats = computeWeeklyStats({
      currentReviews,
      prevReviews: [],
      cardMetas,
      periodStart: WEEK_AGO,
      periodEnd: NOW,
    });
    expect(stats.volumeChange).toBeNull();
  });

  test('double volume vs last week → +100%', () => {
    const prev = currentReviews.map(r => ({
      ...r,
      reviewed_at: new Date(new Date(r.reviewed_at).getTime() - 7 * DAY).toISOString(),
    })).slice(0, 4); // half the reviews
    const stats = computeWeeklyStats({
      currentReviews,
      prevReviews: prev,
      cardMetas,
      periodStart: WEEK_AGO,
      periodEnd: NOW,
    });
    // current: 8 graded, prev: 4 graded (none are "other") → +100%
    expect(stats.volumeChange).toBeCloseTo(100, 0);
  });

  test('trend: improving when this week accuracy > last week by >3%', () => {
    const prevReviews: Review[] = [
      makeReview({ card_id: 'aurora1', grade: 'again', reviewed_at: new Date(WEEK_AGO - DAY).toISOString() }),
      makeReview({ card_id: 'aurora1', grade: 'again', reviewed_at: new Date(WEEK_AGO - 2 * DAY).toISOString() }),
    ];
    const stats = computeWeeklyStats({
      currentReviews: [makeReview({ card_id: 'aurora1', grade: 'easy' })],
      prevReviews,
      cardMetas,
      periodStart: WEEK_AGO,
      periodEnd: NOW,
    });
    const auroraStats = stats.byTech.find(t => t.path === 'AWS/Database/Aurora')!;
    expect(auroraStats.trend).toBe('improving');
  });
});

describe('formatMarkdownReport', () => {
  test('contains expected sections', () => {
    const stats = computeWeeklyStats({
      currentReviews,
      prevReviews: [],
      cardMetas,
      periodStart: WEEK_AGO,
      periodEnd: NOW,
    });
    const md = formatMarkdownReport(stats);
    expect(md).toContain('WEEKLY STUDY REPORT');
    expect(md).toContain('By technology');
    expect(md).toContain('By concept');
    expect(md).toContain('Repeatedly missed');
    expect(md).toContain('Recommendation');
    expect(md).toContain('AWS/Database/Aurora');
    expect(md).toContain('#resilience');
  });
});

describe('formatJsonReport', () => {
  test('includes both slices', () => {
    const stats = computeWeeklyStats({
      currentReviews,
      prevReviews: [],
      cardMetas,
      periodStart: WEEK_AGO,
      periodEnd: NOW,
    });
    const json = formatJsonReport(stats) as Record<string, unknown>;
    expect(json).toHaveProperty('byTech');
    expect(json).toHaveProperty('byConcept');
    expect(json).toHaveProperty('summary');
    expect(json).toHaveProperty('repeatedlyMissed');
    expect(json).toHaveProperty('recommendation');
    // byTech should include rollup paths
    const paths = (json.byTech as {path: string}[]).map(t => t.path);
    expect(paths).toContain('AWS');
    expect(paths).toContain('AWS/Database/Aurora');
  });
});
