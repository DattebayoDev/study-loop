import * as fs from 'fs';
import * as path from 'path';

interface ProcessedStore {
  ids: string[];
}

function readProcessedStore(stateFile: string): ProcessedStore {
  try {
    const raw = fs.readFileSync(stateFile, 'utf8');
    const parsed = JSON.parse(raw) as ProcessedStore;
    return parsed;
  } catch {
    return { ids: [] };
  }
}

export function readProcessedIds(stateFile: string): Set<string> {
  return new Set(readProcessedStore(stateFile).ids);
}

/** Atomically append id to processed.json. */
export function recordProcessedId(stateFile: string, id: string): void {
  const store = readProcessedStore(stateFile);
  if (store.ids.includes(id)) return;
  store.ids.push(id);
  const tmp = stateFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmp, stateFile);
}

/** Append a raw inbox line to the archive file. */
export function appendToArchive(archiveFile: string, rawLine: string): void {
  const line = rawLine.endsWith('\n') ? rawLine : rawLine + '\n';
  fs.appendFileSync(archiveFile, line, 'utf8');
}

/**
 * Remove exactly one matching raw line from the inbox file.
 * Safe: operates on the current file content; other lines are untouched.
 */
export function removeLineFromInbox(inboxFile: string, rawLine: string): void {
  const content = fs.readFileSync(inboxFile, 'utf8');
  const lines = content.split('\n');
  const target = rawLine.trimEnd();
  let removed = false;
  const kept: string[] = [];

  for (const line of lines) {
    if (!removed && line.trimEnd() === target) {
      removed = true; // remove only the first occurrence
    } else {
      kept.push(line);
    }
  }

  const tmp = inboxFile + '.tmp';
  fs.writeFileSync(tmp, kept.join('\n'), 'utf8');
  fs.renameSync(tmp, inboxFile);
}

/**
 * Confirm a card was created in RemNote. Safe ordering:
 *   1. Append to archive (durable record)
 *   2. Record id in processed.json (dedup key)
 *   3. Remove from inbox (cleanup)
 *
 * A crash between steps leaves the id in the archive and/or processed.json,
 * so the next run will skip it via the processedIds set and the inbox line
 * can be cleaned manually or will be skipped harmlessly.
 */
export function confirmCard(opts: {
  inboxFile: string;
  archiveFile: string;
  stateFile: string;
  id: string;
  rawLine: string;
}): void {
  appendToArchive(opts.archiveFile, opts.rawLine);
  recordProcessedId(opts.stateFile, opts.id);
  removeLineFromInbox(opts.inboxFile, opts.rawLine);
}
