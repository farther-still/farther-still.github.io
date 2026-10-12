# STATUS

Re-read this file at the start of every session and every work cycle. Update it at every gate and before any session ends.

## Current phase

**Phase 3a gate ⛔.** Phase 2 was approved on 2026-10-12. Phase 3a, the walking skeleton, was built the same day: an installable app with a dummy state, the full save system less cloud backup, the update flow, Settings, the diagnostics log, the checks, CI and the Pages deploy. It is live at `https://farther-still.github.io/`. The gate report was posted with the steps for Michael's phone acceptance run, and he answered its two questions the same day (1 a, 2 a). His reply did not contain "approved", and the phone run had not been reported. Still waiting for that word; answers, questions or silence are not approval. Do not start Phase 3b before it. He asked for Phase 3b to start in a new session and was given a prompt for it.

**Spoiler rule for every session.** `docs/sealed/` holds zone themes and all content names. Michael does not open it. Never quote anything from it in chat, gate reports, commit messages or this file. Refer to zones as Z1–Z8, elements as E1–E3 and enemy types as T1–T4.

## Todo

### PENDING

- [ ] Michael: Phase 3a phone acceptance run (steps in the gate report); report back the four readouts listed under "Still to settle" in `docs/ARCHITECTURE.md` section 13
- [ ] Phase 3a: wait for "approved" on the gate report. If the phone run reports a failure, fix it inside Phase 3a first
- [ ] Phase 3b: vertical slice ⛔. First: save version 2 with its migration and fixture, removing the dummy state and `data/dummy.json`; then `check-content`, the reference-name test, battle replays and `npm run sim`
- [ ] Phase 3b gate: report what one zone cost to author, so the DV-6 condition can be judged on evidence
- [ ] Phase 4: balance simulator ⛔
- [ ] Phase 5: cloud backup, then content expansion

### COMPLETED

- [x] Step 0: `git init`, `.gitignore` (verified `reference/` ignored before first commit), `docs/KICKOFF.md` verbatim, stub `CLAUDE.md`, this file, first commit
- [x] Phase 0: read `reference/` (coverage and its one limit are listed under "Reading coverage")
- [x] Phase 0: batch 1 posted and answered
- [x] Phase 0: batch 2 posted and answered (permanent-energy ruling, run end, map model, respawn, shop)
- [x] Phase 0: batch 3 posted and answered (clarity additions, spoiler policy, why RH beat the two other games, pacing, v1 size)
- [x] Phase 0: gate report posted ⛔; its three questions answered (G1 a, G2 a, G3 a)
- [x] Phase 0: approved by Michael, 2026-10-12
- [x] Phase 1: `docs/GDD.md` (eleven kickoff sections, backup comparison, five names) and `docs/sealed/` written
- [x] Phase 1: script checks run; a separate verifier pass and a re-check run, and their findings fixed in the GDD and the sealed appendix; gate report posted ⛔
- [x] Phase 1: gate questions answered (P1 a, P2 a, P3 a, P4 a, P5 d) and recorded in GDD section 13.4
- [x] Phase 1: follow-ups answered (F1 c: 10–20 runs a day in early RH; F2: keep 8 zones) and recorded; deviations DV-1 to DV-8 explained again in chat
- [x] Phase 1: DV-4 ruled (both controls at once) and Phase 1 approved by Michael, 2026-10-12
- [x] Phase 2: `CLAUDE.md` expanded (7,919 characters) and `docs/ARCHITECTURE.md` written; content paths under `data/` sealed in `.gitattributes`
- [x] Phase 2: script checks run; a separate verifier pass and a re-check run, and their findings fixed; gate report posted ⛔
- [x] Phase 2: gate question answered (A1 a) and recorded in `docs/ARCHITECTURE.md` section 13
- [x] Phase 2: approved by Michael, 2026-10-12
- [x] Phase 3a: organization and repo steps given to Michael before anything was deployed (2026-10-12)
- [x] Phase 3a: Michael created the organization `farther-still` and the public repo `farther-still.github.io`, Pages enabled (2026-10-12)
- [x] Phase 3a: scaffold, engine pieces, save system, platform, UI, checks, hook and CI workflow built (2026-10-12)
- [x] Phase 3a: the built app run in a browser on the laptop: offline launch, export and import, both update paths, run repair, recovery screen
- [x] Phase 3a: separate verifier pass (failed, one way to lose a save) and re-check (passed); findings fixed
- [x] Phase 3a: first push, CI green, site live; gate report posted ⛔ (2026-10-12)

## Phase 3a working record

