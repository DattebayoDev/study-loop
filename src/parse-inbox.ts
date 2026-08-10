import * as crypto from 'crypto';
import { Card } from './types';

/** sha1 of the card front, hex-encoded. Stable forever — never re-derived from anything mutable. */
export function computeCardId(front: string): string {
  return crypto.createHash('sha1').update(front, 'utf8').digest('hex');
}

/**
 * Parse one pipe-delimited inbox line.
 * Format: front | back | tech/path | #concept #concept
 * Returns null for blank lines or comment-only lines.
 */
export function parseInboxLine(line: string): Card | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const parts = trimmed.split('|');
  if (parts.length < 3) return null;

  const front = parts[0].trim();
  const back = parts[1].trim();
  const techPath = parts[2].trim();

  if (!front || !back || !techPath) return null;

  const techSegments = techPath.split('/').map(s => s.trim()).filter(Boolean);
  if (techSegments.length === 0) return null;

  const rawConceptField = parts[3]?.trim() ?? '';
  const concepts = rawConceptField
    .split(/\s+/)
    .filter(t => t.startsWith('#') && t.length > 1)
    .map(t => t.slice(1).toLowerCase()); // strip '#', normalise case

  return {
    id: computeCardId(front),
    front,
    back,
    techPath: techSegments.join('/'),
    techSegments,
    concepts,
    raw: line,
  };
}

/**
 * Parse the full inbox file content into cards.
 * Skips blank lines and comment-only lines.
 * Deduplicates by card id when processedIds is provided — already-created cards are filtered out.
 */
export function parseInboxFile(
  content: string,
  processedIds: ReadonlySet<string> = new Set()
): Card[] {
  const cards: Card[] = [];
  const seenIds = new Set<string>();

  for (const line of content.split('\n')) {
    const card = parseInboxLine(line);
    if (!card) continue;
    if (seenIds.has(card.id)) continue; // dedupe within the file
    seenIds.add(card.id);
    if (processedIds.has(card.id)) continue; // already created in RemNote
    cards.push(card);
  }

  return cards;
}
