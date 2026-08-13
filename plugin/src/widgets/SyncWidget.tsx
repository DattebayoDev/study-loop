/**
 * SyncWidget — right-sidebar panel.
 *
 * Mode 1 (pull): fetches pending cards from /pending, creates them in RemNote,
 *   POSTs each confirmed id back to /processed.
 * Mode 2 (push): reads all cards via plugin.card.getAll(), normalises review
 *   history since the stored cursor, POSTs to /reviews.
 *
 * VERIFIED SDK APIs ONLY — nothing is invented beyond the spec.
 * All API shapes confirmed against @remnote/plugin-sdk@0.0.46 types.
 *
 * LIMITATIONS (documented, not faked):
 *   • No per-review interval or ease — always null.
 *   • No background scheduler — auto-sync runs only while widget is mounted.
 *   • Tech path derived by walking getParentRem() up the Document chain; may be null.
 *   • review_id = `${card_id}:${date_ms}` — deduped client-side.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { renderWidget, usePlugin, useTrackerPlugin } from '@remnote/plugin-sdk';
import type { PluginRem, RNPlugin } from '@remnote/plugin-sdk';

// ── Types ─────────────────────────────────────────────────────────────────────

type Grade = 'again' | 'hard' | 'good' | 'easy' | 'other';

interface PendingCard {
  id: string;
  front: string;
  back: string;
  techSegments: string[];
  concepts: string[];
}

interface SyncStatus {
  phase: 'idle' | 'pulling' | 'pushing' | 'done' | 'error';
  cardsFound: number;
  cardsCreated: number;
  reviewsFound: number;
  errors: string[];
  lastSync: string | null;
}

// ── Grade mapping ─────────────────────────────────────────────────────────────

function mapScore(score: number): Grade {
  if (score === 0) return 'again';
  if (score === 0.5) return 'hard';
  if (score === 1) return 'good';
  if (score === 1.5) return 'easy';
  return 'other';
}

// ── Rich text helpers ─────────────────────────────────────────────────────────

/** Build a RichTextInterface from a plain string. */
async function rt(plugin: RNPlugin, text: string) {
  return await plugin.richText.text(text).value();
}

/** Convert a Rem's rich text to a plain string (async in the real SDK). */
async function remName(plugin: RNPlugin, rem: PluginRem): Promise<string> {
  if (!rem.text) return '';
  return await plugin.richText.toString(rem.text);
}

// ── Tech path resolution ──────────────────────────────────────────────────────

/**
 * Walk getParentRem() from a card's Rem up the tree, collecting Document names.
 * Returns a /-joined path or null.
 */
async function deriveTechPath(plugin: RNPlugin, rem: PluginRem): Promise<string | null> {
  const segments: string[] = [];
  let current: PluginRem | undefined = rem;

  for (let i = 0; i < 20; i++) {
    const parent: PluginRem | undefined = await current?.getParentRem();
    if (!parent) break;
    if (await parent.isDocument()) {
      const name = await remName(plugin, parent);
      if (name) segments.unshift(name);
    }
    current = parent;
  }

  return segments.length > 0 ? segments.join('/') : null;
}

/**
 * Find or create a Document Rem for one path segment.
 * - parentId === null: top-level segment — search globally by name.
 * - parentId !== null: scan the parent's children for a matching Document.
 * Never duplicates an existing segment.
 */
async function findOrCreateSegment(
  plugin: RNPlugin,
  segmentName: string,
  parentId: string | null
): Promise<PluginRem> {
  const nameRt = await rt(plugin, segmentName);

  if (parentId === null) {
    const found = await plugin.rem.findByName(nameRt, null);
    if (found) return found;
    const created = await plugin.rem.createSingleRemWithMarkdown(segmentName);
    if (!created) throw new Error(`Failed to create top-level rem: ${segmentName}`);
    await created.setIsDocument(true);
    return created;
  }

  // Nested: scan parent's children for an existing Document with this name
  const parentRem = await plugin.rem.findOne(parentId);
  if (!parentRem) throw new Error(`Parent rem not found: ${parentId}`);
  const children = await parentRem.getChildrenRem();
  for (const child of children) {
    const name = await remName(plugin, child);
    if (name === segmentName && (await child.isDocument())) return child;
  }

  // Not found — create as child of parentId
  const created = await plugin.rem.createSingleRemWithMarkdown(segmentName, parentId);
  if (!created) throw new Error(`Failed to create child rem: ${segmentName}`);
  await created.setIsDocument(true);
  return created;
}

/** Walk all segments, creating only the missing Document levels. */
async function resolveTechPath(plugin: RNPlugin, segments: string[]): Promise<PluginRem> {
  let currentId: string | null = null;
  let current: PluginRem | null = null;
  for (const segment of segments) {
    const found = await findOrCreateSegment(plugin, segment, currentId);
    currentId = found._id;
    current = found;
  }
  if (!current) throw new Error('Empty tech path segments');
  return current;
}

