import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  readProcessedIds,
  recordProcessedId,
  appendToArchive,
  removeLineFromInbox,
  confirmCard,
} from '../src/inbox-lifecycle';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'study-loop-test-'));
}

describe('readProcessedIds', () => {
  test('returns empty set when file does not exist', () => {
    const dir = tmpDir();
    const ids = readProcessedIds(path.join(dir, 'processed.json'));
    expect(ids.size).toBe(0);
  });

  test('reads ids from existing file', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'processed.json');
    fs.writeFileSync(file, JSON.stringify({ ids: ['abc', 'def'] }), 'utf8');
    const ids = readProcessedIds(file);
    expect(ids.has('abc')).toBe(true);
    expect(ids.has('def')).toBe(true);
  });
});

describe('recordProcessedId', () => {
  test('creates file if it does not exist', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'processed.json');
    recordProcessedId(file, 'id1');
    const ids = readProcessedIds(file);
    expect(ids.has('id1')).toBe(true);
  });

  test('appends to existing ids', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'processed.json');
    recordProcessedId(file, 'id1');
    recordProcessedId(file, 'id2');
    const ids = readProcessedIds(file);
    expect(ids.has('id1')).toBe(true);
    expect(ids.has('id2')).toBe(true);
  });

  test('is idempotent — recording the same id twice is safe', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'processed.json');
    recordProcessedId(file, 'id1');
    recordProcessedId(file, 'id1');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(raw.ids.filter((x: string) => x === 'id1')).toHaveLength(1);
  });
});

describe('appendToArchive', () => {
  test('creates file and appends line', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'archive.md');
    appendToArchive(file, 'front | back | AWS/Foo | #bar');
    expect(fs.readFileSync(file, 'utf8')).toContain('front | back | AWS/Foo | #bar');
  });

  test('appends multiple lines', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'archive.md');
    appendToArchive(file, 'line1');
    appendToArchive(file, 'line2');
    const content = fs.readFileSync(file, 'utf8');
    expect(content).toContain('line1');
    expect(content).toContain('line2');
  });
});

describe('removeLineFromInbox', () => {
  test('removes the matching line', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'inbox.md');
    fs.writeFileSync(file, 'line1\nline2\nline3\n', 'utf8');
    removeLineFromInbox(file, 'line2');
    const content = fs.readFileSync(file, 'utf8');
    expect(content).not.toContain('line2');
    expect(content).toContain('line1');
    expect(content).toContain('line3');
  });

  test('removes only the first occurrence', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'inbox.md');
    fs.writeFileSync(file, 'line1\nline1\nline2\n', 'utf8');
    removeLineFromInbox(file, 'line1');
    const content = fs.readFileSync(file, 'utf8');
    expect(content.split('\n').filter(l => l.trimEnd() === 'line1')).toHaveLength(1);
  });
});

describe('confirmCard — safe atomic lifecycle', () => {
  function makeDir() {
    const dir = tmpDir();
    const inboxFile = path.join(dir, 'inbox.md');
    const archiveFile = path.join(dir, 'archive.md');
    const stateFile = path.join(dir, 'processed.json');
    const line = 'Aurora failover | circuit breaker | AWS/Database/Aurora | #resilience';
    fs.writeFileSync(inboxFile, `${line}\nother card | back | X/Y\n`, 'utf8');
    return { dir, inboxFile, archiveFile, stateFile, line };
  }

  test('archives the line, records id, removes from inbox', () => {
    const { inboxFile, archiveFile, stateFile, line } = makeDir();
    const id = 'testid1';
    confirmCard({ inboxFile, archiveFile, stateFile, id, rawLine: line });
    expect(fs.readFileSync(archiveFile, 'utf8')).toContain(line);
    expect(readProcessedIds(stateFile).has(id)).toBe(true);
    expect(fs.readFileSync(inboxFile, 'utf8')).not.toContain(line);
  });

  test('other cards in inbox are untouched', () => {
    const { inboxFile, archiveFile, stateFile, line } = makeDir();
    confirmCard({ inboxFile, archiveFile, stateFile, id: 'id1', rawLine: line });
    expect(fs.readFileSync(inboxFile, 'utf8')).toContain('other card | back | X/Y');
  });

  test('crash safety: if id already in processed, re-running confirmCard is safe', () => {
    const { inboxFile, archiveFile, stateFile, line } = makeDir();
    // Simulate a crash mid-run: id is recorded but line was not removed yet
    recordProcessedId(stateFile, 'id-already');
    // Re-running confirm for the same id should not throw and processes cleanly
    expect(() =>
      confirmCard({ inboxFile, archiveFile, stateFile, id: 'id-already', rawLine: line })
    ).not.toThrow();
  });

  test('inbox empties only when all cards are confirmed', () => {
    const { inboxFile, archiveFile, stateFile, line } = makeDir();
    const otherLine = 'other card | back | X/Y';
    confirmCard({ inboxFile, archiveFile, stateFile, id: 'id1', rawLine: line });
    confirmCard({ inboxFile, archiveFile, stateFile, id: 'id2', rawLine: otherLine });
    const remaining = fs.readFileSync(inboxFile, 'utf8').trim().split('\n').filter(Boolean);
    expect(remaining).toHaveLength(0);
  });
});
