/**
 * scripts/weekly-report.ts — compute and write the weekly study report.
 *
 * Usage:
 *   npx tsx scripts/weekly-report.ts            # this week
 *   npx tsx scripts/weekly-report.ts --push     # also git commit + push reports/
 *
 * Launchd example (macOS, runs every Monday at 07:00):
 *   See README.md for the plist snippet.
 *
 * Cron example:
 *   0 7 * * 1 cd /path/to/study-loop && npx tsx scripts/weekly-report.ts --push >> /tmp/study-loop-report.log 2>&1
 */

import * as fs from 'fs';
import * as path from 'path';
import { simpleGit } from 'simple-git';
import { JsonReviewStore } from '../src/review-store';
import { computeWeeklyStats, formatMarkdownReport, formatJsonReport, isoWeekLabel } from '../src/weekly-report-engine';

const REPO_ROOT = path.resolve(__dirname, '..');
const REVIEWS_FILE = path.join(REPO_ROOT, '.state', 'reviews.json');
const REPORTS_DIR = path.join(REPO_ROOT, 'reports');
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

async function main(): Promise<void> {
  const shouldPush = process.argv.includes('--push');

  const store = new JsonReviewStore(REVIEWS_FILE);
  const now = Date.now();
  const periodEnd = now;
  const periodStart = now - WEEK_MS;
  const prevStart = periodStart - WEEK_MS;

  const currentReviews = store.getReviewsInRange(periodStart, periodEnd);
  const prevReviews = store.getReviewsInRange(prevStart, periodStart);
  const cardMetas = store.getAllCardMetas();

  const stats = computeWeeklyStats({
    currentReviews,
    prevReviews,
    cardMetas,
    periodStart,
    periodEnd,
  });

  const weekLabel = isoWeekLabel(periodEnd);
  const mdFile = path.join(REPORTS_DIR, `week-${weekLabel}.md`);
  const jsonFile = path.join(REPORTS_DIR, `week-${weekLabel}.json`);

  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(mdFile, formatMarkdownReport(stats), 'utf8');
  fs.writeFileSync(jsonFile, JSON.stringify(formatJsonReport(stats), null, 2), 'utf8');

  console.log(`Report written: ${mdFile}`);
  console.log(`Report written: ${jsonFile}`);
  console.log(`Cards reviewed: ${stats.totalCardsReviewed}  Reviews: ${stats.totalReviews}  Avg grade: ${stats.avgGrade.toFixed(1)}/5`);

  if (shouldPush) {
    const git = simpleGit(REPO_ROOT);
    try {
      await git.add([mdFile, jsonFile]);
      await git.commit(`chore: weekly report ${weekLabel}`);
      await git.push();
      console.log('[git] pushed reports/');
    } catch (err) {
      console.warn('[git] push failed (no remote configured?):', err);
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