`docs/ARCHITECTURE.md` section 14 lists exactly what exists. This section records how it was checked and what is still unknown.

### What Phase 3a built

- An installable app, "Farther Still", with a dummy state: a counter, a step count and a fake inventory. No game rule exists yet.
- The save system of `docs/ARCHITECTURE.md` section 7 except the cloud backend, as save version 1, with one frozen fixture.
- A service worker with our own logic, an update controller, the persistence request, the share sheet, and the diagnostics log.
- Settings, the new-run sheet, the recovery screen, the save-failed notice and the landscape panel.
- The checks of the enforcement map that do not need game content, a pre-commit hook, and one CI workflow that checks, builds, scans and deploys.

### Verified on the laptop (2026-10-12)

- `npm run check`: PASS. Four TypeScript projects, lint, 335 tests in 18 files, repo check, prose check. The count was 329 at the commit the gate report described; the rest came with the fixes after it.
- `npm run build` and `npm run check:dist`: PASS.
- Each lint ban, the engine's no-DOM compile and each check script is run against a deliberate violation in `tests/enforcement.test.ts` and `tests/checks.test.ts`: PASS.
- The built app, served by `npm run preview`, driven in a Chromium pane: PASS on each of the following.
  - The service worker became active and cached all 8 files; a reload with the server stopped still launched and played.
  - State survived a reload. A step taken without a save was written on `pagehide`.
  - An exported text code, imported after further play, brought the earlier state back and set the replaced game aside.
  - A second build waited: "update ready" showed, the old build kept running and both caches existed. It took over only from the new-run sheet, and the old cache was then gone.
  - A third build, left waiting, took over when the only tab was closed and reopened. The run's aim pointed at an item the new content lacked; it was cleared, with a notice, and the profile was untouched.
  - A fourth build whose content lacked an owned item gave the recovery screen. Nothing was written until "use anyway"; then all three records were set aside first.
  - The self-test matched 9 of 9. The diagnostics log stayed empty in normal use and recorded a deliberate policy violation.
- The dev server runs without a service worker and Settings says so.

### Deploy

- First push, 2026-10-12: `main` at `2452ef0`. CI run 1 passed both jobs, `check` (install, `npm run check`, build, `npm run check:dist`) and `deploy`: `https://github.com/farther-still/farther-still.github.io/actions/runs/38262096743`. PASS.
- `https://farther-still.github.io/` answered 200 for the page, `sw.js`, the manifest and the touch icon. The served bundle holds the commit it was built from, and the page carries the pinned content security policy. PASS.
- The live site, opened in a Chromium pane on the laptop: the worker activated and cached 8 files, a tap was saved with strict durability, the self-test matched 9 of 9, the diagnostics log stayed empty, and the console showed no errors. PASS.
- The commit that records this is itself a further deploy, of documents only. Its CI run is reported in the gate report, not here.

### Verifier pass (2026-10-12)

A separate agent was given the kickoff's save spec and Phase 3a section, the architecture and the code, with instructions to find faults. It was not shown this file's conclusions.

The first pass failed the build on three of nine checks. Its one must-fix was a reproduced way to lose a save: when storage could not be read at startup, the recovery screen knew of no records, still offered "Restore", and wrote the hot slot as save 1 over a save 57 it had never read, with no copy kept. Every function underneath was correct; the fault was in the wiring between them. It also found that a media element made through the UI's own helper passed both lint and the build scan, that the export the app asks for after a skipped checkpoint could not be imported back, that a damaged record with an absurd `seq` could stop every later write, and several false negatives in the build scan.

All of it was fixed. A recovery choice now reads the slots again before writing and changes nothing if it cannot; after an unreadable start only the two choices that write nothing are offered (`docs/ARCHITECTURE.md` A-19 to A-22).

The re-check passed, with no new must-fix. It confirmed the original reproduction no longer works through the real `startApp` and found no other route that writes slots it has not just read. Its remaining findings were then fixed by the author and have not been re-verified: the build scan and the worker now resolve the page's file references the same way; the rule for which `seq` values the write sequence may build on was rewritten twice, the first rewrite having only moved the problem (see "After the gate report"); a start that fails part-way has its own honest screen; and the startup and recovery wiring now has tests through the real `startApp` (`src/ui/app.test.ts`).

Left as they are, by choice:

- Importing a raw recovery export offers its newest good record even when a newer one in it fails a consistency check, and does not say a newer one was passed over.
- A fallback is announced when the unreadable record is first set aside. If the app died between making that copy and storing the notice, the fallback would be silent.
- The engine import rule would wrongly refuse a file two folders deep importing two levels up within the engine. No such folder exists.
- The sheets and Settings have no automated tests of their own.

