/**
 * scripts/watch.ts — mailbox bridge between cards/inbox.md and the RemNote plugin.
 *
 * Endpoints:
 *   GET  /pending         → returns unprocessed cards as JSON
 *   POST /processed       → body: {id: string} — mark one card as processed (archives + removes from inbox)
 *   POST /reviews         → body: ReviewPayload — store review data
 *
 * Runs git pull every GIT_PULL_INTERVAL_MS (default 5 min) so cards pushed from elsewhere arrive.
 * Usage:  npx tsx scripts/watch.ts
 *         PORT=3748 npx tsx scripts/watch.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import express, { Request, Response } from 'express';
import cors from 'cors';
import chokidar from 'chokidar';
import { simpleGit } from 'simple-git';
import { z } from 'zod';
import { parseInboxFile } from '../src/parse-inbox';
import { readProcessedIds, confirmCard } from '../src/inbox-lifecycle';
import { JsonReviewStore } from '../src/review-store';
import { ReviewPayload, WatcherConfig, Card } from '../src/types';

// ── Paths ────────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..');
const INBOX_FILE = path.join(REPO_ROOT, 'cards', 'inbox.md');
const ARCHIVE_FILE = path.join(REPO_ROOT, 'cards', 'archive.md');
const PROCESSED_FILE = path.join(REPO_ROOT, '.state', 'processed.json');
const REVIEWS_FILE = path.join(REPO_ROOT, '.state', 'reviews.json');
const PORT = parseInt(process.env.PORT ?? '3748', 10);
const GIT_PULL_INTERVAL_MS = parseInt(process.env.GIT_PULL_INTERVAL_MS ?? String(5 * 60 * 1000), 10);

// ── Zod schemas ───────────────────────────────────────────────────────────────

const ProcessedBody = z.object({ id: z.string().min(1) });

const ReviewSchema = z.object({
  review_id: z.string(),
  card_id: z.string(),
  reviewed_at: z.string(),
  grade: z.enum(['again', 'hard', 'good', 'easy', 'other']),
  rating: z.number(),
  response_time_ms: z.number().nullable(),
  interval: z.null(),
  ease: z.null(),
});

const CardMetaSchema = z.object({
  card_id: z.string(),
  tech_path: z.string().nullable(),
  concepts: z.array(z.string()),
});

const ReviewPayloadSchema = z.object({
  user_id: z.string(),
  synced_at: z.string(),
  since: z.number().nullable(),
  reviews: z.array(ReviewSchema),
  cards: z.array(CardMetaSchema),
});

// ── In-memory pending cache (invalidated on file change) ─────────────────────

let pendingCache: Card[] | null = null;

function getPendingCards(): Card[] {
  if (pendingCache) return pendingCache;
  let content = '';
  try { content = fs.readFileSync(INBOX_FILE, 'utf8'); } catch { /* no inbox yet */ }
  const processedIds = readProcessedIds(PROCESSED_FILE);
  pendingCache = parseInboxFile(content, processedIds);
  return pendingCache;
}

function invalidateCache(): void {
  pendingCache = null;
}

// ── App factory (exported for tests) ─────────────────────────────────────────

export function createApp(config: WatcherConfig): express.Application {
  const {
    repoRoot,
    port: _port,
  } = config;

  const inboxFile = path.join(repoRoot, 'cards', 'inbox.md');
  const archiveFile = path.join(repoRoot, 'cards', 'archive.md');
  const processedFile = path.join(repoRoot, '.state', 'processed.json');
  const reviewsFile = path.join(repoRoot, '.state', 'reviews.json');
  const store = new JsonReviewStore(reviewsFile);

  const app = express();
  app.use(cors({ origin: '*' }));
  app.use(express.json());

  // GET /pending — returns cards from inbox.md not yet in processed.json
  app.get('/pending', (_req: Request, res: Response) => {
    try {
      let content = '';
      try { content = fs.readFileSync(inboxFile, 'utf8'); } catch { /* no file */ }
      const processedIds = readProcessedIds(processedFile);
      const cards = parseInboxFile(content, processedIds);
      res.json({ cards });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /processed — confirm one card was created in RemNote
  app.post('/processed', (req: Request, res: Response) => {
    const parsed = ProcessedBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { id } = parsed.data;
    try {
      // Find the raw line for this id so we can archive + remove it
      let content = '';
      try { content = fs.readFileSync(inboxFile, 'utf8'); } catch { /* no file */ }
      const processedIds = readProcessedIds(processedFile);
      const allCards = parseInboxFile(content, new Set()); // parse without filter
      const card = allCards.find(c => c.id === id);

      if (!card) {
        // Already processed or not found — record id idempotently
        const { recordProcessedId } = require('../src/inbox-lifecycle') as typeof import('../src/inbox-lifecycle');
        recordProcessedId(processedFile, id);
        res.json({ ok: true, note: 'id not found in inbox, recorded anyway' });
        return;
      }

      if (processedIds.has(id)) {
        res.json({ ok: true, note: 'already processed' });
        return;
      }

      confirmCard({
        inboxFile,
        archiveFile,
        stateFile: processedFile,
        id,
        rawLine: card.raw,
      });

      invalidateCache();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /reviews — ingest review payload from the plugin
  app.post('/reviews', (req: Request, res: Response) => {
    const parsed = ReviewPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const payload = parsed.data as ReviewPayload;
    try {
      store.insertReviews(payload.reviews);
      store.upsertCardMetas(payload.cards);
      res.json({ ok: true, reviewsStored: payload.reviews.length, metasStored: payload.cards.length });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Health check
  app.get('/health', (_req, res) => res.json({ ok: true }));

  return app;
}

// ── Main (only runs when invoked directly) ────────────────────────────────────

async function main(): Promise<void> {
  const config: WatcherConfig = {
    repoRoot: REPO_ROOT,
    port: PORT,
    gitAutoPull: true,
    gitPullIntervalMs: GIT_PULL_INTERVAL_MS,
  };

  const app = createApp(config);
  const store = new JsonReviewStore(REVIEWS_FILE);
  const git = simpleGit(REPO_ROOT);

  // Watch inbox for changes → invalidate cache
  chokidar.watch(INBOX_FILE, { ignoreInitial: true }).on('all', () => {
    invalidateCache();
    console.log('[watcher] inbox changed, cache invalidated');
  });

  // Periodic git pull
  async function gitPull(): Promise<void> {
    try {
      await git.pull();
      invalidateCache();
      console.log('[git] pulled latest');
    } catch (err) {
      console.warn('[git] pull failed:', err);
    }
  }

  if (config.gitAutoPull) {
    await gitPull();
    setInterval(gitPull, config.gitPullIntervalMs);
  }

  app.listen(PORT, () => {
    console.log(`[watcher] listening on http://localhost:${PORT}`);
    console.log(`[watcher] inbox: ${INBOX_FILE}`);
    console.log(`[watcher] reviews store: ${REVIEWS_FILE}`);
    console.log(`[watcher] git pull every ${GIT_PULL_INTERVAL_MS / 1000}s`);
  });
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}
