# AGENTS — instructions for coding AIs generating flashcards

You are generating flashcards for a personal spaced-repetition study system backed by RemNote.

## Before generating cards

1. **Read the latest report:**
   ```
   reports/week-YYYY-WW.json   ← most recent file in reports/
   ```
   Parse `byTech` (per-technology accuracy) and `byConcept` (per-concept accuracy across all tech).

2. **Target the weakest areas:**
   - Find the **weakest tech paths** — lowest `accuracy` in `byTech` (leaf paths AND rollup paths).
   - Find the **weakest concept lenses** — lowest `accuracy` in `byConcept`.
   - A weak concept (e.g. `#resilience` at 62%) is more important than a strong tech path with a single bad card.
   - Prefer to generate cards that appear in BOTH weak tech AND weak concept quadrants.

3. **Rewrite repeatedly-missed cards:**
   - The `repeatedlyMissed` array lists cards with ≥2 "again" grades this week.
   - For each: rewrite the back to be clearer and more memorable, keep the SAME front (the front is the stable card id).
   - Append the rewritten version as a new line; do NOT delete the original (the old id is still tracked in `.state/processed.json`).

## Card format

Append to `cards/inbox.md` — one card per line:

```
front | back | tech/path | #concept #concept
```

Rules:
- `front` — concise question or term (becomes the stable sha1 id — do not change it later)
- `back` — complete, memorable answer (explain the mechanism, not just the name)
- `tech/path` — slash-delimited technology hierarchy: `AWS/Database/Aurora`, `Kafka/Delivery`, `Java/Concurrency`
- `#concepts` — optional, space-separated cross-cutting tags (e.g. `#resilience #consistency`)

**Store by technology, tag by concept.** A concept like `#resilience` is a quality that appears across many technologies, not a folder. Each technology has its own instance of the concept.

## Examples

```
Aurora failover | stops retry storms by refusing new connections during the 30 s leader election window | AWS/Database/Aurora | #resilience
Kafka idempotent producer | sets producer-id + sequence number per partition; broker dedupes retries on the same epoch | Kafka/Delivery | #resilience #consistency
Virtual threads (JDK 21) | mount/unmount on OS threads at blocking points; thousands can coexist with a small thread pool | Java/Concurrency | #performance
ECS task definition | immutable versioned blueprint (CPU, memory, image, env) that ECS instantiates as tasks | AWS/Compute/ECS |
```

## Constraints

- **Never suggest deleting a studied card.** Deleting destroys spaced-repetition history. To reorganize, move the card (change its parent path in the tech tree) — this is done by updating the plugin's setParent call, not by editing inbox.md.
- **Unique fronts only.** The front is hashed to a stable id. Two cards with the same front are treated as one.
- **One home per card.** A card lives in exactly one tech path. If it applies to multiple technologies, write separate cards for each (Aurora's resilience ≠ Kafka's resilience — they are distinct facts with distinct review histories).
- **Concepts are lenses, not locations.** Never create a tech path like `Resilience/Aurora` — that puts resilience as the primary location. The primary is always the technology; the concept is always a `#tag`.
- **Blank lines and `# comment` lines** in inbox.md are ignored by the parser — use them freely for readability.