It could not check: the app in a real browser or on the phone; GitHub Actions running; and the host serving a stale page just after a deploy, which the worker's new install check is there for.

### Gate questions (answered 2026-10-12: 1 a, 2 a)

| # | Question | Michael's answer | Recorded as |
|---|---|---|---|
| 1 | Who pushes from here on: Claude once the checks pass and STATUS is current, or Michael each time? | a | **Ruling.** Claude pushes to `main` when `npm run check` and `npm run check:dist` pass and STATUS is current; CI still gates the deploy. In `CLAUDE.md` conventions and `docs/ARCHITECTURE.md` section 12. |
| 2 | Should a push that changes only documents skip the deploy, since every push ships a new version? | a | **Ruling.** Leave it. Every push is a new version; revisit only if "update ready" becomes a nuisance in Phase 3b. In `docs/ARCHITECTURE.md` section 12. |

He also said not to move on in the same session: Phase 3b starts in a new one, from a prompt he was given on 2026-10-12.

### After the gate report (2026-10-12)

- One more fault was found by the author, not the verifier, while re-reading the last fix: building the write sequence only on checksum-verified records would have brought the recovery screen back at every launch after the player went back past a record from a newer version. The rule is now the one in `docs/ARCHITECTURE.md` 7.1 and A-20: any record's `seq` counts unless the record is unusable and the `seq` is implausibly large.
- A third, narrow verifier pass then looked only at what had changed since the re-check. It passed, with no must-fix. It confirmed by mutation that the new wiring tests fail if the recovery exit goes back to using what was read when the screen opened, or if a writing choice is offered after an unreadable start. It found one should-fix: junk that merely claimed a newer save version, sitting outside the hot slot with a `seq` the write sequence would not build on, brought the recovery screen back at every launch. Such a record now counts as damaged, and a real newer record is outranked by the next write. It also found a test that could not catch a missing second-tap guard, and three stale statements in this file. All fixed by the author; the fixes after this third pass have not been re-verified, and they are small: one classification rule with five tests, one stronger assertion, and wording.

### Not checked yet

- Everything on the iPhone: install, Spotify, background and force-quit, offline, export through the share sheet, delete and reinstall, import, and the update waiting. This is Michael's acceptance run.
- The four open points in `docs/ARCHITECTURE.md` section 13, which only the phone can answer: strict durability, sharing a file from the installed app, the database connection after backgrounding, and the engine self-test.

### Carried forward to Phase 3b

- Save version 2: a migration that discards the dummy fields, a second fixture, the run-duration log, and the removal of `data/dummy.json`. This is the first real use of the migration path.
- The three checks that need content: `scripts/check-content.ts`, the reference-name test with `scripts/build-refnames.ts`, and battle replays. Also the check that every ID in the data is in the lock.
- Every push to `main` is a new version, documents included, so each one leads to an "update ready". If that becomes a nuisance, the deploy could skip pushes that change no shipped file.
- The UI will grow past what the stand-in DOM in `tests/fake-dom.ts` can stand in for. Decide then whether to add a DOM library for tests.
- Record Michael's phone readouts in `docs/ARCHITECTURE.md` section 13.

## Phase 2 working record

### What Phase 2 settled

- `CLAUDE.md` now carries the purpose, the ten hard rules, the spoiler rule, a folder map, commands, conventions, the save-change checklist, content rules, the enforcement map and the definition of done. `docs/ARCHITECTURE.md` is added to hard rule 6 as the structure document.
- `docs/ARCHITECTURE.md` section 13 logs eleven architecture decisions (A-01 to A-11). Design decisions stay in the GDD.
- The decisions Michael is most likely to care about: a save the app cannot use is quarantined and a recovery screen shown, never overwritten (A-06); an update is applied by a tap on the new-run sheet while the app is open, but takes over by itself after the app is fully closed, which no browser lets an app prevent (A-07); settings and export tracking travel inside the save (A-05); four tools beyond the kickoff's stack list (A-11).
- The GDD gained what the architecture needed: two notes and one field in the reset ledger (2.5), the content-count check reading `data/content-spec.json` (7.9), and two screens plus a landscape panel (8.2, 8.3).
- Nothing is built. Every check in the enforcement map is a specification for Phase 3a, except `.gitignore` and `.gitattributes`.

### Gate question (answered 2026-10-12: A1 a)

