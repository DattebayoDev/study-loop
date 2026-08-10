import * as fs from 'fs';
import * as path from 'path';
import { Review, CardMeta, ReviewStore } from './types';

function readStore(storeFile: string): ReviewStore {
  try {
    const raw = fs.readFileSync(storeFile, 'utf8');
    return JSON.parse(raw) as ReviewStore;
  } catch {
    return { reviews: [], card_metas: {} };
  }
}

function writeStore(storeFile: string, store: ReviewStore): void {
  const tmp = storeFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmp, storeFile);
}

export class JsonReviewStore {
  constructor(private readonly storeFile: string) {}

  /** Upsert reviews — deduplicated by review_id. */
  insertReviews(reviews: Review[]): void {
    const store = readStore(this.storeFile);
    const existing = new Map(store.reviews.map(r => [r.review_id, r]));
    for (const r of reviews) {
      existing.set(r.review_id, r);
    }
    store.reviews = Array.from(existing.values());
    writeStore(this.storeFile, store);
  }

  /** Upsert card metadata — keyed by card_id. */
  upsertCardMetas(metas: CardMeta[]): void {
    const store = readStore(this.storeFile);
    for (const m of metas) {
      store.card_metas[m.card_id] = m;
    }
    writeStore(this.storeFile, store);
  }

  /** All reviews within a time range (inclusive). */
  getReviewsInRange(fromMs: number, toMs: number): Review[] {
    const store = readStore(this.storeFile);
    return store.reviews.filter(r => {
      const t = new Date(r.reviewed_at).getTime();
      return t >= fromMs && t <= toMs;
    });
  }

  getCardMeta(cardId: string): CardMeta | null {
    return readStore(this.storeFile).card_metas[cardId] ?? null;
  }

  getAllCardMetas(): CardMeta[] {
    return Object.values(readStore(this.storeFile).card_metas);
  }

  getAllReviews(): Review[] {
    return readStore(this.storeFile).reviews;
  }
}
