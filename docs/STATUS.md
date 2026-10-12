# STATUS

Re-read this file at the start of every session and every work cycle. Update it at every gate and before any session ends.

## Current phase

**Phase 0: Interview.** Reading of `reference/` is complete. Batch 1 (section 10 of `rh_web_notes.md`) was posted 2026-10-12 and is waiting on Michael's answers. Target: 4 batches or fewer, then the Phase 0 gate ⛔.

## Todo

### PENDING

- [ ] Phase 0: record Michael's batch 1 answers in the table below
- [ ] Phase 0: batch 2 (run end flow, permanent-energy ruling, map and movement, combat order and stacking, leveling curve, shops)
- [ ] Phase 0: batch 3 (screens and pre-fight information, spoiler policy, comparison with the two other games, pacing targets, v1 scope)
- [ ] Phase 0: batch 4 only if batches 1–3 leave material gaps
- [ ] Phase 0: gate report ⛔ (wait for "approved")
- [ ] Phase 1: `docs/GDD.md` + 5 original names ⛔
- [ ] Phase 2: expand `CLAUDE.md` (<8,000 chars) + `docs/ARCHITECTURE.md` ⛔
- [ ] Phase 3a: walking skeleton (PWA, save system, CI, Pages deploy) ⛔
- [ ] Phase 3b: vertical slice ⛔
- [ ] Phase 4: balance simulator ⛔
- [ ] Phase 5: cloud backup, then content expansion

### COMPLETED

- [x] Step 0: `git init`, `.gitignore` (verified `reference/` ignored before first commit), `docs/KICKOFF.md` verbatim, stub `CLAUDE.md`, this file, first commit
- [x] Phase 0: read `reference/` (coverage and its one limit are listed under "Reading coverage")
- [x] Phase 0: batch 1 posted

## Phase 0 working record

"RH" is the reference game. Tags follow hard rule 1. Chat numbers (C01–C31) refer to the private recap in `reference/`; nothing here quotes it.

### Reading coverage

- Read in full: `rh_notes.md`, `rh_web_notes.md`, recap files 00–03, the screenshot index, all 19 distinct screenshots, the 7 guide files plus the project instructions, and every one of Michael's own 236 turns across the 31 chats.
- Analyzed by script: the three developer data files (enemies, weapons, armor/accessories) already saved in `reference/`. Nothing was fetched from the web.
- Limit: ChatGPT's replies were read through the chat-by-chat recap plus targeted lookups, not end to end. They are [GPT] by rule and none is treated as confirmed.

### Answered from the reference files (no question needed)

| Topic | Finding | Tag |
|---|---|---|
| Archaeology timing | Usable at its NPC any time during a run, once per run | Michael's screenshot (C04) |
| Boss-energy weapon | Not a separate mechanic. It is the same permanent-energy tool: a deliberately weak weapon that must be equipped when a boss dies; that boss then adds permanent starting energy once | [WEB] data + Michael's report (C16) |
| Automation helper | Michael used it: a percentage split of new stat points across the five stats (C17). Unlock point "shortly after level 250" | split: Michael's turns; unlock level: [GPT] |
| Summoning | Special enemies that appear when a condition is met at an NPC (for example carrying enough energy or gold) | [GPT]; out of v1 |
| Allocatable stats | Five: Life, Damage, Defense, Dexterity, Luck. Each shows Base and Mult; final = Base × Mult | Michael's screenshots |
| Spent stat points | Cannot be taken back within a run | Michael's turn (C26) |
| Equipment layout | 1 weapon, 12 armor slots, 5 accessory slots, a 6th accessory slot unlockable late; up to 5 saved item sets with a quick selector on the map screen | screenshots + Michael's turns |
| Pre-fight screen | Shows enemy name and level, a one-line win estimate, the energy cost, the enemy's special traits, its drops (unfound ones hidden), and a retreat button | Michael's screenshot (C30) |
| Bestiary | Numbered list; unseen enemies hidden; shows each enemy's drops with unfound ones hidden; marks bosses and which bosses have given their permanent energy | Michael's screenshots |
| Item list | Shows owned/max count per item and placeholder rows for items not yet found | Michael's screenshot (C15) |
| Battle speed | RH has no player speed control; Michael asked for one (C27). Steadfast's speed and skip settings are a deliberate deviation that fixes a recorded frustration | Michael's turn |
| Multi-action layers | Three nested layers: hits per attack, attacks per turn, turns. The character screen shows an average for each | Michael's screenshots |