| # | Question | Michael's answer | Recorded as |
|---|---|---|---|
| A1 | Service worker: a Vite PWA plugin that supplies the list of files to cache while the worker's logic stays our own code, or a fully hand-written worker with no plugin? | a | **Ruling.** The plugin. Recorded in `docs/ARCHITECTURE.md` A-11 and section 9. |

### Verifier pass (2026-10-12)

A separate agent read both documents against the kickoff's stack and save spec, the old stub and the GDD. The first drafts failed six of nine checks. The serious findings were in the save paths: the load order could start fresh over a save it had rejected and then overwrite it; an import replaced the live game with no confirmation; the update flow claimed a behaviour a service worker cannot deliver; the write triggers contradicted each other; settings sat outside every save guarantee. It also found three hard rules loosened in the rewrite, a wrong fixture rule, and enforcement checks that would not have caught what they claimed. Both documents were rewritten.

A re-check confirmed the eleven must-fix findings resolved apart from three sub-points, and raised ten further points (N1 to N10). The two that mattered were new save-safety gaps in the rewrite: a record that failed an invariant was kept on write but dropped on load, and routine quarantine copies could push out the only copy of a real save. All ten were fixed by the author afterwards and have not been re-verified.

It could not check: whether any described check behaves as described, since nothing is built; anything about iOS or current tool versions, which it stated from memory; and the diagrams' rendering.

### Carried forward to Phase 3a

- First step: exact instructions for Michael to create the GitHub organization and the repo named for it, before anything is deployed. He asked for this to be explained when needed.
- The open points at the end of `docs/ARCHITECTURE.md` section 13: generator and hash choice with test vectors, zod version, storage durability on the phone, file sharing from the installed app, database connection after backgrounding.
- The kickoff's acceptance test "deploy a change and confirm it waits for update ready" holds while the app stays open or is resumed. After a force-quit the new version loads without asking. Michael was told this in the gate report.
- Phase 3a's dummy save is version 1; Phase 3b's real one is version 2 with a migration.

## Phase 1 working record

`docs/GDD.md` is now the design truth. Where it and the Phase 0 record below differ, the GDD wins. The six deviations are in its section 13.2 and the open items are in its section 12.

### What the GDD settled

- All 15 interview answers and 3 gate answers are in its decisions log (13.1), each pointing at the section that implements it.
- Six deviations from RH (DV-1 to DV-6), each with frustration fixed, cost and risk. Two more, DV-7 and DV-8, come from fitting RH's order into v1, not from the interview: Salvage exists from Z1 and waypoints start at Z3, both earlier than in RH. Neither has had an explicit ruling; approving the gate approves them.
- Twenty Phase 1 design decisions (D-01 to D-20), proposed at the gate. The ones Michael is most likely to want to overrule: plain JavaScript numbers (D-01), shipped labels that differ from RH's (D-05), energy accessories counting only while equipped (D-08), a claimed boss refunding only its cost (D-09), shop stock visible from the start (D-11).
- Twenty-eight open questions about RH (O-01 to O-28). None blocks the build; each has a Steadfast rule.
- One risk was added to DV-1 after Michael's Q6 ruling: with the tool in hand from the first boss, permanent energy arrives in steps of 3, not as one large jump. It is flagged in the gate report.
- Pacing targets for the simulators (GDD 5.9).

### Gate questions (answered 2026-10-12: P1 a, P2 a, P3 a, P4 a, P5 d)

| # | Question | Michael's answer | Recorded as |
|---|---|---|---|
| P1 | Which of the five names? | a | **Ruling.** Farther Still. "Steadfast" stays the codename for the repo and docs until the install address is settled before Phase 3a. Proposed address: `farther-still.github.io`, through a free GitHub organization. Not yet decided or created. |
| P2 | Does the vertical slice get a small shop as well as Salvage? | a | **Ruling.** Both. Also the ruling on DV-7. |
| P3 | Did a boss he had already collected permanent energy from still pay extra in later runs? | a ("no, or don't remember") | **Ruling.** A Claim adds 3 starting energy and a claimed boss then pays nothing extra. Not a confirmed fact about RH; O-08 stays open. |
| P4 | Did an energy accessory change his energy the moment he equipped or removed it? | a ("yes, or don't remember") | **Ruling.** Energy accessories count only while equipped. Not a confirmed fact about RH; O-06 stays open. |
| P5 | About how long did he play RH on a typical day? | d | **Confirmed.** More than 4 hours a day, so over 120 hours in all. The 2–4 hour assumption is withdrawn. |

Two follow-ups to P5, answered 2026-10-12:

