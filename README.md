# Study Loop

Automated personal flashcard system: author cards in a text file, practice in RemNote, get a weekly performance report — automatically.

**Your only manual steps:**
1. Append finished cards to `cards/inbox.md`
2. Practice in RemNote

Everything else — creating cards in RemNote, capturing grades, producing the weekly report — is automatic.

---

## Architecture

```
cards/inbox.md  ──git──▶  watch.ts (localhost:3748)
                               │                 │
                          GET /pending     POST /reviews
                               │                 │
                        RemNote plugin ──────────┘
                          (creates cards,
                           captures grades)
                               │
                      reports/week-YYYY-WW.md  ◀── weekly-report.ts
                      reports/week-YYYY-WW.json     (committed to git)
```

**No cloud server.** Everything runs on this machine.

---

## Card format (`cards/inbox.md`)

One card per line, pipe-delimited:

```
front | back | tech/path | #concept #concept
```

| Field | Required | Example |
|-------|----------|---------|
| front | yes | `Aurora failover` |
| back  | yes | `stops retry storms with a circuit breaker` |
| tech/path | yes | `AWS/Database/Aurora` — each `/` segment becomes a nested RemNote Document |
| #concepts | no | `#resilience #consistency` — cross-cutting tags, never folder names |

**Example cards:**
```
Aurora failover | stops retry storms with a circuit breaker | AWS/Database/Aurora | #resilience
Idempotent producer | dedupes on retry via producer id + sequence number | Kafka/Delivery | #resilience #consistency
Virtual threads | cheap blocking — many threads on few OS threads | Java/Concurrency | #performance
ECS task | the containerized unit ECS schedules onto capacity | AWS/Compute/ECS |
```

Blank lines and `#`-only comment lines are ignored.

---

## Setup

### 1. Install root dependencies (scripts + tests)

```bash
cd study-loop
npm install
```

### 2. Run tests

```bash
npm test
```

### 3. Start the watcher (leave running)

```bash
npm run watch
# or: PORT=3748 npx tsx scripts/watch.ts
```

The watcher:
- Serves `GET /pending` — unprocessed cards from inbox.md
- Accepts `POST /processed` — archives + removes a confirmed card
- Accepts `POST /reviews` — stores review data from the plugin
- Git pulls every 5 minutes (set `GIT_PULL_INTERVAL_MS` env var to change)

### 4. Install the RemNote plugin

The plugin lives in its own repo: [study-loop-plugin](https://github.com/DattebayoDev/study-loop-plugin) (kept separate so the code submitted for RemNote's marketplace review doesn't include this repo's personal card/report data).

```bash
git clone https://github.com/DattebayoDev/study-loop-plugin
cd study-loop-plugin
npm install
npm run dev   # starts Vite dev server on localhost:8000
```

In RemNote: **Settings → Plugins → Develop from localhost → http://localhost:8000**

The plugin adds a right-sidebar "Study Loop" widget with a "Sync Now" button.

### 5. Configure the plugin (in RemNote → Plugin Settings)

| Setting | Default | Description |
|---------|---------|-------------|
| Watcher port | 3748 | Must match the port `watch.ts` is listening on |
| User ID | "me" | Identifies your reviews in the payload |
| Auto-sync | true | Run on an interval while the sidebar widget is visible |
| Auto-sync interval (min) | 15 | How often to auto-sync |

---

## The sync loop

1. **You append cards** to `cards/inbox.md` (manually or via a coding AI)
2. **`watch.ts`** detects the change (or git pulls them) and serves them at `/pending`
3. **Plugin (Mode 1 — pull):** fetches `/pending`, creates cards in RemNote under the correct tech path, applies `#concept` tags, POSTs each confirmed id to `/processed`
4. **`watch.ts`** archives each card and removes it from `inbox.md` — atomically, one at a time
5. **You practice** in RemNote normally (spaced repetition as usual)
6. **Plugin (Mode 2 — push):** reads `plugin.card.getAll()`, normalises `repetitionHistory` since the last cursor, POSTs to `/reviews`
7. **`watch.ts`** stores reviews in `.state/reviews.json`
8. **Weekly:** run `npm run report` (or the cron job) → writes `reports/week-YYYY-WW.md` + `.json`, commits + pushes

---

## Safe inbox lifecycle

Cards are **never bulk-deleted**. Per card:

1. Parse → found in inbox.md
2. Plugin creates it in RemNote ✓
3. Plugin POSTs `/processed` with the card's id
4. Watcher: **append** line to `archive.md` (durable record)
5. Watcher: **record** id in `.state/processed.json` (dedupe key)
6. Watcher: **remove** line from `inbox.md` (cleanup)

A crash between steps is safe — the id is in `processed.json`, so the next sync skips it via dedupe. `inbox.md` ends empty only because every line was safely moved.

---

## Organization model

**Tech tree (primary location, one copy per card):**
- `AWS/Database/Aurora` → nested RemNote Documents
- `Kafka/Delivery`
- `Java/Concurrency`

**Concept tags (cross-cutting lens):**
- `#resilience`, `#consistency`, `#performance`, `#observability`, `#security`
- A tag can appear across many tech paths — Aurora's resilience ≠ Kafka's resilience

**Move, never delete.** To reorganize: use `rem.setParent()` (preserves spaced-repetition history). Deleting destroys the review history — never do it.

---

## Weekly report

```bash
npm run report          # write reports/ only
npm run report -- --push  # write + git commit + push
```

Outputs:
- `reports/week-YYYY-WW.md` — human-readable
- `reports/week-YYYY-WW.json` — machine-readable (for your coding AI)

### Launchd example (macOS, every Monday at 07:00)

Create `~/Library/LaunchAgents/com.studyloop.report.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.studyloop.report</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/usr/local/bin/tsx</string>
    <string>/Users/YOU/study-loop/scripts/weekly-report.ts</string>
    <string>--push</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key><integer>1</integer>
    <key>Hour</key><integer>7</integer>
    <key>Minute</key><integer>0</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>/tmp/study-loop-report.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/study-loop-report-err.log</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.studyloop.report.plist
```

### Cron alternative

```cron
0 7 * * 1 cd /Users/YOU/study-loop && npx tsx scripts/weekly-report.ts --push >> /tmp/study-loop-report.log 2>&1
```

---

## SDK limitations (documented, not faked)

| Limitation | What the plugin does instead |
|-----------|------------------------------|
| No native topic/document field on a card | Derive by walking `getParentRem()` up the Document chain; may be null |
| No per-review interval or ease | Always `null` in the review payload |
| No 1–5 rating | Bucketed: `again`/`hard`/`good`/`easy`/`other` from `QueueInteractionScore` |
| No "reviews since T" query | Full `repetitionHistory` per card, filtered client-side by cursor |
| No background scheduler | Auto-sync runs only while the sidebar widget is mounted (RemNote open + sidebar visible) |
| No inbound API | Cards can only be created by the plugin from inside RemNote |

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3748` | Port for `watch.ts` |
| `GIT_PULL_INTERVAL_MS` | `300000` | Git pull interval (ms) |
