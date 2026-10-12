# STATUS

Re-read this file at the start of every session and every work cycle. Update it at every gate and before any session ends.

## Current phase

**Phase 0 gate ⛔.** The interview is complete (3 batches, 15 questions). The gate report was posted 2026-10-12. Waiting for Michael to reply "approved"; questions or silence are not approval. Do not start Phase 1 before that.

## Todo

### PENDING

- [ ] Phase 0: wait for "approved" on the gate report; record answers to its three questions
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
- [x] Phase 0: batch 2 posted and answered (permanent-energy ruling, run end, map model, respawn, shop)
- [x] Phase 0: batch 3 posted and answered (clarity additions, spoiler policy, why RH beat the two other games, pacing, v1 size)
- [x] Phase 0: gate report posted ⛔

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

### Batch 2 (answered 2026-10-12: 6a 7b 8a 9a 10a)

| # | Question | Michael's answer | Recorded as |
|---|---|---|---|
| 6 | Permanent starting energy | a | **Ruling, deviation from RH.** Signposted tool: the first boss hands it over in plain sight. A boss gives its permanent energy, once, only when it dies with the tool equipped; the tool guts damage, so the player collects after outgrowing the boss. The bestiary marks bosses not yet collected from. Frustration fixed: finding the system too late (C16). Cost: one item and a bestiary marker. Risk accepted: nothing left to discover about the system. |
| 7 | Energy reaches 0 | b | The player stays on the map at 0 energy and can still walk, buy and use archaeology. The player starts the next run. |
| 8 | Map model | a | **Ruling.** Hand-built walkable tile maps, tap-to-move with pathfinding, a move-speed stat, room for hidden paths and stashes. Accepted cost: every zone is a hand-authored grid. |
| 9 | Respawn | a | A normal enemy is back within seconds or once the player steps away, so fights can be chained on one spot. Bosses are once per run. |
| 10 | Buying | a | Buying happens inside the item and equipment screens, from anywhere, at any time. No merchants on the map. |

Standing [ASSUMPTION] items from the batch 2 post. Michael raised no objection, which is not confirmation: the hero strikes first; every fight starts at full life and survive-death charges reset per fight; a new run can be started at any time; a fight the player cannot afford cannot be started; a `*` after an enemy's level on the map marks a bonus enemy; base crit is 10% chance and 150% damage.

### Batch 3 (answered 2026-10-12: 11 i ii iii, 12b, 13 a–e, 14 A2 B2 Ca, 15b)

| # | Question | Michael's answer | Recorded as |
|---|---|---|---|
| 11 | Clarity additions beyond RH | i, ii, iii | **Ruling, three deviations from RH.** (i) The pre-fight screen shows a win chance and the one limiting factor. (ii) A loss shows a one-line summary of what happened. (iii) The archaeology screen shows how the pool splits by enemy-level band. Frustrations fixed: blind, expensive tests (C26); level not predicting outcomes; fear of paying for a low-level item (C06). Cost: small. Risks accepted: fights can feel decided beforehand; archaeology is less of a gamble. |
| 12 | Spoiler policy | b | **Ruling.** Systems visible, content unseen. Michael approves every mechanic, formula, curve and screen. He does not see specific enemies, items, map layouts or secrets before meeting them in play. Content is reviewed by simulator reports in aggregate, automated content checks, and a separate verifier pass. He does not review content diffs; code and systems diffs stay his. |
| 13 | Why RH beat the two other games | a–e | All five apply: chosen fights with no random encounters; visible, finite drops with no random stats; permanent progress beyond gear; a hand-built world with gates and secrets; build depth. He named nothing specific from the other two games to avoid. |
| 14 | Pacing | A2, B2, Ca | A late RH run took 20–40 minutes. A typical RH wall took 4–6 runs. **Ruling:** Steadfast keeps RH's runs per wall and cuts real time per run to about a third (so roughly 7–13 minutes for a late run) through battle skip, tap-to-move and teleports. |
| 15 | v1 size | b | **Ruling.** v1 holds about a week of play at Michael's RH pace: roughly 8 zones, 100 enemies, 160 items, with every core system (buying, archaeology, the permanent-energy tool, gems and teleports, item sets, the auto-allocator, the bestiary, the pre-fight forecast). |

