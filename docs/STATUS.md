# STATUS

Re-read this file at the start of every session and every work cycle. Update it at every gate and before any session ends.

## Current phase

**Phase 0: Interview.** Reading of `reference/` is complete. Batch 1 is answered. Batch 2 was posted 2026-10-12 and is waiting on Michael's answers. Target: 4 batches or fewer, then the Phase 0 gate ⛔.

## Todo

### PENDING

- [ ] Phase 0: record Michael's batch 2 answers in the table below
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
- [x] Phase 0: batch 1 posted and answered
- [x] Phase 0: batch 2 posted (permanent-energy ruling, run end, map model, respawn, shop)

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

### Batch 1 (answered 2026-10-12)

Michael's reply was the single letter "a". It is recorded as (a) on all five, which were the recommended defaults; he was told this reading and asked to correct any of 2–5 if he meant only question 1.

| # | Question | Michael's answer | Recorded as |
|---|---|---|---|
| 1 | Item copy caps | a | Weapons and armor cap at 1, most accessories at 3, special accessories at 1. A drop stops once the cap is reached. All owned copies can be equipped at once. |
| 2 | Energy | a | Each fight has an energy cost that rises by zone. Only wins are charged; a loss costs nothing and the player is back on the map free to retry. A boss pays back its listed energy when beaten. Walking, teleporting and archaeology cost no energy. |
| 3 | Archaeology | a | Build the screenshot version: spends all current gold, shows a success chance driven by gold and the highest enemy level beaten this run, once per run, pool limited to unowned drops of enemies beaten at least once ever and at or below this run's highest kill. |
| 4 | Teleports and gems | a | Teleport points are bought with gems and stay unlocked. Gems carry over between runs. Steadfast keeps gems as a second persistent currency, earned from enemy drops only, no store. |
| 5 | New-run state | a | Gate bosses block the path again every run. Keys the player holds still open their doors. Teleport points skip whatever lies before them. The persist/reset ledger in the batch 1 post stands. |

### Batch 2 (posted 2026-10-12, awaiting answers)

| # | Question | My default | Michael's answer |
|---|---|---|---|
| 6 | Permanent starting energy: signposted tool, automatic on first kill, or hidden tool as in RH | a (signposted tool) | |
| 7 | What happens when a win takes energy to 0 | b if unsure (stay on the map; start the next run yourself) | |
| 8 | Map model: hand-built walkable tile maps or a node map | a (tile maps, tap-to-move) | |
| 9 | Respawn of normal enemies within a run | a (back almost at once) | |
| 10 | Where buying happens | a (inside the item screens, anywhere) | |

Assumptions stated in the batch 2 post, standing unless Michael objects: the hero strikes first; every fight starts at full life and survive-death charges reset per fight; a new run can be started at any time; a fight the player cannot afford cannot be started; a `*` after an enemy's level on the map marks a bonus enemy.

### Queued for later batches

- Batch 3: screens and what is shown before a fight or route choice (including a pool preview for archaeology), spoiler policy and how content gets reviewed, what made RH better than the two other games (not covered anywhere in `reference/`), pacing targets (real time per run, runs per zone, total hours), v1 scope.
- Batch 4 only if needed: leftovers from the assumptions list, original-name preferences.
- Not for Michael, to be set by formula in Phase 1 and tagged [ASSUMPTION]: XP needed per level, accuracy and evasion curves between the published points, archaeology chance formula.

### Calibration notes [WEB]

From the developer data files; approximate. For Phase 1 curve design, not for copying.

- 459 enemy rows in 36 zone sections; 184 are bosses. Boss energy values run 1–12; normal enemies carry none.
- Enemy stats versus level, log-log fit over the whole game: life ∝ L^1.7, damage ∝ L^1.5, XP ∝ L^1.8, gold ∝ L^1.0. Early game (levels 1–100k) is close to linear in level; late zones apply large extra multipliers.
- Median step between consecutive enemy levels is about 5%.
- Drop chances: median 5%, 10th–90th percentile 1.25%–10%, range 0.05%–100%. Most enemies have 1 or 2 drops. About 610 distinct dropped items; almost none drop from more than one enemy.
- 130 weapons and 539 armor/accessory rows; 113 items carry a gold price (shop stock), including tiered flat-stat accessories.
- Player magnitudes seen in Michael's screenshots: level 1.8e10, stats up to about 6e14, enemy life up to about 3e18.
- Screenshot cross-checks of the published formulas (inference from single data points):
  - Defense: reduction = D ÷ (D + enemy damage) reproduces both displayed values (60% early, 11% at the final boss). The same shape applies to enemy defense against player damage ("18% defended").
  - Crit: Dexterity 1,575 showing 21% chance and 172% damage fits the published Dexterity rule exactly with a 10% base chance and a 150% base damage.
  - Accuracy: accuracy about 1.74× (enemy level + 100) showed 97% to hit; a miss chance of 10% × ((level + 100) ÷ accuracy)² fits that one point.
  - Evasion: evasion at 37× and 51× enemy level showed 51% and 56% to dodge, roughly +26 points per 10× above the published 10% point, under the 80% cap.
  - Stat points: bases at level 1.8e10 are consistent with roughly 5 stat points per level before per-level gear, with a Life point worth 3–4× a point of the other stats.
- The final boss's battle cost on screen (12) is one more than its energy value in the data (11), which is what led to the cost-and-payback model Michael confirmed in batch 1.

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

- **Done:** Step 0 committed. All of `reference/` read as described under "Reading coverage". Batch 1 answered (all a). Batch 2 posted.
- **Worked:** Extracting only Michael's own turns from the transcripts gave the first-hand evidence in about 50 KB. His screenshots settled the pre-fight screen, the archaeology screen, and the stat screen layout. Running Python with `-I` against the data files in `reference/`.
- **Failed:** Nothing. One trap to avoid: `cd` inside a Bash call moves the session's working directory, so use absolute paths for git.
- **Next:** Record batch 2 answers, then post batch 3 from the queued list above.
