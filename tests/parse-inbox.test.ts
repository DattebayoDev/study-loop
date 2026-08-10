import { parseInboxLine, parseInboxFile, computeCardId } from '../src/parse-inbox';

describe('computeCardId', () => {
  test('returns a 40-char hex sha1', () => {
    const id = computeCardId('Aurora failover');
    expect(id).toMatch(/^[0-9a-f]{40}$/);
  });

  test('is stable across calls', () => {
    expect(computeCardId('Virtual threads')).toBe(computeCardId('Virtual threads'));
  });

  test('is different for different fronts', () => {
    expect(computeCardId('A')).not.toBe(computeCardId('B'));
  });
});

describe('parseInboxLine', () => {
  test('parses a full 4-field line', () => {
    const card = parseInboxLine('Aurora failover | stops retry storms | AWS/Database/Aurora | #resilience');
    expect(card).not.toBeNull();
    expect(card!.front).toBe('Aurora failover');
    expect(card!.back).toBe('stops retry storms');
    expect(card!.techPath).toBe('AWS/Database/Aurora');
    expect(card!.techSegments).toEqual(['AWS', 'Database', 'Aurora']);
    expect(card!.concepts).toEqual(['resilience']);
  });

  test('parses multiple concepts', () => {
    const card = parseInboxLine('Idempotent producer | dedupes | Kafka/Delivery | #resilience #consistency');
    expect(card!.concepts).toEqual(['resilience', 'consistency']);
  });

  test('parses a line with empty 4th field (no concepts)', () => {
    const card = parseInboxLine('ECS task | container unit | AWS/Compute/ECS |');
    expect(card!.concepts).toEqual([]);
  });

  test('parses a line with no 4th field at all', () => {
    const card = parseInboxLine('ECS task | container unit | AWS/Compute/ECS');
    expect(card!.concepts).toEqual([]);
  });

  test('returns null for blank line', () => {
    expect(parseInboxLine('')).toBeNull();
    expect(parseInboxLine('   ')).toBeNull();
  });

  test('returns null for comment line', () => {
    expect(parseInboxLine('# This is a comment')).toBeNull();
  });

  test('returns null for line with fewer than 3 fields', () => {
    expect(parseInboxLine('front | back')).toBeNull();
  });

  test('returns null if front or back is empty', () => {
    expect(parseInboxLine(' | back | AWS/Compute')).toBeNull();
    expect(parseInboxLine('front |  | AWS/Compute')).toBeNull();
  });

  test('normalises concept tags to lowercase', () => {
    const card = parseInboxLine('X | Y | A/B | #Resilience #CONSISTENCY');
    expect(card!.concepts).toEqual(['resilience', 'consistency']);
  });

  test('normalises multiple slashes in tech path', () => {
    const card = parseInboxLine('X | Y | AWS / Database / Aurora');
    expect(card!.techSegments).toEqual(['AWS', 'Database', 'Aurora']);
    expect(card!.techPath).toBe('AWS/Database/Aurora');
  });

  test('assigns the id as sha1(front)', () => {
    const card = parseInboxLine('Aurora failover | back | AWS/Database/Aurora');
    expect(card!.id).toBe(computeCardId('Aurora failover'));
  });

  test('preserves the raw line', () => {
    const raw = 'Aurora failover | back | AWS/Database/Aurora | #resilience';
    const card = parseInboxLine(raw);
    expect(card!.raw).toBe(raw);
  });
});

describe('parseInboxFile', () => {
  const sample = `
# comment line — should be skipped
Aurora failover | stops retry storms with a circuit breaker | AWS/Database/Aurora | #resilience
Idempotent producer | dedupes on retry | Kafka/Delivery | #resilience #consistency

Virtual threads | cheap blocking | Java/Concurrency | #performance
ECS task | container unit | AWS/Compute/ECS |
`.trim();

  test('parses all non-comment non-blank lines', () => {
    const cards = parseInboxFile(sample);
    expect(cards).toHaveLength(4);
  });

  test('deduplicates by id within the file', () => {
    const dup = `Aurora failover | back | AWS/Database/Aurora\nAurora failover | back | AWS/Database/Aurora`;
    const cards = parseInboxFile(dup);
    expect(cards).toHaveLength(1);
  });

  test('filters out cards already in processedIds', () => {
    const cards = parseInboxFile(sample);
    const auroraId = computeCardId('Aurora failover');
    const filtered = parseInboxFile(sample, new Set([auroraId]));
    expect(filtered).toHaveLength(3);
    expect(filtered.find(c => c.id === auroraId)).toBeUndefined();
  });

  test('returns empty array for empty content', () => {
    expect(parseInboxFile('')).toEqual([]);
  });

  test('returns empty when all cards already processed', () => {
    const cards = parseInboxFile(sample);
    const allIds = new Set(cards.map(c => c.id));
    expect(parseInboxFile(sample, allIds)).toEqual([]);
  });
});