| # | Question | Michael's answer | Recorded as |
|---|---|---|---|
| F1 | About how many runs did he start on a typical early RH day? | c | **Confirmed.** 10–20. v1's run target moves from 53–76 to 70–140 (aim 100) and its play time from 5–9 hours to 8–13, which is two to three days at his rate. Gem drop rate retuned from 12% to 8% for the longer v1. |
| F2 | Should v1 be larger than 8 zones, given that? | Keep 8 | **Ruling.** Q15 stands. |

Michael then asked to hear the deviations again. DV-1 to DV-8 were laid out in chat, with the risk added to DV-1 (energy in steps of 3) and DV-3's retry problem flagged for a second look. His replies, recorded in GDD 13.4:

- **DV-8:** fine. Ruled.
- **DV-6:** uncertain; he liked some of RH's grind. Accepted if the game can be expanded easily enough to give him sufficient play. He was told that DV-6 cuts waiting, not the number of runs; that tuning runs per wall is a cheap, data-only lever; that adding zones is the expensive one and its cost is unknown until the slice; and that a full RH-sized game at a third of the time is about 40 hours, roughly ten days at his rate.
- **DV-4:** reopened. He enjoyed RH's free walking and asked for a toggle, or else a joystick. Proposed: tap-to-walk and press-and-drag steering both active at once. Awaiting his pick: (a) both, (b) steering only, (c) tap only as written.
- **DV-1 and DV-3:** he raised no objection to either flag. They stand as written; no objection is not a new ruling.

Three questions held for later phases were offered as optional and answered the same day (GDD 13.4):

- **Two of one armor type in RH?** No, one of each. Confirmed; O-25 closed.
- **Which grind did he like?** Both farming drops and the climb, but not indefinitely: some is good, not to the point of annoyance. Two ceilings were added to GDD 5.9: no wall over 8 runs, and no drop over 80 expected kills.
- **GitHub organization for the install address:** deferred at his request. He wants the steps explained later. It is on the todo list for before Phase 3a.

He then replied "a, approved": DV-4 is both controls at once (GDD 8.3 and 13.2 updated), and Phase 1 is approved.

### Verifier pass (2026-10-12)

A separate agent read the GDD, the sealed appendix and the reference files with instructions to find faults. It passed carry-over fidelity, prose formatting and name originality, and failed five checks. All of its "must fix" findings were fixed before the gate report:

- item stats had no formula and two sections disagreed on what an item record holds (now GDD 5.6 and D-20);
- Crit Damage fell below its confirmed 150% base at Dexterity under 10;
- four pacing targets could not be met by the document's own numbers (breakthrough size, run total, level ratio, wins per run);
- the sealed appendix disagreed with the GDD's structure in six places;
- several RH claims were mis-tagged or one-sided, including where RH introduces Salvage ([GPT], not [WEB]) and a [WEB] account that contradicted the first draft's rule for claimed bosses;
- three rules were ambiguous enough to build two ways (Resistance across two tags, negative item lines, `goldAt`).

It could not check six things: the GDD's reset ledger against the batch 1 post (taken from the Phase 0 session transcript, which it did not have); chat-number citations beyond the Phase 0 digest, which is also where the [GPT] source for RH's Salvage timing sits; the name checks and the backup section's platform facts (no web access); whether the pacing targets are reachable in play (no simulator yet); reference-game names that exist only in screenshots; and whether square roots match between Node and Safari.

A re-check by the same verifier then confirmed every must-fix finding resolved except one part of the item-budget finding, and raised nine further points (R1–R9). The main one: reversing the claimed-boss rule had made a Claim worth nothing on any boss the run would beat anyway. All nine were fixed by the author afterwards and have not been re-verified: a Claim is now worth 3 against a surplus of 2 (GDD 2.3, D-09), the item budget is defined on a named reference loadout (5.6), boss multipliers and early-zone budgets were lowered and raised until the shape model passed every gate boss with a full loadout and failed it with half of one, and the gem rate went up to cover the waypoints.

The Phase 0 record below still tags the Auto-assign unlock level [GPT]; `reference/rh_web_notes.md` attributes it to the store's version history, so the GDD tags it [WEB].

### Carried forward to later phases

The Phase 2 items below were picked up in `CLAUDE.md` and `docs/ARCHITECTURE.md` on 2026-10-12.

