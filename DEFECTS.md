# RINGFALL — DEFECT LEDGER

Append-only. Every agent may add. Nobody may delete an entry; entries are closed, not removed.

**Severity:** `frame-ruining` / `major` / `minor`
**Every entry must carry a measurement.** Entries without one are closed as `discarded-unmeasured`.

## Open compensations

Any constant marked `// COMPENSATION:` in source must have a row here and is counted as an open
defect until the upstream cause is fixed and the constant removed.

| ID | File:line | Compensating for | Measurement | Opened | Status |
| --- | --- | --- | --- | --- | --- |
| — | — | *(none)* | | | |

## Open defects

| ID | Round | Sev | Subsystem | Description | Measurement | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| — | — | — | — | *(Phase 0 — no code yet)* | | | |

## Closed defects

| ID | Closed in round | How it was fixed | Verifying measurement |
| --- | --- | --- | --- |
| — | — | — | — |

## Round counts

| Round | frame-ruining | major | minor | total | Δ vs prev | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | — | — |
