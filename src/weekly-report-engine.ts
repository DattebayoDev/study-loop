import { Review, CardMeta, WeeklyStats, TechStats, ConceptStats, MissedCard } from './types';
import { isAccurate, isGraded, avgDisplayGrade } from './grade-mapper';

/**
 * Return the ISO week label for a timestamp: "YYYY-WW".
 * Uses the ISO 8601 week definition (week starts Monday).
 */
export function isoWeekLabel(ms: number): string {
  const d = new Date(ms);
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayOfWeek = tmp.getUTCDay() || 7; // Sunday=0 → 7
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayOfWeek);
  const year = tmp.getUTCFullYear();
  const startOfYear = new Date(Date.UTC(year, 0, 1));
  const weekNum = Math.ceil(((tmp.getTime() - startOfYear.getTime()) / 86400000 + 1) / 7);
  return `${year}-${String(weekNum).padStart(2, '0')}`;
}

function buildMetaMap(metas: CardMeta[]): Map<string, CardMeta> {
  return new Map(metas.map(m => [m.card_id, m]));
}

function computeTechRollup(
  reviews: Review[],
  metaMap: Map<string, CardMeta>
): Map<string, { good: number; total: number }> {
  const stats = new Map<string, { good: number; total: number }>();

  for (const r of reviews) {
    if (!isGraded(r.grade)) continue;
    const meta = metaMap.get(r.card_id);
    if (!meta?.tech_path) continue;

    const segments = meta.tech_path.split('/');
    for (let i = 1; i <= segments.length; i++) {
      const prefix = segments.slice(0, i).join('/');
      const s = stats.get(prefix) ?? { good: 0, total: 0 };
      s.total++;
      if (isAccurate(r.grade)) s.good++;
      stats.set(prefix, s);
    }
  }
  return stats;
}

function computeConceptRollup(
  reviews: Review[],
  metaMap: Map<string, CardMeta>
): Map<string, { good: number; total: number; techPaths: Set<string> }> {
  const stats = new Map<string, { good: number; total: number; techPaths: Set<string> }>();

  for (const r of reviews) {
    if (!isGraded(r.grade)) continue;
    const meta = metaMap.get(r.card_id);
    if (!meta?.concepts?.length) continue;

    for (const concept of meta.concepts) {
      const s = stats.get(concept) ?? { good: 0, total: 0, techPaths: new Set() };
      s.total++;
      if (isAccurate(r.grade)) s.good++;
      if (meta.tech_path) s.techPaths.add(meta.tech_path);
      stats.set(concept, s);
    }
  }
  return stats;
}

function computeMissed(
  reviews: Review[],
  metaMap: Map<string, CardMeta>
): MissedCard[] {
  const againCount = new Map<string, number>();
  for (const r of reviews) {
    if (r.grade === 'again') {
      againCount.set(r.card_id, (againCount.get(r.card_id) ?? 0) + 1);
    }
  }
  return Array.from(againCount.entries())
    .filter(([, c]) => c >= 2)
    .map(([card_id, againCount]) => {
      const meta = metaMap.get(card_id);
      return { card_id, tech_path: meta?.tech_path ?? null, concepts: meta?.concepts ?? [], againCount };
    })
    .sort((a, b) => b.againCount - a.againCount);
}