- Phase 2 enforcement map: lint ban on `Math.pow`, `Math.exp`, the `Math.log` family and trigonometry in `src/engine/`; the content checks in GDD 7.9; a reference-name check that can run in CI without publishing the names (for example hashed names); `-diff` in `.gitattributes` for `data/` content files so code review does not spoil content.
- Phase 3a: the on-device engine self-test in Settings (GDD 6.3); the install address, which follows from P1.
- Phase 3b: the simulator replaces the throwaway shape model mentioned in GDD 5.9. That model was not kept.

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
| Allocatable stats | Five: Life, Damage, Defense, Dexterity, Luck. Each shows Base and Mult. Final = Base × Mult holds exactly for Life and Damage in all three stat screenshots; late-game Defense is 5–6× larger than Base × Mult, probably a separate multiplier layer [OPEN] | Michael's screenshots |
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

Moved to the GDD decisions log (section 13.2) on 2026-10-12, each with the frustration fixed, the cost and the risk. The list below is the Phase 0 record.

- Permanent-energy tool is handed over in plain sight by the first boss instead of being hidden (Q6).
- Win chance with limiting factor before a fight, loss summary after one, archaeology pool shown by level band (Q11).
- Player-controlled battle speed and skip (kickoff; RH has none, and Michael asked for it in C27).
- Tap-to-move with pathfinding as the primary control (Q8; RH uses free movement with an optional joystick).
- Gems come from enemy drops only; there is no store (Q4, hard rule 3).
- Real time per run is about a third of RH's for the same number of runs per wall (Q14).

### Gate report questions (answered 2026-10-12: G1 a, G2 a, G3 a)

| # | Question | Michael's answer | Recorded as |
|---|---|---|---|
| G1 | Do the ten standing assumptions match his memory of RH? | a | **Confirmed by Michael.** The ten items listed as standing assumptions under batches 2 and 3 are no longer [ASSUMPTION]: the hero strikes first; every fight starts at full life and survive-death charges reset per fight; a new run can be started at any time; a fight the player cannot afford cannot be started; `*` after an enemy's level marks a bonus enemy; base crit is 10% chance and 150% damage; no set bonuses; no rarity tiers; "doesn't stack" means the highest equipped value wins; v1 uses the kickoff's stat list. |
| G2 | How much of the GDD's zone and enemy-family section may he read? | a | **Ruling.** Structure only in the GDD: level bands, counts, element and type mechanics, gate types. Zone themes and all names go in a sealed appendix he does not open. |
| G3 | Anything from the two other games to never copy? | a | Nothing beyond the kickoff's hard rules. |

### Open items carried into Phase 1

All of these are now in GDD section 12 (O-01 to O-07, O-09, O-10), section 11 (install address), question P2 (slice shop) and section 6.3 (engine arithmetic rule). The list below is the Phase 0 record.

- [OPEN] XP needed per level in RH. Steadfast sets its own formula, calibrated to the enemy XP curve and Michael's reported levels.
- [OPEN] RH's accuracy and evasion curves between the published points; single-point fits are in the calibration notes.
- [OPEN] RH's archaeology chance formula. One data point: 65.20% at 3,750,974 gold with highest kill 42,000.
- [OPEN] Gem drop rates and teleport prices in RH. One series: 163, 61, 168, 427 gems held at four points in the playthrough.
- [OPEN] Base starting energy in RH: a review cited in the recap says 20 [GPT]; Michael reported 25 before using the permanent-energy tool, which may include an accessory.
- [OPEN] Whether RH's energy-granting accessories apply at run start only or on equip.
- [OPEN] Total hours Michael spent in RH (30 days elapsed; hours not asked).
- Decision due before Phase 3a's first install: the install address. Michael asked how a custom subdomain works and said he is open on names (2026-10-12). Recommendation given: skip a bought domain (yearly cost, and a lapsed domain hands the installed app's address to whoever buys it) and instead create a free GitHub organization named after the game, which gives the app its own `<org>.github.io` origin, separate from his other project sites. Not yet decided. The name follows from the five proposals in Phase 1.
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
  - Defense, verified rather than inferred: reduction = D ÷ (D + E) in both directions. Using the two late bosses' damage and defense from the data files, it gives 22.0% and 78.1%, then 11.4% and 93.1%, against displayed values of 22%, 78%, 11% and 93%. The enemy's separate damage-reduction trait is not part of the "defended" figure.
  - Crit: Dexterity 1,575 showing 21% chance and 172% damage fits the published Dexterity rule exactly with a 10% base chance and a 150% base damage.
  - Accuracy: accuracy about 1.74× (enemy level + 100) showed 97% to hit; a miss chance of 10% × ((level + 100) ÷ accuracy)² fits that one point. In both late screenshots accuracy is exactly 1.75× Dexterity and evasion exactly 1.00× Dexterity, so item accuracy and evasion values look like percentage modifiers on a Dexterity-derived base [OPEN].
  - Evasion: evasion at 37× and 51× enemy level showed 51% and 56% to dodge, roughly +26 points per 10× above the published 10% point, under the 80% cap.
  - Stat points: bases at level 1.8e10 are consistent with roughly 5 stat points per level before per-level gear, with a Life point worth 3–4× a point of the other stats.