### Batch 1 (posted 2026-10-12, awaiting answers)

| # | Question | My default | Michael's answer |
|---|---|---|---|
| 1 | Item copy caps: weapons and armor 1, most accessories 3, special accessories 1; drops stop at the cap; copies can all be equipped | a | |
| 2 | Energy: cost per fight rises by zone, bosses pay energy back on defeat; what does a loss cost? | a (a loss costs nothing) | |
| 3 | Archaeology: which version to build, given the screenshot and `rh_notes.md` #6 differ | a (screenshot version) | |
| 4 | Teleports and gems: what paid for a teleport point, and did it persist? | a (gems; permanent) | |
| 5 | New-run state: do gate bosses block the path again every run? | a (yes; keys and teleport points persist) | |

### Queued for later batches

- Ruling needed: the kickoff says a first boss kill gives permanent starting energy, but RH gates that behind a hidden tool. Rule 10 deviation, to be decided with its cost and risk stated.
- Run end: what exactly happens at zero energy, and whether a run can be ended early.
- Map and movement: free-walking tile map versus something simpler; enemy respawn within a run; what "once per run" covers.
- Combat order, base crit damage, what "doesn't stack" means, accuracy curve between the published points.
- Leveling: XP needed per level, stat points per level.
- Shops: what gold buys early, before archaeology exists.
- Spoiler policy, pacing targets, v1 scope, comparison with the two other games (not covered anywhere in `reference/`).

### Calibration notes [WEB]

From the developer data files; approximate. For Phase 1 curve design, not for copying.

- 459 enemy rows in 36 zone sections; 184 are bosses. Boss energy values run 1–12; normal enemies carry none.
- Enemy stats versus level, log-log fit over the whole game: life ∝ L^1.7, damage ∝ L^1.5, XP ∝ L^1.8, gold ∝ L^1.0. Early game (levels 1–100k) is close to linear in level; late zones apply large extra multipliers.
- Median step between consecutive enemy levels is about 5%.
- Drop chances: median 5%, 10th–90th percentile 1.25%–10%, range 0.05%–100%. Most enemies have 1 or 2 drops. About 610 distinct dropped items; almost none drop from more than one enemy.
- 130 weapons and 539 armor/accessory rows; 113 items carry a gold price (shop stock), including tiered flat-stat accessories.
- Player magnitudes seen in Michael's screenshots: level 1.8e10, stats up to about 6e14, enemy life up to about 3e18.

## Judgment calls

Calls made without asking, so Michael can overrule them. Design decisions move to the GDD decisions log once it exists.

- 2026-10-12: Initial branch is `main`; first commit made directly on it (no prior branch exists to branch from).
- 2026-10-12: Judgment calls are logged here rather than in a separate implementation-notes file, to keep to the kickoff's three sources of truth (hard rule 6).
- 2026-10-12: Added `.gitattributes` forcing LF, because checksummed save fixtures and golden replay hashes must be byte-identical on this Windows machine and on Linux CI.
- 2026-10-12: `.gitignore` also covers `.env*` and `*.local` now, ahead of the Phase 5 token work, because the repo will be public (hard rule 7).
- 2026-10-12: Read ChatGPT's side of the transcripts through the recap and targeted lookups rather than end to end; every claim there needs Michael's confirmation anyway.
- 2026-10-12: This file is public, so it paraphrases the private recap and cites chat numbers instead of quoting it. The same will apply to the GDD unless Michael says otherwise.
- 2026-10-12: Interview batches are posted as plain text so conflicts between sources can be shown side by side; answers can be given as "1a 2b …".

## Handoff

- **Done:** Step 0 committed. All of `reference/` read as described under "Reading coverage". Batch 1 posted.
- **Worked:** Extracting only Michael's own turns from the transcripts gave the first-hand evidence in about 50 KB. His screenshots settled the pre-fight screen, the archaeology screen, and the stat screen layout. Running Python with `-I` against the data files in `reference/`.
- **Failed:** Nothing. One trap to avoid: `cd` inside a Bash call moves the session's working directory, so use absolute paths for git.
- **Next:** Record batch 1 answers, then post batch 2 from the queued list above.