Standing [ASSUMPTION] items from the batch 3 post, no objection raised: no set bonuses; no rarity tiers; "doesn't stack" means the highest equipped value wins; v1 stats are the kickoff's list, with quadruple hit, the combo family, the 10× proc and faction mechanics left for full scope.

### Deviations from RH decided so far

These move to the GDD decisions log in Phase 1, each with the frustration fixed, the cost and the risk.

- Permanent-energy tool is handed over in plain sight by the first boss instead of being hidden (Q6).
- Win chance with limiting factor before a fight, loss summary after one, archaeology pool shown by level band (Q11).
- Player-controlled battle speed and skip (kickoff; RH has none, and Michael asked for it in C27).
- Tap-to-move with pathfinding as the primary control (Q8; RH uses free movement with an optional joystick).
- Gems come from enemy drops only; there is no store (Q4, hard rule 3).
- Real time per run is about a third of RH's for the same number of runs per wall (Q14).

### Gate report questions (posted 2026-10-12, awaiting answers)

| # | Question | My default | Michael's answer |
|---|---|---|---|
| G1 | Do the ten standing assumptions match his memory of RH? | b (keep them tagged [ASSUMPTION]) | |
| G2 | How much of the zone and enemy-family section of the GDD may he read under the spoiler policy? | a (structure only; themes and names go in a sealed appendix) | |
| G3 | Anything from the two other games to never copy, beyond the kickoff's hard rules? | a (nothing beyond the hard rules) | |

### Open items carried into Phase 1

- [OPEN] XP needed per level in RH. Steadfast sets its own formula, calibrated to the enemy XP curve and Michael's reported levels.
- [OPEN] RH's accuracy and evasion curves between the published points; single-point fits are in the calibration notes.
- [OPEN] RH's archaeology chance formula. One data point: 65.20% at 3,750,974 gold with highest kill 42,000.
- [OPEN] Gem drop rates and teleport prices in RH. One series: 163, 61, 168, 427 gems held at four points in the playthrough.
- [OPEN] Base starting energy in RH: a review cited in the recap says 20 [GPT]; Michael reported 25 before using the permanent-energy tool, which may include an accessory.
- [OPEN] Whether RH's energy-granting accessories apply at run start only or on equip.
- [OPEN] Total hours Michael spent in RH (30 days elapsed; hours not asked).
- Decision due before Phase 3a's first install: repo name and whether to use a custom subdomain, because the install URL is permanent and every github.io project site shares one origin (which matters for the Phase 5 backup token).
- Decision for Phase 1: whether the vertical slice gets a small shop as well as archaeology, since RH's early gold sink is buying, not archaeology.
- Engine rule to write into Phase 1 and enforce in Phase 3a: keep `Math.pow`, `Math.log` and similar out of battle resolution, because they are not guaranteed bit-identical between Node and Safari.

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
- Michael's RH timeline from the chat dates (2026-09-06 to 2026-10-06): strongest enemy level reached about 42k by day 3, 450k by day 5, 3M by day 11, 36M by day 17, 1.3B by day 22, 4.4B by day 26, full completion on day 30. Roughly 10× in enemy level every 3–4 days, and about 1.2 zone sections, 15 enemies and 22 items per day.
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

- **Done:** Step 0 committed. All of `reference/` read as described under "Reading coverage". Interview complete: 15 questions in 3 batches, all answered. Phase 0 gate report posted.
- **Worked:** Extracting only Michael's own turns from the transcripts gave the first-hand evidence in about 50 KB. His screenshots settled the pre-fight screen, the archaeology screen, and the stat screen layout. Running Python with `-I` against the data files in `reference/`.
- **Failed:** Nothing. One trap to avoid: `cd` inside a Bash call moves the session's working directory, so use absolute paths for git.
- **Next:** Wait for "approved". Then Phase 1: write `docs/GDD.md` from the tables in this file plus the reference material, and propose 5 original names. A fresh session can start from this file plus `docs/KICKOFF.md`; the screenshots and data files in `reference/` only need re-opening for exact numbers.