- Michael's RH timeline from the chat dates (2026-09-06 to 2026-10-06): strongest enemy level reached about 42k by day 3, 450k by day 5, 3M by day 11, 36M by day 17, 1.3B by day 22, 4.4B by day 26, full completion on day 30. Roughly 10× in enemy level every 3–4 days, and about 1.2 zone sections, 15 enemies and 22 items per day.
- The final boss's battle cost on screen (12) is one more than its energy value in the data (11), which is what led to the cost-and-payback model Michael confirmed in batch 1.

## Starting a fresh session

For Phase 3b, read in order: `CLAUDE.md`, this file, `docs/ARCHITECTURE.md` (section 14 first: it says what exists), then the Phase 3b section of `docs/KICKOFF.md` and `docs/GDD.md`. `docs/sealed/` is needed from Phase 3b on, for authoring content only. `reference/` is needed only to check a claim about RH; start with `reference/_claude_phase0/README.md`, which is private and gitignored.

## Judgment calls

Calls made without asking, so Michael can overrule them. Design decisions move to the GDD decisions log once it exists.

- 2026-10-12: Initial branch is `main`; first commit made directly on it (no prior branch exists to branch from).
- 2026-10-12: Judgment calls are logged here rather than in a separate implementation-notes file, to keep to the kickoff's three sources of truth (hard rule 6).
- 2026-10-12: Added `.gitattributes` forcing LF, because checksummed save fixtures and golden replay hashes must be byte-identical on this Windows machine and on Linux CI.
- 2026-10-12: `.gitignore` also covers `.env*` and `*.local` now, ahead of the Phase 5 token work, because the repo will be public (hard rule 7).
- 2026-10-12: Read ChatGPT's side of the transcripts through the recap and targeted lookups rather than end to end; every claim there needs Michael's confirmation anyway.
- 2026-10-12: This file is public, so it paraphrases the private recap and cites chat numbers instead of quoting it. The same will apply to the GDD unless Michael says otherwise.
- 2026-10-12: Interview batches are posted as plain text so conflicts between sources can be shown side by side; answers can be given as "1a 2b …".
- 2026-10-12: Added `reference/_claude_phase0/` (private, gitignored) as the second half of the handoff, because the evidence it holds uses RH names and Michael's private chat history and so cannot live in `docs/`. It is additive; nothing Michael put in `reference/` was changed.
- 2026-10-12 (Phase 1): The sealed appendix is a separate file, `docs/sealed/gdd-appendix-content.md`, not a section of `docs/GDD.md`, so Michael can read the whole GDD without scrolling past spoilers. `.gitattributes` hides that folder's contents in diffs and it is committed separately from the GDD.
- 2026-10-12 (Phase 1): Element and enemy-type names are sealed along with zone themes, because a tag's name gives away its zone's theme. The GDD uses E1–E3 and T1–T4.
- 2026-10-12 (Phase 1): The batch 1 persist/reset ledger was not in this file, so it was recovered from the Phase 0 session's own transcript and is now GDD section 2.5.
- 2026-10-12 (Phase 1): Every Steadfast number in the GDD is marked "starting value". A throwaway expected-value model checked only that the formulas can produce the wall-and-breakthrough shape; it was not kept, and the GDD says it is not evidence for the pacing targets.
- 2026-10-12 (Phase 1): Name checks used web search for existing games and GitHub's public API for free organization names. Neither touches RH sources.
- 2026-10-12 (Phase 1): Design decisions made without asking are GDD D-01 to D-20, so they are not repeated here.
- 2026-10-12 (Phase 1): Dropped the pre-fight "details" fold from the first draft. It went beyond the three clarity additions approved in Q11.
- 2026-10-12 (Phase 1): Fight cost is 1 through Z6 and 2 in Z7–Z8. RH stays at 1 until about level 1 million (Michael's turns), which would make all of v1 cost 1; it rises once near the end of v1 so the rising-cost rule from Q2 is exercised.
- 2026-10-12 (Phase 2): Architecture decisions made without asking are `docs/ARCHITECTURE.md` A-01 to A-11, so they are not repeated here.
- 2026-10-12 (Phase 2): Hard rule 1 now says a ruling is not a confirmed fact about RH, and hard rule 6 names ARCHITECTURE as a fourth source of truth. Both keep the kickoff's meaning; neither loosens it.
- 2026-10-12 (Phase 2): `CLAUDE.md` points to `docs/ARCHITECTURE.md` section 3 for file-level roles, because a file-by-file map would not fit under 8,000 characters and no source file exists yet.
- 2026-10-12 (Phase 2): The "update ready" tap lives only on the new-run sheet, which is the kickoff's "apply it between runs". Settings shows that an update is waiting but does not apply it.
- 2026-10-12 (Phase 1): After the verifier's re-check, a Claim was set to 3 energy against an unclaimed boss's surplus of 2, so that a Claim is never worthless. Both numbers are within what the sources give for RH (2 [WEB], 2–3 from Michael's notes).
- 2026-10-12 (Phase 3a): Architecture decisions made without asking are `docs/ARCHITECTURE.md` A-12 to A-22, so they are not repeated here.
- 2026-10-12 (Phase 3a): Three checks in the enforcement map were not built, because they need game content and this phase was told not to open `reference/` or the GDD outside sections 2.5, 6 and 8: `check-content`, the reference-name test, and battle replays. `CLAUDE.md` and `docs/ARCHITECTURE.md` section 14 say so. `npm run sim` is likewise Phase 3b.
- 2026-10-12 (Phase 3a): The run-duration log is left out of save version 1 and arrives with real runs in version 2, which is a migration either way.
- 2026-10-12 (Phase 3a): `data/dummy.json` sits on a sealed path, so it was committed on its own, as the rule for sealed content says, though it holds no spoiler.
- 2026-10-12 (Phase 3a): The icon is placeholder art, three rising bars, drawn by a throwaway script that was not kept.
- 2026-10-12 (Phase 3a): An export counts as made when the share sheet reports success, the file is downloaded, or the text code is copied. A cancelled share does not count.
- 2026-10-12 (Phase 3a): The share sheet is offered the file as JSON first and as plain text second, since browsers differ in which types they take. Which one the phone takes is one of the open points.
- 2026-10-12 (Phase 3a): Michael was told during the build that if the repo existed when the local build passed, it would be added as the remote and pushed. It did, and it was. He was told he could say he would rather push himself; he did not reply either way before the push.
- 2026-10-12 (Phase 3a): `.claude/launch.json`, which starts the local preview for the browser pane, is gitignored.
- 2026-10-12 (Phase 3a): No DOM library was added for tests. The startup and recovery wiring is tested against a small stand-in in `tests/fake-dom.ts`.

## Handoff

- **Done:** Phases 0 to 2 approved. Phase 3a built: `src/`, `data/`, `tests/`, `scripts/`, the hook and the CI workflow, with `CLAUDE.md`, `docs/ARCHITECTURE.md` (decisions A-12 to A-22 and section 14) and this file brought in line. The built app was run in a browser on the laptop. A separate verifier failed the first build, passed the second, and passed a third, narrow look at the fixes made after that.
- **Worked:** Asking the verifier to prove a suspected hole with a throwaway test through the real entry point. That is how it found the lost save, which no unit test of mine could have: each function was right and the wiring was wrong. Tests that lint or compile a deliberate violation, so a check that stops firing fails the build. Building labelled versions with `FS_BUILD_ID` and serving them with `npm run preview` to try the update flow on the laptop. Closing the last tab in the browser pane to stand in for a force-quit.
- **Failed:** The first build lost a save on the recovery screen after an unreadable start. The rule for absurd `seq` values took four attempts: the verifier caught two of the wrong ones and I caught one. Two of my tests could not fail for the reason in their titles. Traps: shell heredocs break on apostrophes here, so write patch scripts with the Write tool and run the file; `cd` inside a Bash call moves the session's working directory; Python prints in cp1252 unless run with `-X utf8`; `CLAUDE.md` has 13 characters to spare; a scratch script must sit inside the repo for `node_modules` to resolve; `happy-dom` 21 and TypeScript 7 were days and months old on 2026-10-12 and were passed over for that reason; the first word on the recovery screen's list ("Run 2") can match a test that is waiting for the game screen.
- **Next:** Wait for "approved". Michael's phone run may come back with failures: treat each as a Phase 3a fix, not Phase 3b work. Then Phase 3b, starting with save version 2 and its migration, so the first real migration runs on a phone whose save does not matter yet.