/** Find or create a top-level concept tag Rem (e.g. "resilience"). */
async function findOrCreateConceptTag(plugin: RNPlugin, conceptName: string): Promise<PluginRem> {
  const nameRt = await rt(plugin, conceptName);
  const found = await plugin.rem.findByName(nameRt, null);
  if (found) return found;
  const created = await plugin.rem.createRem();
  if (!created) throw new Error(`Failed to create concept tag: ${conceptName}`);
  await created.setText(await rt(plugin, conceptName));
  return created;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function fetchPending(baseUrl: string): Promise<PendingCard[]> {
  const res = await fetch(`${baseUrl}/pending`);
  if (!res.ok) throw new Error(`/pending returned ${res.status}`);
  const body = await res.json() as { cards: PendingCard[] };
  return body.cards;
}

async function postProcessed(baseUrl: string, id: string): Promise<void> {
  const res = await fetch(`${baseUrl}/processed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) throw new Error(`/processed returned ${res.status}`);
}

async function postReviews(baseUrl: string, payload: unknown): Promise<void> {
  const res = await fetch(`${baseUrl}/reviews`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`/reviews returned ${res.status}`);
}

// ── Mode 1: create cards ──────────────────────────────────────────────────────

async function runCreateCards(
  plugin: RNPlugin,
  baseUrl: string,
  onProgress: (msg: string) => void
): Promise<{ found: number; created: number; errors: string[] }> {
  const pending = await fetchPending(baseUrl);
  onProgress(`Found ${pending.length} pending card(s)`);

  let created = 0;
  const errors: string[] = [];

  for (const card of pending) {
    try {
      const parentDoc = await resolveTechPath(plugin, card.techSegments);

      const rem = await plugin.rem.createSingleRemWithMarkdown(card.front, parentDoc._id);
      if (!rem) throw new Error('createSingleRemWithMarkdown returned undefined');

      await rem.setBackText(await rt(plugin, card.back));
      await rem.setEnablePractice(true);

      for (const concept of card.concepts) {
        const tagRem = await findOrCreateConceptTag(plugin, concept);
        await rem.addTag(tagRem);
      }

      await postProcessed(baseUrl, card.id);
      created++;
      onProgress(`Created: ${card.front}`);
    } catch (err) {
      const msg = `[${card.front}] ${String(err)}`;
      errors.push(msg);
      onProgress(`Error: ${msg}`);
    }
  }

  return { found: pending.length, created, errors };
}

// ── Mode 2: capture reviews ───────────────────────────────────────────────────

async function runCaptureReviews(
  plugin: RNPlugin,
  baseUrl: string,
  userId: string,
  onProgress: (msg: string) => void
): Promise<{ found: number; errors: string[] }> {
  const cursorKey = 'reviewCursor';
  const cursor = await plugin.storage.getSynced<number>(cursorKey) ?? null;

  const allCards = await plugin.card.getAll();
  onProgress(`Scanning ${allCards.length} card(s) for new reviews`);

  const reviews: unknown[] = [];
  const cardMetas: unknown[] = [];

  for (const card of allCards) {
    const history = card.repetitionHistory ?? [];
    const newHistory = cursor != null
      ? history.filter(h => h.date > cursor)
      : history;

    if (newHistory.length === 0) continue;

    let techPath: string | null = null;
    try {
      const rem = await card.getRem();
      if (rem) techPath = await deriveTechPath(plugin, rem);
    } catch { /* best-effort */ }

    // Concepts are stored when cards are created (addTag). The SDK has no getTags() method,
    // so we emit an empty array here; the watcher merges with metadata stored at creation time.
    cardMetas.push({ card_id: card._id, tech_path: techPath, concepts: [] });

    for (const h of newHistory) {
      reviews.push({
        review_id: `${card._id}:${h.date}`,
        card_id: card._id,
        reviewed_at: new Date(h.date).toISOString(),
        grade: mapScore(h.score),
        rating: h.score,
        response_time_ms: h.responseTime ?? null,
        interval: null,
        ease: null,
      });
    }
  }

  if (reviews.length > 0) {
    await postReviews(baseUrl, {
      user_id: userId,
      synced_at: new Date().toISOString(),
      since: cursor,
      reviews,
      cards: cardMetas,
    });
    await plugin.storage.setSynced(cursorKey, Date.now());
  }

  onProgress(`Captured ${reviews.length} new review(s)`);
  return { found: reviews.length, errors: [] };
}

// ── React component ───────────────────────────────────────────────────────────

function SyncWidgetComponent() {
  const plugin = usePlugin();
  const [status, setStatus] = useState<SyncStatus>({
    phase: 'idle',
    cardsFound: 0,
    cardsCreated: 0,
    reviewsFound: 0,
    errors: [],
    lastSync: null,
  });
  const [log, setLog] = useState<string[]>([]);
  const isSyncing = useRef(false);

  // Watch for trigger from the command palette via session storage
  const syncTrigger = useTrackerPlugin(
    async (rp) => await rp.storage.getSession<number>('syncTrigger'),
    []
  );

  const getBaseUrl = useCallback(async (): Promise<string> => {
    const port = await plugin.settings.getSetting<number>('watcherPort') ?? 3748;
    return `http://localhost:${port}`;
  }, [plugin]);

  const runSync = useCallback(async (): Promise<void> => {
    if (isSyncing.current) return;
    isSyncing.current = true;
    const newLog: string[] = [];
    const progress = (msg: string) => {
      newLog.push(msg);
      setLog([...newLog]);
    };

    try {
      const baseUrl = await getBaseUrl();
      const userId = await plugin.settings.getSetting<string>('userId') ?? 'me';

      setStatus(s => ({ ...s, phase: 'pulling', errors: [] }));
      progress('── Mode 1: creating pending cards ──');
      const { found, created, errors: e1 } = await runCreateCards(plugin, baseUrl, progress);

      setStatus(s => ({ ...s, phase: 'pushing', cardsFound: found, cardsCreated: created }));
      progress('── Mode 2: capturing reviews ──');
      const { found: revFound, errors: e2 } = await runCaptureReviews(plugin, baseUrl, userId, progress);

      const allErrors = [...e1, ...e2];
      setStatus({
        phase: 'done',
        cardsFound: found,
        cardsCreated: created,
        reviewsFound: revFound,
        errors: allErrors,
        lastSync: new Date().toLocaleTimeString(),
      });
      progress(`✓ Done — cards: ${created}/${found}, reviews: ${revFound}`);

      if (allErrors.length > 0) {
        await plugin.app.toast(`Sync done with ${allErrors.length} error(s) — check the widget`);
      } else {
        await plugin.app.toast(`Sync done — ${created} card(s) created, ${revFound} review(s) captured`);
      }
    } catch (err) {
      const msg = String(err);
      progress(`Fatal: ${msg}`);
      setStatus(s => ({ ...s, phase: 'error', errors: [msg] }));
      await plugin.app.toast(`Sync failed: ${msg}`);
    } finally {
      isSyncing.current = false;
    }
  }, [plugin, getBaseUrl]);

  // Trigger from command palette
  useEffect(() => {
    if (syncTrigger) void runSync();
  }, [syncTrigger, runSync]);

  // Auto-sync interval
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    (async () => {
      const autoSync = await plugin.settings.getSetting<boolean>('autoSync') ?? true;
      const intervalMin = await plugin.settings.getSetting<number>('autoSyncIntervalMin') ?? 15;
      if (autoSync) {
        timer = setInterval(() => void runSync(), Math.max(1, intervalMin) * 60 * 1000);
      }
    })();
    return () => { if (timer) clearInterval(timer); };
  }, [plugin, runSync]);

  const phaseLabel: Record<SyncStatus['phase'], string> = {
    idle: 'Ready',
    pulling: 'Creating cards…',
    pushing: 'Capturing reviews…',
    done: 'Done',
    error: 'Error',
  };

  return (
    <div style={{ padding: '12px', fontFamily: 'monospace', fontSize: '12px' }}>
      <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>Study Loop</div>

      <button
        onClick={() => void runSync()}
        disabled={status.phase === 'pulling' || status.phase === 'pushing'}
        style={{ marginBottom: '8px', cursor: 'pointer', padding: '4px 12px' }}
      >
        {status.phase === 'idle' || status.phase === 'done' || status.phase === 'error'
          ? 'Sync Now'
          : '…syncing'}
      </button>

      <div>Status: <strong>{phaseLabel[status.phase]}</strong></div>
      {status.lastSync && <div>Last sync: {status.lastSync}</div>}
      <div>Cards found: {status.cardsFound} | Created: {status.cardsCreated}</div>
      <div>Reviews captured: {status.reviewsFound}</div>
      {status.errors.length > 0 && (
        <div style={{ color: 'red', marginTop: '4px' }}>
          {status.errors.length} error(s):
          <ul style={{ margin: '2px 0', paddingLeft: '16px' }}>
            {status.errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      {log.length > 0 && (
        <details style={{ marginTop: '8px' }}>
          <summary>Log ({log.length} lines)</summary>
          <pre style={{ maxHeight: '120px', overflow: 'auto', fontSize: '10px' }}>
            {log.join('\n')}
          </pre>
        </details>
      )}

      <div style={{ marginTop: '8px', color: '#888', fontSize: '10px' }}>
        Auto-sync: while sidebar is open only (no background scheduler).
        Use command palette "Study Loop: Sync Now" anytime.
      </div>
    </div>
  );
};

renderWidget(SyncWidgetComponent);

export { SyncWidgetComponent as SyncWidget };
