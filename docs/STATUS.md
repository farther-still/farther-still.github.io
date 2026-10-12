# STATUS

Re-read this file at the start of every session and every work cycle. Update it at every gate and before any session ends.

## Current phase

**Phase 0: Interview** — reading `reference/`, then interviewing Michael in batches of ≤5 multiple-choice questions (target ≤4 batches). Gate ⛔ at the end of Phase 0.

## Todo

### PENDING

- [ ] Phase 0: read everything in `reference/` (confirmed notes, web notes, ChatGPT recap, chats, screenshots)
- [ ] Phase 0: batch 1, starting with section 10 of `rh_web_notes.md`, pre-answered from the recap where possible
- [ ] Phase 0: remaining batches covering the nine interview topics in `docs/KICKOFF.md`
- [ ] Phase 0: gate report ⛔ (wait for "approved")
- [ ] Phase 1: `docs/GDD.md` + 5 original names ⛔
- [ ] Phase 2: expand `CLAUDE.md` (<8,000 chars) + `docs/ARCHITECTURE.md` ⛔
- [ ] Phase 3a: walking skeleton (PWA, save system, CI, Pages deploy) ⛔
- [ ] Phase 3b: vertical slice ⛔
- [ ] Phase 4: balance simulator ⛔
- [ ] Phase 5: cloud backup, then content expansion

### COMPLETED

- [x] Step 0: `git init`, `.gitignore` (verified `reference/` ignored before first commit), `docs/KICKOFF.md` verbatim, stub `CLAUDE.md`, this file, first commit

## Interview answers (Phase 0 working record)

Filled in as Michael answers. Each row becomes a decisions-log entry in `docs/GDD.md` in Phase 1.

| # | Question | Michael's answer | Tag |
|---|----------|------------------|-----|

## Judgment calls

Calls made without asking, so Michael can overrule them. Design decisions move to the GDD decisions log once it exists.

- 2026-10-12: Initial branch is `main`; first commit made directly on it (no prior branch exists to branch from).
- 2026-10-12: Judgment calls are logged here rather than in a separate implementation-notes file, to keep to the kickoff's three sources of truth (hard rule 6).
- 2026-10-12: Added `.gitattributes` forcing LF, because checksummed save fixtures and golden replay hashes must be byte-identical on this Windows machine and on Linux CI.
- 2026-10-12: `.gitignore` also covers `.env*` and `*.local` now, ahead of the Phase 5 token work, because the repo will be public (hard rule 7).

## Handoff

- **Done:** Step 0 complete and committed.
- **Worked:** `git status --ignored` confirmed `reference/` ignored before the first commit.
- **Failed:** nothing yet.
- **Next:** finish reading `reference/`, then post interview batch 1.