function buildRecommendation(
  byConcept: ConceptStats[],
  missed: MissedCard[]
): string {
  if (byConcept.length === 0 && missed.length === 0) return 'No review data this week.';

  const parts: string[] = [];

  // Weakest concept
  const weakestConcept = byConcept[0]; // already sorted weakest→strongest
  if (weakestConcept && weakestConcept.accuracy < 0.85) {
    const techList = weakestConcept.techPaths.slice(0, 3).join(', ');
    parts.push(
      `Focus on #${weakestConcept.concept} (${Math.round(weakestConcept.accuracy * 100)}% accuracy across: ${techList || 'various paths'})`
    );
  }

  // Missed cards
  if (missed.length > 0) {
    const sample = missed
      .slice(0, 3)
      .map(m => `${m.card_id.slice(0, 8)}… (missed ${m.againCount}×, path: ${m.tech_path ?? 'unknown'})`)
      .join('; ');
    parts.push(`Rewrite repeatedly-missed cards: ${sample}`);
  }

  // Weakest tech path
  const weakestTech = byConcept.length === 0 ? null : null; // from byTech
  if (parts.length === 0) parts.push('Keep up the strong performance across all topics.');

  return parts.join('. ') + '.';
}

export function computeWeeklyStats(opts: {
  currentReviews: Review[];  // reviews in the target 7-day window
  prevReviews: Review[];     // reviews in the prior 7-day window (may be empty)
  cardMetas: CardMeta[];
  periodStart: number;
  periodEnd: number;
  prevPeriodEnd?: number;
}): WeeklyStats {
  const { currentReviews, prevReviews, cardMetas, periodStart, periodEnd } = opts;
  const metaMap = buildMetaMap(cardMetas);

  const distinctCards = new Set(currentReviews.map(r => r.card_id));
  const grades = currentReviews.map(r => r.grade);
  const gradedCount = grades.filter(g => g !== 'other').length;

  // Tech rollup (weakest → strongest)
  const techRollup = computeTechRollup(currentReviews, metaMap);
  const byTech: TechStats[] = Array.from(techRollup.entries())
    .map(([path, { good, total }]) => ({
      path,
      accuracy: total > 0 ? good / total : 0,
      total,
      goodPlusEasy: good,
    }))
    .sort((a, b) => a.accuracy - b.accuracy); // weakest first

  // Prev week tech rollup for trend
  if (prevReviews.length > 0) {
    const prevTechRollup = computeTechRollup(prevReviews, metaMap);
    for (const t of byTech) {
      const prev = prevTechRollup.get(t.path);
      if (prev) {
        t.prevAccuracy = prev.total > 0 ? prev.good / prev.total : 0;
        const delta = t.accuracy - t.prevAccuracy;
        t.trend = delta > 0.03 ? 'improving' : delta < -0.03 ? 'declining' : 'stable';
      }
    }
  }

  // Concept rollup (weakest → strongest)
  const conceptRollup = computeConceptRollup(currentReviews, metaMap);
  const byConcept: ConceptStats[] = Array.from(conceptRollup.entries())
    .map(([concept, { good, total, techPaths }]) => ({
      concept,
      accuracy: total > 0 ? good / total : 0,
      total,
      goodPlusEasy: good,
      techPaths: Array.from(techPaths),
    }))
    .sort((a, b) => a.accuracy - b.accuracy); // weakest first

  const missed = computeMissed(currentReviews, metaMap);

  const volumeThisWeek = currentReviews.filter(r => isGraded(r.grade)).length;
  const volumePrevWeek = prevReviews.length > 0
    ? prevReviews.filter(r => isGraded(r.grade)).length
    : null;
  const volumeChange = volumePrevWeek != null && volumePrevWeek > 0
    ? ((volumeThisWeek - volumePrevWeek) / volumePrevWeek) * 100
    : null;

  const recommendation = buildRecommendation(byConcept, missed);

  return {
    weekLabel: isoWeekLabel(periodEnd),
    periodStart,
    periodEnd,
    totalCardsReviewed: distinctCards.size,
    totalReviews: currentReviews.length,
    gradedReviews: gradedCount,
    avgGrade: avgDisplayGrade(grades),
    byTech,
    byConcept,
    repeatedlyMissed: missed,
    volumeThisWeek,
    volumePrevWeek,
    volumeChange,
    recommendation,
  };
}

export function formatMarkdownReport(stats: WeeklyStats): string {
  const lines: string[] = [];
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const trend = (t?: string) =>
    t === 'improving' ? ' ↑' : t === 'declining' ? ' ↓' : '';

  lines.push('# WEEKLY STUDY REPORT');
  lines.push(`Week: ${stats.weekLabel}`);
  lines.push('');
  lines.push(
    `Cards reviewed: ${stats.totalCardsReviewed}    Reviews: ${stats.totalReviews}    ` +
    `Average grade: ${stats.avgGrade.toFixed(1)} / 5`
  );
  if (stats.volumeChange != null) {
    const sign = stats.volumeChange >= 0 ? '+' : '';
    lines.push(`Volume vs last week: ${sign}${stats.volumeChange.toFixed(0)}%`);
  }
  lines.push('');
  lines.push('## By technology (weakest → strongest)');
  if (stats.byTech.length === 0) {
    lines.push('  (no tech-path data)');
  } else {
    for (const t of [...stats.byTech].reverse().sort((a, b) => a.accuracy - b.accuracy)) {
      lines.push(`  ${t.path.padEnd(36)} — ${pct(t.accuracy).padStart(4)}${trend(t.trend)}  (${t.total} reviews)`);
    }
  }
  lines.push('');
  lines.push('## By concept (across all tech, weakest → strongest)');
  if (stats.byConcept.length === 0) {
    lines.push('  (no concept-tag data)');
  } else {
    for (const c of stats.byConcept) {
      lines.push(`  #${c.concept.padEnd(20)} — ${pct(c.accuracy).padStart(4)}  (${c.total} reviews, paths: ${c.techPaths.slice(0, 3).join(', ')})`);
    }
  }
  lines.push('');
  lines.push('## Repeatedly missed (≥2 "again" this week)');
  if (stats.repeatedlyMissed.length === 0) {
    lines.push('  None — great job!');
  } else {
    for (const m of stats.repeatedlyMissed.slice(0, 10)) {
      const tags = m.concepts.map(c => `#${c}`).join(' ') || '(no tags)';
      lines.push(`  [${m.card_id.slice(0, 8)}]  path: ${m.tech_path ?? '?'}  tags: ${tags}  missed ${m.againCount}×`);
    }
  }
  lines.push('');
  lines.push('## Recommendation');
  lines.push(`  ${stats.recommendation}`);
  lines.push('');

  return lines.join('\n');
}

export function formatJsonReport(stats: WeeklyStats): object {
  return {
    weekLabel: stats.weekLabel,
    periodStart: new Date(stats.periodStart).toISOString(),
    periodEnd: new Date(stats.periodEnd).toISOString(),
    summary: {
      totalCardsReviewed: stats.totalCardsReviewed,
      totalReviews: stats.totalReviews,
      gradedReviews: stats.gradedReviews,
      avgGrade: stats.avgGrade,
      volumeThisWeek: stats.volumeThisWeek,
      volumePrevWeek: stats.volumePrevWeek,
      volumeChangePercent: stats.volumeChange != null ? Math.round(stats.volumeChange) : null,
    },
    byTech: stats.byTech.map(t => ({
      path: t.path,
      accuracy: parseFloat(t.accuracy.toFixed(3)),
      total: t.total,
      goodPlusEasy: t.goodPlusEasy,
      prevAccuracy: t.prevAccuracy != null ? parseFloat(t.prevAccuracy.toFixed(3)) : null,
      trend: t.trend ?? null,
    })),
    byConcept: stats.byConcept.map(c => ({
      concept: c.concept,
      accuracy: parseFloat(c.accuracy.toFixed(3)),
      total: c.total,
      goodPlusEasy: c.goodPlusEasy,
      techPaths: c.techPaths,
    })),
    repeatedlyMissed: stats.repeatedlyMissed.map(m => ({
      card_id: m.card_id,
      tech_path: m.tech_path,
      concepts: m.concepts,
      againCount: m.againCount,
    })),
    recommendation: stats.recommendation,
  };
}
