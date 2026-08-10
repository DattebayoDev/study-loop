/** A parsed line from cards/inbox.md. */
export interface Card {
  /** Stable id = sha1(front). Re-processing the same front never duplicates. */
  id: string;
  front: string;
  back: string;
  /** Tech folder path, e.g. "AWS/Database/Aurora". Each / segment is a RemNote Document. */
  techPath: string;
  /** Ordered, slash-split tech path segments. */
  techSegments: string[];
  /** Concept tag names WITHOUT the leading '#', e.g. ["resilience","consistency"]. */
  concepts: string[];
  /** The exact raw line as authored (used for archive + safe removal from inbox). */
  raw: string;
}

/** QueueInteractionScore buckets we recognise. Everything else → "other". */
export type Grade = 'again' | 'hard' | 'good' | 'easy' | 'other';

/** A normalized review, as emitted by the plugin and persisted by the watcher. */
export interface Review {
  /** `${card_id}:${date_ms}` — dedupe key. */
  review_id: string;
  card_id: string;
  /** ISO timestamp. */
  reviewed_at: string;
  grade: Grade;
  /** Raw QueueInteractionScore value. */
  rating: number;
  response_time_ms: number | null;
  interval: null; // never available from the SDK
  ease: null;     // never available from the SDK
}

/** Per-card metadata emitted alongside reviews so reports can slice both ways. */
export interface CardMeta {
  card_id: string;
  /** /-joined Document ancestry, e.g. "AWS/Database/Aurora". May be null. */
  tech_path: string | null;
  /** Concept tag names (no '#'). */
  concepts: string[];
}

/** The full payload the plugin POSTs to /reviews. */
export interface ReviewPayload {
  user_id: string;
  synced_at: string;
  since: number | null;
  reviews: Review[];
  cards: CardMeta[];
}

export interface TechStats {
  path: string;
  accuracy: number; // 0–1
  total: number;
  goodPlusEasy: number;
  prevAccuracy?: number;
  trend?: 'improving' | 'declining' | 'stable';
}

export interface ConceptStats {
  concept: string; // e.g. "resilience"
  accuracy: number; // 0–1
  total: number;
  goodPlusEasy: number;
  techPaths: string[];
}

export interface MissedCard {
  card_id: string;
  tech_path: string | null;
  concepts: string[];
  againCount: number;
}

export interface WeeklyStats {
  weekLabel: string; // "YYYY-WW"
  periodStart: number; // ms
  periodEnd: number;   // ms
  totalCardsReviewed: number; // distinct card_ids
  totalReviews: number;       // includes "other"
  gradedReviews: number;      // excludes "other"
  avgGrade: number;   // 0–5 scale
  byTech: TechStats[];        // weakest→strongest
  byConcept: ConceptStats[];  // weakest→strongest
  repeatedlyMissed: MissedCard[];
  volumeThisWeek: number;
  volumePrevWeek: number | null;
  volumeChange: number | null; // % change
  recommendation: string;
}

export interface ReviewStore {
  reviews: Review[];
  card_metas: Record<string, CardMeta>;
}

export interface WatcherConfig {
  repoRoot: string;
  port: number;
  gitAutoPull: boolean;
  gitPullIntervalMs: number;
}
