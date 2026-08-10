import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import request from 'supertest';
import { createApp } from '../scripts/watch';
import { WatcherConfig } from '../src/types';
import { computeCardId } from '../src/parse-inbox';

function makeTestRepo(): { dir: string; config: WatcherConfig } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'study-loop-watcher-'));
  fs.mkdirSync(path.join(dir, 'cards'));
  fs.mkdirSync(path.join(dir, '.state'));
  const config: WatcherConfig = {
    repoRoot: dir,
    port: 0, // unused in tests
    gitAutoPull: false,
    gitPullIntervalMs: 999999,
  };
  return { dir, config };
}

const SAMPLE_INBOX = [
  'Aurora failover | circuit breaker | AWS/Database/Aurora | #resilience',
  'Idempotent producer | dedupes | Kafka/Delivery | #resilience #consistency',
].join('\n');

describe('GET /pending', () => {
  test('returns all inbox cards when none are processed', async () => {
    const { dir, config } = makeTestRepo();
    fs.writeFileSync(path.join(dir, 'cards', 'inbox.md'), SAMPLE_INBOX, 'utf8');
    fs.writeFileSync(path.join(dir, '.state', 'processed.json'), JSON.stringify({ ids: [] }), 'utf8');

    const app = createApp(config);
    const res = await request(app).get('/pending');
    expect(res.status).toBe(200);
    expect(res.body.cards).toHaveLength(2);
  });

  test('excludes already-processed cards', async () => {
    const { dir, config } = makeTestRepo();
    fs.writeFileSync(path.join(dir, 'cards', 'inbox.md'), SAMPLE_INBOX, 'utf8');
    const auroraId = computeCardId('Aurora failover');
    fs.writeFileSync(
      path.join(dir, '.state', 'processed.json'),
      JSON.stringify({ ids: [auroraId] }),
      'utf8'
    );

    const app = createApp(config);
    const res = await request(app).get('/pending');
    expect(res.status).toBe(200);
    expect(res.body.cards).toHaveLength(1);
    expect(res.body.cards[0].front).toBe('Idempotent producer');
  });

  test('returns empty when inbox does not exist', async () => {
    const { config } = makeTestRepo();
    const app = createApp(config);
    const res = await request(app).get('/pending');
    expect(res.status).toBe(200);
    expect(res.body.cards).toHaveLength(0);
  });
});

describe('POST /processed', () => {
  test('marks a card as processed — archives and removes from inbox', async () => {
    const { dir, config } = makeTestRepo();
    const line = 'Aurora failover | circuit breaker | AWS/Database/Aurora | #resilience';
    fs.writeFileSync(path.join(dir, 'cards', 'inbox.md'), `${line}\nother card | b | X/Y\n`, 'utf8');
    fs.writeFileSync(path.join(dir, '.state', 'processed.json'), JSON.stringify({ ids: [] }), 'utf8');

    const id = computeCardId('Aurora failover');
    const app = createApp(config);
    const res = await request(app).post('/processed').send({ id });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const inbox = fs.readFileSync(path.join(dir, 'cards', 'inbox.md'), 'utf8');
    expect(inbox).not.toContain('Aurora failover');
    expect(inbox).toContain('other card');

    const archive = fs.readFileSync(path.join(dir, 'cards', 'archive.md'), 'utf8');
    expect(archive).toContain('Aurora failover');
  });

  test('returns 400 for missing id', async () => {
    const { config } = makeTestRepo();
    const app = createApp(config);
    const res = await request(app).post('/processed').send({});
    expect(res.status).toBe(400);
  });

  test('is idempotent — posting the same id twice is safe', async () => {
    const { dir, config } = makeTestRepo();
    const line = 'Aurora failover | circuit breaker | AWS/Database/Aurora';
    fs.writeFileSync(path.join(dir, 'cards', 'inbox.md'), `${line}\n`, 'utf8');
    fs.writeFileSync(path.join(dir, '.state', 'processed.json'), JSON.stringify({ ids: [] }), 'utf8');

    const id = computeCardId('Aurora failover');
    const app = createApp(config);
    await request(app).post('/processed').send({ id });
    const res2 = await request(app).post('/processed').send({ id });
    expect(res2.status).toBe(200);
  });
});

describe('POST /reviews', () => {
  test('stores valid review payload', async () => {
    const { dir, config } = makeTestRepo();
    const app = createApp(config);

    const payload = {
      user_id: 'me',
      synced_at: new Date().toISOString(),
      since: null,
      reviews: [{
        review_id: 'card1:1700000000000',
        card_id: 'card1',
        reviewed_at: new Date().toISOString(),
        grade: 'good',
        rating: 1,
        response_time_ms: 1234,
        interval: null,
        ease: null,
      }],
      cards: [{
        card_id: 'card1',
        tech_path: 'AWS/Database/Aurora',
        concepts: ['resilience'],
      }],
    };

    const res = await request(app).post('/reviews').send(payload);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.reviewsStored).toBe(1);
    expect(res.body.metasStored).toBe(1);

    // Verify data was written to disk
    const storeFile = path.join(dir, '.state', 'reviews.json');
    const store = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
    expect(store.reviews).toHaveLength(1);
    expect(store.card_metas['card1'].tech_path).toBe('AWS/Database/Aurora');
  });

  test('deduplicates reviews by review_id', async () => {
    const { dir, config } = makeTestRepo();
    const app = createApp(config);

    const review = {
      review_id: 'card1:1700000000000',
      card_id: 'card1',
      reviewed_at: new Date().toISOString(),
      grade: 'good',
      rating: 1,
      response_time_ms: null,
      interval: null,
      ease: null,
    };

    await request(app).post('/reviews').send({ user_id: 'me', synced_at: new Date().toISOString(), since: null, reviews: [review], cards: [] });
    await request(app).post('/reviews').send({ user_id: 'me', synced_at: new Date().toISOString(), since: null, reviews: [review], cards: [] });

    const storeFile = path.join(dir, '.state', 'reviews.json');
    const store = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
    expect(store.reviews).toHaveLength(1);
  });

  test('returns 400 for invalid grade value', async () => {
    const { config } = makeTestRepo();
    const app = createApp(config);

    const res = await request(app).post('/reviews').send({
      user_id: 'me',
      synced_at: new Date().toISOString(),
      since: null,
      reviews: [{ review_id: 'x:1', card_id: 'x', reviewed_at: new Date().toISOString(), grade: 'INVALID', rating: 1, response_time_ms: null, interval: null, ease: null }],
      cards: [],
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /health', () => {
  test('returns ok', async () => {
    const { config } = makeTestRepo();
    const app = createApp(config);
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
