# STATUS

Re-read this file at the start of every session and every work cycle. Update it at every gate and before any session ends.

## Current phase

**Phase 5 has begun; nothing is built.** It started on 2026-10-13 in a new session, from the prompt Michael was given after he approved Phase 4. Its first commit records the Phase 4 push's CI run and the check of the live site, under "Phase 5 working record"; it and the commits after it are held and go out with 5a's push, so that recording them does not ship one more version to his phone. The plan is agreed: three parts, each ending at a gate ("Phase 5 plan and success checks"). Next: the backend for the cloud backup is put to him as one question, with what he asked to be told about the credential, and 5a is built once he has answered. He has been asked what his phone shows under the charged-loss rule and has not yet said. Phase 5 is cloud backup and then content expansion.

**Phase 4 approved.** Michael approved Phase 4 on 2026-10-13 with the words "a, approved": base starting energy stays 20 (GDD R-14), and the gate is passed (R-15). He had ruled earlier the same day that a lost fight is charged, as in RH (R-11). The simulator, what it found (GDD 13.7), the verifier pass, the re-check and their fixes are under "Phase 4 working record". Phase 4 went out as one push of five commits, made after he had been told what it changes.

**Spoiler rule for every session.** `docs/sealed/` holds zone themes and all content names. Michael does not open it. Never quote anything from it in chat, gate reports, commit messages or this file. Refer to zones as Z1–Z8, elements as E1–E3 and enemy types as T1–T4. What kind each optional secret is, and where, is sealed too: say "an optional secret".

## Phase 5 plan and success checks

**Proposed to Michael on 2026-10-13, before any work, and agreed the same day.** His first reply was "Can you explain your question a little more clearly to me". The question was then put again in plain terms: how many times the work stops for his "approved", three times (a, recommended) or twice (b), with the two lists of checks named as promises and not choices, which a letter would accept as written. He answered "A". **Read as:** the split below with its three gates, and the success checks as they stand. The second half is a reading: he was told a letter would accept them and said nothing about any one check. Each gate report marks its checks PASS, FAIL or NOT CHECKED with evidence.

### The split

| Part | What | Ends at |
|---|---|---|
| 5a | Cloud backup: a `CloudBackend` behind the `SaveBackend` interface, a backup after each run, restore through the import path, and its part of Settings | ⛔ Gate 5a, after his phone acceptance run |
| 5b | Z2 in full, tuned and measured against the three Phase 4 findings, with the Auto-assign screen, which unlocks at level 250 and so is reached inside Z2 | ⛔ Gate 5b, with what Z2 cost and how many more zones are proposed |
| 5c | The zones he agrees to at gate 5b, with the systems they bring: waypoints start at Z3 | ⛔ Gate 5c |

- **Questions before building 5a, one at a time:** the backend, with a recommendation; then where the credential lives on the phone, who can read it, what a leak or an expiry does to his save, and what he does by hand.
- **Pushes:** one for 5a's build ahead of his acceptance run, which also carries this record; one for Z2 at gate 5b. Each goes after he has been told what it changes and while no question is open. A further push only for something his phone finds.
- **Before each gate report:** a separate verifier pass that returns pass or fail with evidence; its corrections are tested as hard as the claims they correct; a check is recorded once it has returned.
- **5c's checks** are stated at gate 5b, for the zones agreed then.

### Success checks, 5a: cloud backup

1. `npm run check`, `npm run build` and `npm run check:dist` pass. `tests/golden/golden.json`, both save fixtures and every file under `data/` are the same bytes as at `06af802`.
2. No save-data change unless one is forced. The credential, the backup's settings and its status are kept in the `device` store, which is outside every save, so `SAVE_VERSION` stays 2 and the schema-hash test does not move. If the build shows that a save field is needed after all, he is told before it is added and it follows the save-change checklist: version 3, a migration, a fixture, and fixtures 1 and 2 still loading.
3. The local save stays the source of truth. Tests through the real `startApp`, with a backup that never answers, one that rejects, one that throws at once, and one that answers each of 401, 403, 404, 409, 422 and 500: in every case the new run's checkpoint and hot slot are committed before the backup is tried and are the same bytes as with backup off, the next input is taken without waiting for the backup, and the backup code makes no write to the `slots` store. Reworded after the tests were written, 2026-10-13: the last clause is true of the backup itself and was loosely put. Three buttons, "Back up now", "Save the key" and "Overwrite", first ask the game to save what it has not yet saved, through the game's own writer, as hiding the app does, and what they then send is that saved record.
4. A backup after each run. Confirming a new run with backup on sends exactly one upload, of the newest good record, and what is sent passes that record's own checksum. Against a stand-in server. "Good" is meant as section 7.3 of the architecture means it: a run whose checkpoint was skipped for failing a consistency check sends nothing (GDD D-44). The first build sent it regardless, and the tests' author caught the difference.
5. A failure shows and does not block. Settings gives the last backup that worked, by run and time, and the last attempt's result in plain words, told apart for offline, credential refused or expired, and backup place not found. A reminder that does not block play appears only for a failure he has to act on, not for being offline.
6. Restore is an import. What comes back from the backup goes through the same checks and confirmation as an imported file: a damaged or newer record is refused, the two saves are shown side by side, and the current game is set aside first. A test restores a damaged backup and finds every local record the same bytes as before.
7. The credential stays where it was put. A test sets it to a marker and finds the marker in no slot record, export file, text code, quarantine copy, diagnostics entry (a failed request included) or backup body. `check-repo` finds no token pattern; tests make their stand-in credential at run time.
8. One address and no more. The content security policy gains exactly one source under `connect-src`, pinned in `vite.config.ts` and in `scripts/check-dist.ts`; the build scan's allowed addresses gain exactly that one; an enforcement test shows a second address fails. A test shows the service worker neither answers nor caches a request to it.
9. With backup off the built app behaves as build `06af802` does, and in the browser pane no request leaves the site.
10. A separate verifier pass, told to find a way for the backup path to lose, change or hold up the local save, and a way for the credential to leave the phone. Pass or fail with evidence.
11. His acceptance run on the phone, with Spotify playing, each step marked: a manual export saved to Files first, as the safety net; the credential entered by him; a finished run shows up in the backup, where he can see it for himself; a run finished in Airplane mode is not held up and Settings says the backup did not go; the next run online backs up; the app deleted; reinstalled; the credential entered; restored; the Run and Settings readouts match the ones he noted before deleting; the self-test reads 13 of 13; Spotify never paused.
12. The gate report is posted and work stops.

The verifier pass was also given, as its own check, the rule the build added on the way: a backup the game on the phone did not come from is never replaced without asking (GDD D-40). It is not one of the twelve agreed above. It failed that check, and the gate report says so.

### Success checks, 5b: Z2

1. The three commands pass. `check-content` passes with `data/content-spec.json` at Z2's full counts from GDD 7.5: 11 enemies, 2 of them bosses. The ID lock only grows.
2. What he ruled stays (R-12, R-14). Base energy, the energy rule and Z1's row of the zone table are unchanged, and every Z1 enemy, item, drop and map tile is the same as at `06af802`, shown by a comparison by ID. Any other existing number in `data/balance.json` that tuning moves is listed in the gate report with before and after and has a decisions-log entry; a golden value changes only with one.
3. His save carries over. A save written on build `06af802`, with the hero past the Z1 gate, loads on the new build with `profile` the same bytes and a run that is valid. If a save field is needed, the save-change checklist.
4. Tuned against three players on two sets of seeds: `climb-then-collect`, `cautious` and `like-michael`, at least 200 players each. Tuning looks only at seeds 1 to 200. It stops when both careful players' median runs per Z2 wall is inside 4–6, or after six tuning passes, whichever comes first, and the numbers are then frozen. Seeds 5001 to 5200 are run once after the freeze and reported whatever they say. Every figure is a median with its 10th and 90th percentiles, every comparison a mean difference with its standard error, and the share of players over 8 runs is given for all three. Aiming 4–6 at the careful players, with the Phase 3b player reported beside them, is a reading of his instruction. It was named as a reading in the plan put to him and he raised nothing against it, which is not a ruling.
5. No wall hangs on one drop. A probe gives, for each Z2 boss, the level at which it falls in the zone's reference loadout and with each single item taken out; an item whose absence puts that level past what a run in the zone reaches is a key item. Each key item has at least two ways in besides Salvage, or the gate report says why not. From `runs.csv`: the share of gate falls with each key item owned, and the win chance at the gate at the end of the runs before the breakthrough, beside Z1's.
6. The first Claim. `--probes` with Z2's reference loadout gives the level at which the tool beats each boss. The simulator gives, for each player and seed set, the run of the first Claim and the share of players who make one before Z2's gate falls. The gate report says in one sentence when the tool first sees use.
7. `goldAt`: `--probes` names no Z2 shop item priced inside the dip at the Z1–Z2 edge, levels 41 to 53, or the gate report lists each one.
8. The retry guard is read on gate falls, for each player, at Z2's walls.
9. The rows of GDD 5.9 that Z2 makes measurable are reported: runs per zone for Z2, wins per run, modelled minutes per run, hero level over strongest enemy, runs with a persistent gain, the breakthrough run, and kills per drop.
10. Auto-assign is built to GDD 8.2: the unlock at the level in `data/balance.json`, the screen, and tests for it on and off. Seen in the browser pane.
11. Content. The reference-name test and the name scan pass. A separate content verifier reads the sealed files against the sealed naming rules and returns pass or fail. Nothing sealed is in chat, a commit message, this file or check output.
12. What Z2 cost is measured as Z1's was: authoring passes, tuning passes, verifier rounds and simulator time. It is reported at the gate with the number of further zones proposed and what each is expected to cost. Nothing past Z2 is authored before he answers.
13. A separate verifier pass that recomputes the figures from `runs.csv` with its own script. The gate report is posted and work stops.

### What Phase 5 can and cannot settle

- **The credential is never Claude's to hold,** so no check against the real backup service can be run on the laptop by Claude. The stand-in server covers the code; the real service is covered only by his hands, at check 11.
- **Deleting the app deletes the local save.** The acceptance run deletes it on purpose, with real progress on it. The manual export in its first step is what makes a failed restore cost nothing.
- **Z2 has two bosses and a fight cost of 1.** The energy rule at a fight cost of 2 stays unmeasured until Z7.
- **`like-michael` is a fitted player, not him.** A zone tuned to it and to `cautious` is tuned to careful play, which is the most that one recorded playthrough supports.
- **Michael does not see content.** Whether Z2 is good to play is for his phone to say after gate 5b's push.

## Phase 4 success checks

Stated to Michael before the work began, 2026-10-12. The gate report marks each PASS, FAIL or NOT CHECKED with evidence.

1. Nothing shipped moves before he rules: `npm run check`, `npm run build` and `npm run check:dist` pass, and `tests/golden/golden.json`, both save fixtures and every existing number in `data/balance.json` are the same bytes as at `e57f9f6`.
2. The switch works both ways: one boolean under `energy` in `data/balance.json`, default off. Tests show that off, a loss charges nothing; on, a loss charges the fight's cost, a retry charges again, and energy never goes below zero. The UI lines that state the rule follow the switch.
3. The simulator does what the kickoff asks: named strategies with their settings in a file, N runs, a CSV with one row per run (run number, level, power, zone reached, gold, drops), and a markdown summary with a row for all 19 rows of GDD 5.9, each marked met, not met or cannot be measured in the slice. Tests pin the columns, the row count and that the same seed gives the same bytes.
4. Both rules, same targets: each rule simulated with the same strategies and seeds, at least 200 players each, then tuned; a side-by-side table; one question with a recommendation. Where a rule cannot reach a target with the knobs there are, the table says which and why.
5. Calibration against Michael's playthrough, with a stated test. A strategy "reproduces" him if run 10 for the gate falls inside its 10th to 90th percentile, his level at the end of runs 2 to 9 is inside that band on at least 6 of the 8, it takes 4 or 5 tries at the boss on the run it falls, and its modelled run time lands in 1:50 to 3:24. The verdict is reported either way.
6. Each carried-forward item ends in a number: the long-shot retrier and the cautious player, the wall's tail (content or player), `goldAt` at all seven zone edges, and the first Claim.
7. A separate verifier pass returns pass or fail with evidence.
8. The gate report is posted, work stops, and nothing is pushed until Michael has been told what the push changes.

### What Phase 4 can and cannot measure

Told to Michael before anything was built. Only Z1 and two Z2 enemies exist.

- **Can measure:** runs per wall, runs in Z1 and the longest wall, for the one wall there is; wins per run, early; hero level over strongest enemy; runs with a persistent gain, up to the wall's fall; wins needing more than 3 tries; expected kills per drop for Z1's drops.
- **Can model, not measure:** minutes per run in Z1–Z2 and seconds per fight. His nine recorded run times are the only real measurement.
- **Partly:** the breakthrough run. Only 3 first kills are possible past the wall, so the target of 3 needs a perfect run.
- **Cannot measure:** minutes per run for Z3–Z5, Z6–Z8 and late full scope; wins per run by the end of v1; runs per zone Z2–Z8; walls in v1; runs to finish v1; play time for v1 and for full scope.
- **The energy ruling rests on one wall,** at fight cost 1, about 20 energy and one boss. How a charged loss plays at cost 2, or with 18 bosses paying energy back, cannot be simulated until those zones exist.
- **The first Claim cannot be played:** it needs about level 300 and the slice tops out near 50. The level at which the tool beats the Z1 boss can be computed, as a projection with Z1 gear only.
- **Michael is one player.** A strategy that matches his playthrough is plausible, not proven.
- `goldAt` at zone edges is a pure formula, so it is fully checkable for all eight zones.

## Phase 3b success checks

Stated before the work began. The gate report marks each PASS, FAIL or NOT CHECKED with evidence.

1. `npm run check`, `npm run build` and `npm run check:dist` pass.
2. The version 1 fixture migrates to a good version 2 record; the version 2 fixture loads with no migration and writes back the same bytes; a version 1 hot slot started through the real `startApp` opens the game at run 1 with the old record kept as a set-aside copy.
3. The built app is played end to end in a browser: walk, fight, level, allocate, equip, buy, Salvage, run out of energy, new run, and a later run that beats the Z1 gate boss and is handed the tool, with Z2's first enemies in view.
4. `check-content`, the reference-name test and the battle golden replays exist, and each is shown to fire on a deliberate violation.
5. `npm run sim -- --runs 50` reports level, zone reached and runs to breakthrough against GDD 5.9.
6. A separate verifier pass returns pass or fail with evidence, including the content.
7. The gate report is posted in two parts, with what one zone cost to author, and work stops.

Result: 1, 2, 4, 5 and 6 PASS on the laptop, with the evidence under "Phase 3b working record". 3 is PASS with one qualification: the app was played by script, and the breakthrough run began from a simulator-made save with the missing reference gear handed over (see "Judgment calls"). 7 is the gate report itself. Check 3 has since been met by hand as well: Michael played the installed app on his phone from run 1 through the Z1 gate, which fell on run 10 (see "Phone review").

## Todo

### PENDING

- [ ] Phase 5: what Michael's phone shows under the charged-loss rule: asked on 2026-10-13 for the Build line, the pre-fight sheet's cost line and a lost fight's energy line, not yet answered
- [ ] Phase 5a: cloud backup. The backend choice goes to him as one question with a recommendation; before building he is told where the credential lives, who can read it, what a leak or an expiry does to his save, and what he does by hand. Ends at a gate with a phone acceptance run: back up, delete the app, reinstall, restore
- [ ] Phase 5b: content expansion, Z2 first, meeting the three findings under "Carried forward to Phase 5". Before anything past Z2 is authored he is told how many zones are proposed and what each costs

### COMPLETED

- [x] Phase 5: the Phase 4 push's CI run and the check of the live site written down, both read again in this session (2026-10-13)
- [x] Phase 5: success checks, the split and the gates put to Michael before any work; agreed with his "A" (2026-10-13)
- [x] Phase 5a: the backend put to him as one question, with what he asked to be told about the credential; answered "a", a private GitHub repository (2026-10-13)
- [x] Phase 5a: whether the key ever expires; answered a, never (2026-10-13)

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
- [x] Phase 3a: gate questions answered (1 a, 2 a); third verifier pass and its fixes
- [x] Phase 3a: Michael's phone acceptance run, every step reported as passing (2026-10-12); all phone readouts recorded in `docs/ARCHITECTURE.md` section 13
- [x] Phase 3a: approved by Michael, 2026-10-12
- [x] Phase 3b: save version 2 settled: state, schema, pure migration from version 1, invariants, fixture, run-duration log; `data/dummy.json` removed
- [x] Phase 3b: engine built: math, formulas, battle, forecast, reducer, run repair, pathfinding, allocation policies
- [x] Phase 3b: content schemas and loader; `balance.json`, `content-spec.json`, the ID lock; sealed slice content (Z1 and a glimpse of Z2)
- [x] Phase 3b: simulator built; slice tuned against GDD 5.9, changes logged in GDD 13.5
- [x] Phase 3b: the screens of GDD 8.2 that the slice needs; map view with both controls; battle playback
- [x] Phase 3b: `check-content`, the reference-name test (1,169 hashes), battle golden replays in the self-test
- [x] Phase 3b: the built app played by script in a browser: fights, levels, shop, gear, Salvage, an optional secret, new run, import, the version 1 migration, the wall, its fall, the tool handover, Z2 and the sealed door
- [x] Phase 3b: GDD, ARCHITECTURE and `CLAUDE.md` brought in line
- [x] Phase 3b: engine tests written from the GDD, save tests and UI wiring tests, each by a separate pass; their fixes applied
- [x] Phase 3b: two verifier passes, content and then saves, engine and wiring; findings fixed, one left by choice
- [x] Phase 3b: `npm run check` and `check:dist` green; first 3b push; gate report posted ⛔ in two parts, with what one zone cost to author
- [x] Phase 3b: Michael's review on his phone, six steps, each recorded with evidence; five changes from it built, pushed as `6711b80` and confirmed on the phone
- [x] Phase 3b: approved by Michael, 2026-10-12
- [x] Phase 4: success checks and what the phase can and cannot measure stated to Michael before any work (2026-10-12)
- [x] Phase 4: the energy switch in `data/balance.json`, off at the time, with engine and label tests for both positions
- [x] Phase 4: simulator rebuilt: strategies and variants from files, the rule as an option, CSV, markdown summary against every row of GDD 5.9, worker processes, 44 tests
- [x] Phase 4: calibrated against Michael's playthrough: the Phase 3b player does not reproduce him, and no strategy does on two sets of seeds
- [x] Phase 4: both energy rules simulated at 200 players each and tuned to the same targets; findings in GDD 13.7
- [x] Phase 4: carried forward: the long-shot retrier and the cautious player; the wall's tail; `goldAt` at zone edges; the first Claim
- [x] Phase 4: GDD and ARCHITECTURE brought in line; `CLAUDE.md` needed no change
- [x] Phase 4: Michael's rulings, 2026-10-13: charge a loss (R-11); no retuning (R-12); his account of the gate run recorded (R-13)
- [x] Phase 4: rulings applied: the switch on, one golden value rewritten, tests and documents in line; three of the four lines that state the rule seen in the browser
- [x] Salvage from the Run tab on the phone: Michael reported on 2026-10-13 that he tried it and it worked
- [x] Phase 4: a short separate re-check of the fixes and of the rule change: the rule change and the figures held; it failed the write-up on the first Claim and on a reading recorded as a ruling; both fixed
- [x] Phase 4: gate report posted; gate question answered (a: base energy stays 20, GDD R-14)
- [x] Phase 4: approved by Michael, 2026-10-13
- [x] Phase 4: separate verifier pass (2026-10-13): figures confirmed, three checks failed on what was written about them; the write-up corrected, the weak tests replaced, a sweep of base energy added

## Phase 5 working record

### The Phase 4 push, recorded (2026-10-13)

Both checks below were read again in the Phase 5 session, before this was written, and agree with what the Phase 4 session reported to Michael in chat.

- **The push:** `main` at `06af802`, five commits: `8e7de3a`, `7e769ad`, `bbc9710`, `f5faf73` and `06af802`.
- **CI:** run 38408310068, the repo's tenth, for the push whose head is `06af8027a114f81f5e7374b76e26fcd36be8b592`. Completed with conclusion `success`; the `check` job succeeded at 13:51:21 UTC and the `deploy` job at 13:51:43 UTC on 2026-10-13. `https://github.com/farther-still/farther-still.github.io/actions/runs/38408310068`. Read from GitHub's REST API. PASS.
- **The live site:** `https://farther-still.github.io/` answered 200. The one script the page asks for holds that full commit hash as its build, the balance table inside it has `chargeLosses` on, and the page carries the pinned content security policy, `connect-src 'self'` included. Read with curl. PASS.
- **On Michael's phone:** NOT CHECKED. He is asked what the pre-fight sheet's cost line and a lost fight's sheet say.

### 5a: Michael's answers (2026-10-13)

| # | Question | Michael's answer | Recorded as |
|---|---|---|---|
| 1 | Where the backup copies are kept: (a) a private repository on GitHub, recommended, or (b) Supabase's free tier | "a" | **Ruling.** A private GitHub repository, written through the contents API with a fine-grained token limited to that one repository. He was told in the same message where the key lives on the phone, who can read it, what a leak or an expiry does to his save, and what he does by hand, and asked nothing further about them |
| 2 | Whether the key ever expires: (a) never, recommended, or (b) after a year. Put to him while 5a was being built, since nothing in the code hangs on it | "The answer for that is a" | **Ruling.** The key is made with no expiry (GDD R-17). He was told with the question that the backup repository would then go on his personal GitHub account and not in the `farther-still` organization, where keys are capped at 366 days by default. Told later that this half was a default and not his ruling, he replied "Personal account is fine": **Ruling.** The backup repository is on his personal account. It is in GDD R-17 |

### 5a: what was built (2026-10-13)

`docs/ARCHITECTURE.md` section 7.5 describes it as built, and `docs/GDD.md` sections 11 and 13.8 hold its rules and the decisions made on the way (D-38 to D-43, A-38 to A-43).

- **The backend.** `src/save/cloud.ts`: `GitHubBackend`, one file in a private repository through GitHub's contents API. `src/save/backup.ts`: `CloudBackup`, which decides when a backup is tried and keeps the key and its notes in the `device` store. `src/save/succession.ts`: whether one save may take another's place in the backup without asking, worked out from the two saves.
- **The wiring.** The controller tells the backup of a new run through a hook called after the commit and not awaited. Startup builds the backup with the `device` store and the network and nothing that can reach a slot.
- **The screens.** A "Cloud backup" part of Settings; a sheet for the key; restore, which hands the file to the import that already exists; a sheet for overwriting a backup that was left alone; a reminder on the map for a failure he has to act on.
- **The one address.** `connect-src` in the content security policy names `https://api.github.com`, pinned in `vite.config.ts` and `scripts/check-dist.ts`, and the build scan allows that host and no other.
- **What did not change:** the save (still version 2, no field added), both fixtures, every golden value, everything under `data/`, the engine, the simulator.
- **Left as they are, by choice:**
  - A new run started with "Update, then start the run" reloads the page at once, which can cut its backup short. The next finished run backs up, and "Back up now" is in Settings.
  - Nothing is backed up between runs. The backup is at most one run behind the phone.
  - `CLAUDE.md` is unchanged. It stands at 7,999 characters of 8,000, so the enforcement map has no row for the backup; `docs/ARCHITECTURE.md` section 11 lists the checks.
  - Whether GitHub lets the contents API create the first file in a repository with no commits was not looked up. The steps he is given make the repository with a README, so the question does not arise.

### 5a: the tests written by a separate pass, and what they found (2026-10-13)

A separate agent was given the success checks and the code, and told to find where the two disagree and to break the code against its own tests. It was not shown this file's conclusions. It wrote `src/ui/backup.test.ts`, which drives the real `startApp` against a stand-in for the service, and added to the controller's and the service worker's tests. It changed no source.

- **What it covered:** checks 3 to 9 through the real app start, the controller's hook and the service worker. It tried 48 deliberate breaks of the source; all 48 failed a test once it had strengthened one test of its own.
- **What it found, and what was done.** It left three tests marked as expected to fail and one holding the behaviour it doubted. All four were then fixed by the author, and the marks came off:
  - **A new game from the recovery screen replaced this install's own backup.** The guard knew the install and not the game. Its first finished run put a run-2 game where a run-41 game had been. An imported save and an older save picked on the recovery screen went the same way. The first fix made any way out of the recovery screen, and any save put in the game's place, drop the install's claim on the file. The verifier pass then showed that fix was not enough, and the claim itself was removed (below).
  - **A restore's answer opened its confirmation over whatever sheet was up by then.** The restore now has a sheet of its own while it waits, and an answer that finds another sheet in its place is dropped (A-45).
  - **A key with a character a browser cannot send was stored, and every backup then read as "offline" with no reminder.** A key is now cleaned of what a paste picks up, and one that still holds such a character is refused where it is typed.
  - **A run whose checkpoint was skipped was sent anyway, in place of the last good backup.** Check 4 said "newest good record" and the code sent the newest record. The backup now follows the checkpoint's rule (GDD D-44).
- **What it found in the checks' own wording:** check 3's "no write to the `slots` store" is true of the backup and not of three buttons that first ask the game to save; check 11's "readouts match" depends on when he notes them, since the backup is the save as the run began. Both checks are reworded above or in the steps he is given.
- **Fixed by the author afterwards, and tested by the author:** the four fixes, with fourteen tests of them. Ten further breaks of the fixes each fail a test; one did not at first, and a test was added for it. Whether the fixes hold is for the verifier pass to say.
- **It could not check:** the real service; `npm run build` and the build scan, which were not in its brief; the update that reloads the page as a run starts; and whether iOS offers to keep what is typed in the key's box in its own password store, which would be a place the key is that the tests do not look.

### 5a: verifier pass (2026-10-13): FAILED, and what was rebuilt

A separate agent was given commit `676294a`, the eleven checks and the instruction to find faults. It was told not to read this file beyond the success checks. It ran the checks, traced the paths, wrote its own tests, and broke the source 69 ways.

- **Its ruling.** Checks 1 to 7 and 9 PASS. Check 8 FAIL on the build scan and PASS on the rest. Check 10, that a backup the game did not come from is never replaced without asking, FAIL. Check 11, that the documents match the code, FAIL. It found no way for the backup to delay, change or lose the save on the phone, and no way for the key to leave it.
- **What failed check 10.** Five ways an automatic backup could overwrite a backup holding a different or a more advanced game. All came from one thing: the guard trusted a note of which file this install had last written or restored.
  - Loading that fell back past a damaged record did not drop the note, so the older game's next run replaced the newer backup.
  - A restore confirmed while the key's first attempt was still reading let that attempt, which carried the new install's empty game, write over the real backup. This is the reinstall, the one case the feature exists for; it needed a slow first answer.
  - The note was dropped after the game was replaced and not before, and a failed store write was swallowed, so a failure or a kill at that moment brought the old claim back at the next launch.
  - An attempt queued before the game changed ran after it and took the file for its own again.
  - A file the service does not hand over as text read as a failure, which left backups stuck with no button to mend them.
- **What was rebuilt.** The note is gone. Whether the file may be replaced is now worked out at every attempt from the two saves themselves (`succeeds` in `src/save/succession.ts`, GDD D-40, A-39): the same game, not from an earlier run, keeping at least everything the file's save keeps between runs. Nothing stored on the phone enters into it, so there is nothing to go stale, fail to be stored, or miss a case. The backup is also tried again at once when the game is changed other than by play (D-45), which is what makes the reminder speak before a run is finished.
- **The rest of what it found, each fixed:** the build scan let through a string that only began with the allowed address, and nothing pinned its list of exceptions (A-43); "Forget the key" could fail without saying so, and an attempt on its way still wrote with the forgotten key; a refused key's reminder went away after one run finished offline; a failing store's own error text went into the diagnostics log, which could in principle repeat a key; Settings still said an export was the only copy off the phone; and twelve statements in the two documents were not true of the code, most of them about the note.
- **Its tests.** The sixteen cases it wrote are kept in `src/ui/backup.test.ts` and `src/save/backup.test.ts`, the second set rewritten against the new guard. What was changed in the first set is listed in a comment above them: a fixture, two lines that read the old note, and three expectations that had recorded a fault as seen and now record its cure.
- **Its mutations.** 57 of 69 caught; of the 12 that were not, 7 mattered. Five of those are about code that no longer exists or now have a test: a listener that throws, something thrown inside an attempt, a set-aside save restored from Settings, when Overwrite is offered, and the scan's exceptions. Two were about the note.
- **What it said of the tests:** the stand-in service answers at once, in order and always as text, so no race and no unreadable file was ever tried; one test could only fail if the exact old symptom came back; two could not fail at all. The stand-in can now hold a call at a gate and hand over a file that is not text, and there are tests of both.
- **What it could not check:** the real service, including whether iOS Safari's preflight accepts these headers with `cache: 'no-store'` and what the service answers for an expired or under-scoped key; the phone; CI. Those are for Michael's acceptance run.
- **The author's own breaks of the rebuilt guard:** 39, one behaviour each. 34 failed a test at once. Five did not: a save used "anyway" from the recovery screen being sent, a failed "Forget the key" hidden by the sheet, Overwrite offered after any attempt, the reminder's words after a run finished offline, and the build scan letting the address through between two characters that are not quotes. A test was written for each, and each of the five now fails one.
- **Fixed by the author afterwards.** A re-check by a separate agent is run on the rebuilt guard before the gate report, and its ruling is recorded here when it has returned, not before.

### 5a: what was looked up before the backend question (2026-10-13)

From GitHub's and Supabase's own documentation, read in this session. Nothing here has been tried.

- GitHub's REST API answers calls made by a page on any origin, and lets such a call carry an `Authorization` header. So an installed web app can write to a repository with a token and no server in between.
- A fine-grained token can be made with no expiry: the form's own words are that infinite lifetimes are allowed but may be blocked by a maximum lifetime policy. An organization's default policy caps a fine-grained token at 366 days; a personal account has no such policy. A token made by an organization's owner needs no approval. Whether an owner can lift the cap: NOT CHECKED, the page does not say.
- GitHub removes a token that has not been used for a year. The page says so of classic tokens; for fine-grained ones NOT CHECKED.
- Replacing a file through the contents API needs the current file's `sha`, and the call can answer 404, 409 or 422. A file of up to 1 MB is read back whole. The version 2 fixture is 2,269 bytes.
- The permission a fine-grained token needs for that call is taken to be "Contents: read and write". That is from memory, not from a page read in this session, and is to be confirmed on the token form when he makes one. Every token can also read public repositories, as anyone can.
- Supabase pauses a free project after a week of low activity. Its current documentation gives a year in which to restore one; an older announcement said 90 days.

## Phase 4 working record

`docs/ARCHITECTURE.md` section 10 describes the simulator as built, and `docs/GDD.md` section 13.7 holds what it found, with every figure. This section records how it was checked and what is still unknown.

### What Phase 4 built

- **The energy switch.** `energy.chargeLosses` in `data/balance.json`, off in the phase's first two commits and switched on by Michael's ruling (R-11). The reducer's loss branch charges the fight's cost when it is on. The pre-fight hint, the pre-fight cost line, the Defeat sheet's line and the Energy help line are all built from it (`energyWords` in `src/ui/labels.ts`, `prefightEnergyLine` and `defeatEnergyLine` in `src/ui/fight.ts`).
- **The simulator, rebuilt.** Four strategies in `src/sim/strategies.json`; the rule and a balance variant as options; `runs.csv` and `summary.md` in `sim-out/`; a test against the recorded playthrough; two probes that need no player. Players are spread over worker processes: 200 players of 16 runs takes about half a minute a configuration on this laptop.
- **Four more pacing targets** in `data/balance.json`, read by the simulator only: runs per wall, seconds per fight at default playback and with skip, and kills for a typical drop.
- **Nothing shipped changed until he ruled.** Up to the ruling: no existing number in `data/balance.json`, no sealed file, no save file, no golden value, no fixture, and with the switch off the app said and did what it did at `e57f9f6`. What the ruling changed is under "Michael's rulings and what was done about them".

### The commands behind the figures

- The main run: `npm run sim -- --runs 16 --players 200 --recorded --strategy all --rule both --variant shipped,free:energy-24,charged:energy-25 --out sim-out/phase4`.
- The second seeds, run by the verifier pass: `npm run sim -- --seed 5001 --players 200 --runs 16 --strategy like-michael,climb-then-collect,long-shot --rule both --variant shipped,free:energy-24,charged:energy-25 --out sim-out/verify1`, and the same with `--recorded --strategy like-michael,cautious --rule free --variant shipped` for the test against the playthrough.
- The energy sweep: `npm run sim -- --runs 16 --players 200 --strategy like-michael,cautious,climb-then-collect --rule both --variant energy-22,energy-23,energy-24,energy-25,energy-26 --out sim-out/phase4-energy`.
- The probes: `npm run sim -- --probes --strategy climb-then-collect,like-michael --out sim-out/phase4`.
- The figures marked "100 players" came from strategies and variants tried on the way and not kept: `--players 100 --runs 14`, a variant setting the drops `e009/i003` and `e009/i018` to 15, 20 or 25, and `like-michael` with `salvage` set to `always` and `farmAtRatio` to 1.6.
- Differences between two configurations, and the figures about one item or the win chance at the gate, were counted from `runs.csv` by throwaway scripts that are not in the repo. `runs.csv` holds a column for each thing counted.

### Verified on the laptop (2026-10-13)

- `npm run check`: PASS. Typecheck of four projects, lint, 1,239 tests in 39 files (1,159 in 35 at `e57f9f6`), content check, repo check, prose check. `npm run build` and `npm run check:dist`: PASS.
- `git diff e57f9f6 -- tests/fixtures tests/golden docs/sealed/ src/save/` is empty, and `data/` differs only in `balance.json`: one field added under `energy` and four under `pacing`, none changed, none removed. PASS for success check 1.
- The switch, both ways: five engine tests; three label tests; five tests of the two sheet lines under both positions; and one test through the real `startApp` that walks a new hero to the gate boss, loses, and finds on the pre-fight sheet and the Defeat sheet the words of the rule that ships, with the saved energy agreeing. PASS for success check 2 in tests. Seen in a browser with the switch on: NOT CHECKED. The one attempt was to flip the switch in the working copy and open the dev server, and the session's own safety check refused to touch the shipped rule before the ruling, which is the right call. If the ruling is to charge losses, the screens are looked at in the browser pane once the flip is real.
- The simulator: 66 tests. The CSV's first columns are the kickoff's, and each figure is under its own column name; the same seed gives the same bytes; the summary has a row for every row of the table in GDD 5.9, and stops on a row added, removed, doubled or holding a different number from `data/balance.json`; a variant with a mistyped path stops; each habit a strategy sets is played in the engine's small sample world, where the right answer can be worked out by hand. PASS for success check 3.
- Twenty-one deliberate rule-breaks, eighteen in `src/sim/` and three in the two sheets, each fail a test. Fourteen of the eighteen were ones the verifier pass had found no test for.

### Verifier pass (2026-10-13)

A separate agent was given the commit, the claims and the success checks, with instructions to find faults and no access to the conclusions beyond what the documents said. It ran the checks, mutated the code, recomputed the figures from `runs.csv` with its own script, and reran three strategies on other seeds.

- **What held.** Nothing shipped moved, to the byte. The switch is right both ways, and four of four engine mutations failed a test. The simulator plays through `step` and cannot cheat; one, four or seven worker processes give the same bytes. Every figure it recomputed matched, among them both tables of GDD 13.7 for all sixteen configurations. The `goldAt` table and the wall's-tail figures were right.
- **What did not.** It failed three checks, all on what was written about the figures and none on the figures.
  - The claim that `like-michael` reproduces Michael passed on seeds 1 to 200 at the edge and failed on seeds 5001 to 5200. About twenty-three settings had been tried to find it. GDD 13.7 now says no strategy reproduces him on both sets of seeds.
  - "One player in ten", "a run sooner" and "tuned until he meets 4–6" each said more than a second set of seeds or the sweep supports. They are restated as mean differences with both seed sets shown, and the tuning criterion is given as what it was: the tail, not the median.
  - The first Claim was wrong in its last sentence. The verifier's correction was that a run which reaches Z2 has already beaten the Z1 boss, so the Claim needs a waypoint and Z3. That correction was itself too strong, and the re-check below put it right.
  - One table row gave the share of runs with a persistent gain and left out that the same target was missed on its other half.
- **What it found in the tests.** Fourteen of thirty-two simulator mutations, and three of four in the UI's two lines, failed no test. The tests were added and all of them now fail one. The summary's check against the GDD covered the rows' names and not their numbers; it covers both now.
- **What it found and was wrong about:** that nothing stops `src/sim/` from shipping. The lint boundaries do, and the enforcement tests prove it (`docs/ARCHITECTURE.md` A-34).
- **Fixed by the author afterwards and not re-verified:** everything above. A short separate re-check is planned before the gate report, with whatever the rulings change.
- **It could not check:** the app in a browser under either rule; whether `like-michael`'s habits are his; anything past Z1; the sealed strings for a sentence stating the rule, which it was told not to open.
- It left a copy of the repo at `e57f9f6` in its scratch folder, outside the repo, when its own delete was refused. It is harmless, and Michael is asked whether to remove it.

### Re-check (2026-10-13)

A second separate agent was given the two commits made after the verifier pass, the fixes and the rule change, and the owner's words as paraphrased to it.

- **What held.** The rule change is complete: all checks pass with 1,240 tests, one golden value differs from `e57f9f6` and its replay holds three lost fights, nothing sealed or saved moved, and no shipped text states the old rule. Five mutations of the engine's loss branch each failed a test, and the switch's off position is still covered. Every figure it recomputed from the five `runs.csv` files matched: all 36 cells of the sweep, the four-column table on both sets of seeds, the three bullets, and the figures for base energy 21.
- **What did not.**
  - The first Claim, again. "Cannot land before Z3" did not follow from the rules: gear is kept between runs, so a later run in Z2's gear can meet the boss from the near side with the tool. GDD 13.7 now gives the levels as an upper bound and says the rest depends on gear that is not built.
  - "Just let things be how they are" had been recorded in the GDD as a ruling of no retuning, against a question that was never put to him. It is now marked as a reading there too, and the other gate questions are recorded as unasked.
  - This file said the re-check had happened before it had.
- **Smaller things, all fixed:** the shipped rule's hint and help lines were held by a pattern and not word for word; a comment in the self-test still said a loss costs nothing; the summary's guard matched "4–6" inside "4–60" and did not cover "never three in a row"; two differences were rounded down at the half; a range was stated for all players that holds for three; and "21 plays like the game he played" was generous by 0.4 of a run.
- **What it was wrong about:** that "while trying the reset buttons" was not his words. It is; the agent had been given a paraphrase.
- **Fixed by the author afterwards and not re-verified.**

### Michael's rulings and what was done about them (2026-10-13)

His reply to the two rules side by side, in his words: his gate was on run 8, and the app counted 10 because the first two runs were test runs with no fights, made while trying the reset buttons; "Just let things be how they are"; "For the rule, do a (as RH does)"; and he had already tried Salvage from the Run tab, and it worked. They are GDD R-11 to R-13.

- **The rule (R-11).** `energy.chargeLosses` is `true` in `data/balance.json`, and in the engine's sample balance, which holds the GDD's values. `npm run golden:update` rewrote one value, the run replay, which holds a loss; the other twelve did not move. The engine's loss tests, the two sheet lines' tests, the label tests and the simulator's habit tests were turned round so that the ruled rule is the default and the old one is the switch's other position. GDD sections 1, 2.1, 2.2, 3.4, 8.2 and 9, the Q2 row, DV-3 and DV-10 now state the ruled rule, and DV-10 is withdrawn.
- **No retuning (R-12).** His words were "Just let things be how they are", said unprompted and before the base-energy question was put. They are read as: base starting energy stays 20 and Z1's content stays as shipped. That is a reading, and it is put back to him in the gate report. Its one consequence he may not have meant: with a loss charged at 20 the game is a little harder than the one he played, a careful player's gate coming about a third of a run later on average with the median unchanged. Base energy 21 would overshoot the other way by about as much: on seeds 1 to 200 the gate fell on run 7 (6–10) for `like-michael`, 7 (5–9) for `cautious` and 6 (5–8) for the Phase 3b player, against 8 (6–11), 7 (5–9) and 6 (5–8) with only wins charged at 20, which is 0.42 and 0.36 of a run sooner for the two careful players and no different for the third (`--rule charged --variant energy-21`). The other things that had been listed for the gate were not asked and are left as they are on the same reading: section 5.9's retry guard that cannot fail, `goldAt` at zone edges, "no wall over 8 runs" being met at no energy, and when the first Claim lands.
- **The gate run (R-13).** His account is recorded beside the app's count and the two do not fit: the Run times list recorded under "Phone review" shows 20 wins in each of runs 2 to 8, and the Run tab's screenshot showed fights in run 1. He was told so in chat. `src/sim/recorded.json` keeps the app's count. On his account he is an ordinary careful player and the finding that his gate fell late does not apply; the others stand.
- **Salvage from the Run tab.** PASS on the phone by his report. It was the one thing the Phase 3b review had left unchecked.

Verified on the laptop after the change:

- `npm run check`: PASS, 1,240 tests in 39 files. `npm run build` and `npm run check:dist`: PASS.
- `git diff e57f9f6 -- tests/fixtures docs/sealed src/save` is empty. `data/` differs only in `balance.json`. `tests/golden/golden.json` differs in the one value.
- The dev build in the browser pane, with the laptop's own test save: the pre-fight sheet's first-time line read "Every fight costs energy, win or lose, and so does trying again. Backing out before the fight is free."; its cost line read "Costs 1 energy, win or lose. You have 20."; a fight against a level 8 enemy at "under 1%" was lost, and the Defeat sheet read "That fight cost 1 energy. You have 19 left. No gold was lost." with the status strip at Energy 19; the console held no error. PASS for those three. The fourth line, the Energy help text, was not found on the Hero screen's two tabs: NOT CHECKED by eye, covered by its label test.
- On Michael's phone: NOT CHECKED. Nothing is pushed.

### Result against the success checks

1 PASS until the ruling, which is what it asked; since then one rule and one golden value have changed, by R-11. 2 PASS, in tests under both positions and in the browser for three of the four lines. 3 PASS. 4 PASS: both rules simulated on two sets of seeds, a sweep, the table, one question, and his ruling. 5 reported: no strategy reproduces him on both sets of seeds. 6 PASS for the retrier, the cautious player, the wall's tail and `goldAt`; for the first Claim the answer is an upper bound and "it depends on gear that is not built". 7 done twice: the verifier pass failed three checks on the write-up, and the re-check failed one more; both sets of findings were fixed by the author and the last fixes are not re-verified. 8: the gate report is posted; the push waits.

### What is not known

- Anything about a zone that is not built. See "What Phase 4 can and cannot measure" above.
- What kind of player Michael is, beyond careful. One playthrough cannot tell slow habits from a late drop.
- Whether a retuned base energy holds past Z1. Every figure is from one wall.
- When the first Claim lands. Not in Z1 on Z1's gear; after that it depends on Z2's gear, and two stand-ins for that gear disagree widely (GDD 13.7).

### Gate question (answered 2026-10-13: a)

| # | Question | Michael's answer | Recorded as |
|---|---|---|---|
| 1 | With a loss now charged, leave base starting energy at 20, or make it 21? | a | **Ruling.** It stays 20 (GDD R-14). He approved the gate in the same reply |

Not asked, and left as they are: section 5.9's retry guard that cannot fail, `goldAt` at zone edges, "no wall over 8 runs" being met at no energy, and when the first Claim lands. The two verifier agents' scratch copies of the repo are in the session's temporary folder, outside the project, and were left there; he was told.

### Carried forward to Phase 5

- **Content is tuned against the wrong player.** Z1 meets "runs in Z1: 4–6" for the Phase 3b player and reads 7 or 8 for a careful one, which is what Michael is. Tune new zones with `cautious` and `like-michael` beside the Phase 3b player, on two sets of seeds, and report mean differences.
- **A wall should not hang on one drop.** Z1's hangs on i003 from e009 at 10%. Authoring Z2 onward, give a wall's key item more than one way in, or say why not.
- **The first Claim.** Not in Z1 on Z1's gear. Run `npm run sim -- --probes` once Z2 has items and a reference loadout, and play it: does the tool see use during Z2?
- **Section 5.9's retry guard** reads 0% for every strategy. If it is to guard anything it has to be read on gate falls.
- **`goldAt` dips at each zone edge.** `--probes` names any shop item priced inside one; none is today. Check again when Z2's shop is authored.
- **Not measured at all:** either energy rule at a fight cost of 2, with several bosses paying energy back, or with Claims; every row of section 5.9 that needs a later zone.
- **The rule on his phone** was not seen before the push. Ask him what the pre-fight sheet and a lost fight's sheet say.

## Phase 3b working record

`docs/ARCHITECTURE.md` section 14 lists exactly what exists, and `docs/GDD.md` section 13.5 lists what building it settled. This section records how it was checked and what is still unknown.

### What Phase 3b built

- Save version 2: the real game state, a pure migration from version 1 that gives a new game at run 1, a frozen fixture, invariants, and the run-duration log.
- The engine: formulas, combat resolution, the forecast, the reducer, run repair, pathfinding and allocation policies.
- Content schemas and a loader, `data/balance.json` with every number in the GDD, and the sealed slice: Z1 in full and the first two enemies of Z2 behind its gate.
- The screens the slice needs: map with both movement controls, pre-fight sheet, battle playback, result sheet, Hero, Gear, Items, Bestiary, Salvage, Run menu, new-run sheet, Settings.
- The three checks Phase 3a deferred: `check-content`, the reference-name test (salted hashes), and battle golden replays that also run on the phone as the self-test.
- The simulator, `npm run sim -- --runs 50`.

### Verified on the laptop (2026-10-12)

- `npm run check`: PASS. Typecheck of four projects, lint, 1,097 tests in 32 files, content check, repo check, prose check.
- `npm run build` and `npm run check:dist`: PASS.
- Each new check is run against a deliberate violation in `tests/checks.test.ts` and `tests/refnames.test.ts`; each lint rule in `tests/enforcement.test.ts`, with cases for the new fixture files.
- A test checks that the golden replays still reach what they are there for: wins and a loss, a level, a drop, a purchase, a secret, a boss with its payback and handover, the way past the gate, Salvage, a Claim and an empty tank.
- The built app, served by `npm run preview` and driven by script in a Chromium pane. The pane was not being painted, so nothing here is a judgment of how it looks; that is Michael's phone. PASS on each of the following.
  - A new install opens on the map at run 1. Tapping an enemy walks the hero to it and opens the pre-fight sheet; a fight is in storage, at save version 2, before its result shows.
  - Levels, spending points, the Combat tab, the Gear picker with its preview of the change, the Items list with unfound items blank, the Bestiary, the Run menu.
  - A save made by the simulator was imported through the import sheet, with the side-by-side comparison, and played on.
  - Salvage showed its chance, pool and bands, took the gold and failed. Steering along a wall found the slice's optional secret.
  - The new-run sheet listed what the run gained and would lose; the new run wrote a checkpoint and then the hot slot, and filed one run-duration entry.
  - The wall read as a wall: 0% with "You need about 19 rounds and last about 5", and a loss summary after trying it.
  - With the reference loadout and a climb to level 42 the boss stood at 70%. It fell, the tool was handed over with its line and its explanation, the gate opened, Z2's first enemy stood at 61% and its second under 1%, and the sealed door said so.
  - **The version 1 migration:** a version 1 record in the hot slot opened as the map at run 1 with the upgrade notice; the hot slot became version 2 at the next seq with the hero on the run start; the version 1 record was kept as a set-aside copy. Restoring that copy from Settings shows a warning that it holds nothing of the real game.
  - The update flow: a second build waited as "update ready" with both caches present, applied only from the new-run sheet, and the old cache was then gone.
  - The self-test read 11 of 12 in the browser while one golden value was stale, which is the check doing its job. With the values rewritten it reads 13 of 13 there, so Chromium's arithmetic matches Node's on every replay. Safari's is for the phone to say.
- `npm run sim -- --runs 50`: runs in about a minute. Results are in GDD 13.5.

### Deploy

One push carries the whole phase, in two commits: the sealed content, then everything else. Its CI run and the check of the live site are reported in the gate report and not here, so that recording them does not ship one more version to the phone.

### Separate passes (2026-10-12)

Six passes were run by agents that did not write what they checked. None was shown this file's conclusions.

- **Engine tests, written from the GDD.** 483 tests. A mutation check on a copy of the engine: 100 of 102 deliberate rule-breaks failed a test. It changed the engine in three places: the tool's cut was a hair under a tenth, so Damage 20 gave 1; an item ID spelt `constructor` passed as known and turned gold into not-a-number; a malformed spend threw. It left eight readings of the GDD as questions, which were settled (GDD D-30) and the engine changed for four of them.
- **Save tests for version 2.** Every Phase 3a protection translated. One fix: a migration that returned something unserializable made the loader throw.
- **UI wiring tests.** The startup, recovery and migration wiring through the real `startApp`, the controller, the map's two controls. A mutation check of `src/ui`: 54 of 55 caught. Four display bugs fixed: a number just under a boundary rounded up, and the loss line was wrong in two cases.
- **Content checks and the reference-name test,** built to GDD 7.9, then widened after the second verifier's pass. 1,169 hashed names and a canary; no content name matches. The name scan now matches any case, plurals and hyphenation, and reads commit messages too; it finds nothing in 157 unsealed files, and no exception was needed.
- **Content verifier.** Naming FAILED: seven names broke the sealed naming rules or sat one word from a reference-game name; all were renamed. One spoiler leak, in this file, fixed. It also found the first energy accessory out of reach for half of simulated players, the reference loadout padded, and the ID lock giving away what kind each secret is; all fixed. Originality, the arc, the numbers, the maps and the tone passed.
- **Verifier of saves, engine and wiring.** No way to lose a save in any arrangement the phone can reach. The migration passed every case it tried through the real entry point: hot and five checkpoints, hot missing, hot damaged, killed between the copy and the first write, a second launch, seven runs on, version 1 copies restored, version 1 exports imported. It found eight things to fix, all fixed except the first, below: a result sheet that opened over the save-failed screen; a double tap on Buy buying twice; a new run mid-walk leaving the map behind; gaps in `check-content`; golden replays that reached no boss, Claim or Salvage; a name scan that matched exact case only; and stale numbers in the GDD.

### Left as they are, by choice

- A version 1 record with a higher seq than a version 2 record beside it is loaded in preference, as a new game. That needs a version 1 build to write after a version 2 one. The site only ever serves the newest build, so the phone cannot reach it, and a special case in the load order is not worth its own risk.
- A set-aside copy of a version 1 save can still be restored from Settings. The sheet now says that it holds nothing of the real game; the current game is set aside first, as with any import.
- A run that began as a migrated version 1 save has no marked enemies at its start. A fresh run does.
- An XP amount is the floor of a product of doubles, and comes out 1 short of exact arithmetic for about 4% of level pairs. It is the same on every device.
- `goldAt` falls at each zone edge, because the GDD's gold-per-level table does: an item meant for level 41 costs less than one for level 40. For Phase 4.
- The simulator's tail: 5 to 9 simulated players in 100 take more than 8 runs at the wall. GDD 13.5 says why it is left.
- The slice has one item per weapon and armor slot, so its build choices are all in the five accessory cells. Gems reach about 20 by run 14 and their only use costs 25.
- Z1's map is nine terraces of one shape. It is placeholder layout as well as placeholder art.

### What one zone cost to author

Measured on Z1, for the DV-6 condition.

- **What a zone is, once the systems exist:** data only. Z1 and the Z2 glimpse are 12 enemies, 25 items, two tile grids, about 50 names and one reference loadout: 240 lines of JSON in six files. No code changed for content.
- **The steps:** one authoring pass; the content check, which the authored data passed first time; four tuning passes with the simulator, each a change of a few numbers and a one-minute run; one verifier pass, which sent back seven renames and three number changes.
- **The time:** the authoring pass was minutes. Tuning and the verifier's round were the bulk, under an hour of session time together.
- **What makes later zones dearer:** two or three bosses instead of one, key doors, a waypoint, more tags and traits, and maps that are places and not placeholders. What makes them cheaper: the checks, the simulator and the naming rules now exist.
- **So:** a zone is about an hour or two of a session, most of it tuning its walls, and none of it Michael's time beyond the gate. Seven more zones is a few sessions. The lever that costs nothing, runs per wall and drop rates, is in `data/balance.json` and the sealed drop chances.

### A spoiler that got out

A status line in chat during this phase named the kind of optional secret the slice holds. It did not say where. The same phrase was in this file's todo list and was removed. Nothing else sealed was put in chat, a commit message or an unsealed file; the content verifier searched 140 unsealed files and the second verifier 151.

### Phone review (Michael, 2026-10-12)

A review session after the gate report, on his iPhone 16 Pro from the Home Screen icon. Before it began, CI for `663583d` was read as green and the live site as serving the new build. Results were written here as he reported them. Two pushes came out of it: the fixes, as `6711b80`, and this record with his approval. He approved with the one word "Approved" after the sixth step, having been told what was still not checked: using Salvage from the Run menu on the phone, and the band under the tab bar, which is Apple's.

| Step | What | Result | Evidence |
|---|---|---|---|
| 1 | The update applied and the version 1 save migrated | PASS | His screenshots, taken after two fights: Settings reads Build `663583d`, Save version 2, Home Screen app, storage persistence granted, write durability strict, last write save 17 at 15:13. The map shows the hero at the bottom with Level 3, Energy 18, Gold 68, Gems 0. The Run tab heading reads "Run 1", with starting energy 20, Items 0 of 25, Bestiary 1 of 12. No recovery screen. Set-aside saves lists the version 1 hot slot (save 10) and three version 1 checkpoints (saves 9, 7 and 2), each "before-migration (routine)", and the Phase 3a "replaced-by-import (kept)" record. He saw both notices and dismissed them. Two fights later the Run tab read 4 wins, 1 loss and 16 energy left, which is the "only wins are charged" rule on the phone |
| 2 | Self-test in Safari | PASS | He reported "13 of 13". Safari's arithmetic matches Node's and Chromium's on every golden value and replay |
| 3 | Layout | PASS, with the findings below | Two screen recordings, 36 and 28 seconds, read frame by frame: Map with a tap-to-walk route, Hero (both tabs), Gear with its picker, Items with its filters, Bestiary, Run, the pre-fight sheet, two battles at 2× and the loss sheet. His own words: "Nothing really has bothered me. I mean the graphics and design are very basic but it's fine for now." A win's result sheet was not in either recording |
| 4 | Playtest and rubric | PASS on all four rubric points | He played through the Z1 gate: "That was very fun." His screenshots show the win sheet for the gate boss (level 44 to 51, the tool dropped with its line and its explanation, energy "−1, +3 back, 6 left"), the map beyond the gate with a Z2 enemy in view, a full loadout but for one armor slot, and the bestiary with the boss beaten once and unclaimed. He raised four points, P1 to P4 below. The rubric and the rest are in the table after this one |
| 5 | Gate questions | Answered: a, a, a | Question 1, the first Claim: "a", leave it and let Phase 4 measure (GDD R-06). Question 2, the armor slot labels: "a", keep them (GDD R-07). Question 3, Z1's enemy levels: "a", keep them (GDD R-08). Each was the recommended default, asked and answered one at a time |
| 6 | Decisions made without asking | None overruled | He was walked through GDD 13.5 one row each: D-21 and D-23 to D-30, and B-01 to B-04, with D-22, D-31 and half of D-26 already settled by his answers above. He was given the commands to read the diffs of `663583d` for the GDD and `data/balance.json`, and of `6711b80`, and told that `6967658` is sealed. Asked whether he overruled any: "None." Whether he read the diffs is not known |

The playtest, as he scored and reported it:

| What | Result | Evidence |
|---|---|---|
| Rubric 1: did the wall feel real | PASS | "Pass to All" |
| Rubric 2: did the gear he kept change his options | PASS | "Pass to All" |
| Rubric 3: did the breakthrough land | PASS | "Pass to All" |
| Rubric 4: did he want another run | PASS | "Pass to All" |
| The run the Z1 gate fell on | Run 10 by the app's record; he recalled "about 8" | The win sheet's screenshot shows the export reminder counting 10 runs from a count that starts at 0, and Settings lists runs 2 to 9 as finished with a tenth under way. The simulator gave 4 to 11 with a median of 6, and GDD 5.9 asks for no wall over 8 runs, so the one real player came out in the simulator's tail |
| Tries at the boss on that run | "I think 4 or 5" | His reply. He did not give the win chance shown. With free losses that is DV-3's long-shot retry, in a mild form |
| Run times (target 2 to 4 minutes) | PASS, one run 10 seconds under | Settings, Run times: runs 2 to 9 took 3:13, 2:28, 3:24, 3:18, 2:03, 2:42, 1:50 and 2:39, a mean of 2:42. The model said 2.6 minutes at default playback. Run 1 has scrolled off the list of eight |
| Wins per run (target 20 to 30 early) | At the bottom of the range | The same list: 20 wins in every run from 2 to 8, and 19 in run 9. Levels reached: 13, 15, 20, 32, 40, 45, 53, 51 |
| Spotify never paused | PASS | "No" |
| The two controls | Tap-to-walk used almost throughout | "I found myself using tap to walk, but that's a result of the game's layout and design (tiles, rather than RH open map)." Not a complaint he asked to have fixed; it bears on DV-4, and on P2 |

His rulings on P1 to P4, given with the scores: yes to P1, P2 and P3 as proposed; on P4, RH charges energy when a fight is joined, win or lose (a correction to the record), and this game's rule is to be decided in Phase 4 with both simulated. They are GDD 13.6, R-01 to R-05, with DV-9, DV-10, D-32 and D-33. P1 to P3 were built on the laptop by a separate agent from a written brief, and Claude then read its diff and ran the checks again.

- **P1, the reminder.** A "Later" button hides it until the app is next started; it is kept in memory and in no save. The sentence names only what is overdue.
- **P2, zoom.** A button at the end of the loadout row switches the map between nine tiles across and fourteen. The level is in the `device` store, outside the save. Taps and drawing go through one viewport at either level.
- **P3, Salvage.** The engine no longer asks where the hero stands, and the `not-at-site` refusal is gone. A "Salvage…" button is on the Run menu and on the spent-run notice; the map site still opens the same sheet. A test compares a Salvage made at eight places with the one made at a site and finds them equal, which is why no golden value moved.
- Verified on the laptop: `npm run check` PASS with 1,159 tests in 35 files; `npm run build` and `npm run check:dist` PASS; nothing changed under `data/`, `docs/sealed/`, `src/sim/`, `src/save/`, the golden values or the fixtures. The agent took out four behaviours in turn and each failed a test. Seen by eye: NOT CHECKED, on the laptop or the phone.
- Left as they are: `CLAUDE.md` still says "44 pt tap targets … no zoom" with no exception, because it has one byte to spare and the exception for the map at far zoom is in GDD 8.3 and `docs/ARCHITECTURE.md` section 8; the Salvage sheet's title still carries the site's name; tapping a site on the map still walks the hero to it first; the loadout row does not wrap, so long loadout names will crowd the zoom button.

He replied "push", and L1, L2 and P1 to P3 went out together as commit `6711b80`. Its CI run finished green, and the live page then served a new script and the style sheet whose name matches the laptop's build. He applied it and sent eight screenshots.

| What | On the phone | Evidence |
|---|---|---|
| The update applied | PASS | Settings reads Build `6711b80`, Save version 2, last write save 504, durability strict. The Run menu is headed "Run 11" |
| Self-test on the new build | PASS | "13 of 13 checks match." So the Salvage change moved no golden value on the phone either |
| L1, the short page | PASS for the workaround; the band itself is not ours to fix | The new Screen line reads "874 high, page 812, insets 62 and 34: the page stops short of the screen", the numbers predicted. The tab bar's buttons sit 34 points lower than in his earlier screenshots. The band below stayed dark, so the shadow was not painted and the band cannot be drawn in; the home bar shows inside it, clear of the tab bar. The shadow has been taken out again, to go with the record's push |
| L2, map captions | PASS | The place label nearest the right edge of the map is whole |
| P2, zoom | PASS | The map at fourteen tiles across, the button reading "Zoom in", every caption legible |
| P3, Salvage | PASS for the button; using it NOT CHECKED | "Salvage…" sits above "New run…" on the Run menu |
| P1, the reminder's Later button | PASS | Asked whether the reminder came up with a Later button after the update and whether Later hid it: "Yes and yes." |
| The run the gate fell on | Run 10, confirmed | Run times now lists run 10 as finished: 1:51, 17 wins, level 51. Sixteen wins and the boss leave 6 energy of 20, which is what his win sheet showed |

Layout findings, all seen by Claude in his screenshots and recordings; Michael raised none himself. L1 and L2 are to be fixed. L3 to L5 are left for the screen's real design pass, since he called the design basic but fine for now and did not ask for a change to Gear.

- L1: a dead band below the tab bar on every screen, and below every bottom sheet, about 62 points tall, which is the height of the top safe-area inset on this phone. The page is that much shorter than the screen. It cannot be reproduced in the laptop browser, so a fix has to be confirmed on the phone.
- L2: a place label on the map is clipped when its tile sits at the edge of the canvas. Captions are centred on their tile and not kept inside the canvas.
- L3: Gear is one column of 18 full-width rows, about three screens of scrolling, with the five accessory cells last. A question for Michael, not a defect: whether to lay armor out two to a row.
- L4: on Items, an item with three stat lines wraps so that the last digit of "owned 0 of 1" sits alone on a second line.
- L5: on Gear, the Weapon section holds one slot that is also labelled "Weapon".

Michael's four points after the playtest, in his order. Each waits for his ruling on what to build.

- P1: the export reminder on the map has no way to close it. The kickoff asks for a reminder that does not block play, and it does not, but it takes about three rows of the map until an export is made.
- P2: he wants to zoom the map out, to walk or steer farther in one go. The map shows nine tiles across.
- P3: he wants Salvage reachable from the bottom bar or a tab, not only by walking back to the site beside the run start. GDD 7.4 and D-26 require the hero at a site, as RH does at its own (his screenshot, C04). A change is a deviation from RH that he is asking for.
- P4: he recalls that RH charges a fight's energy when it is joined, win or lose, and again on a retry. The GDD has "only wins are charged" as Confirmed (Q2). That rests on his one-letter reply "a" to all five batch 1 questions, and on his own line in a September RH chat, which speaks of wins and is silent on losses. The two statements are both his; which is the fact about RH is his to say, and so is the rule for this game. Every Phase 3b balance number was tuned with free losses. The save already stores energy spent as a counter, so either rule needs no migration.

What was done about L1 and L2, on the laptop while he played. Neither is pushed yet, and neither has been seen on the phone.

- **L1 is an iOS fault, not ours.** His phone's numbers, a screen of 874 points with a page of 812 and a top inset of 62, are the ones in WebKit bug 301994, open since iOS 26.1 and reopened in August 2026 on iOS 26.5.2 and the iOS 27 beta. Its reports say the band cannot be reached from the page, and no workaround is documented. So the band is not filled. What the app now does is in `docs/ARCHITECTURE.md` A-32: it detects that exact shape, stops keeping 34 points clear for a home bar that lies below the page anyway, and carries the tab bar's colour on below the page as a shadow. That wins back 34 of the 96 points being wasted, and the shadow will show on his phone whether the band can be drawn in at all. Settings, This install, has a new "Screen" line with the four numbers. Verified on the laptop: PASS for the detection at his numbers and at seven shapes it must not answer to, through the real `startApp` and on the recovery screen; PASS in a Chromium pane that the normal layout is unchanged, that forcing the attribute moves nothing and adds nothing to scroll to, and that Settings shows the line. On the phone: NOT CHECKED.
- **L2 is fixed.** A caption on the outermost column in view is pulled in to stay on the canvas. A test that draws the sample map through the real map view put the caption's left edge 12.5 points off the canvas before the fix and 3 points inside it after. On the phone: NOT CHECKED.
- `npm run check` PASS with 1,126 tests in 34 files, up from 1,097 in 32; `npm run build` and `npm run check:dist` PASS.

Checked in the recordings and found in order: every button is at least 44 points tall; nothing overlaps; the six tabs fit; the pre-fight sheet, the battle and the loss sheet each fit one screen with their buttons in thumb reach; the Hero screen read "No stat points to spend" at level 4 with Life at 105, which is all 15 points in Life at 3 a point from a start of 60. The win chance for one unchanged fight read 17%, 19% and 18% on three openings, which is the forecast's stated precision of about 2 points (GDD 3.5) and not a fault.

### Carried forward to Phase 4

- Configurable strategies: one that retries a boss at poor odds, which is DV-3's risk and which the Phase 3b strategy cannot show, and a cautious one.
- The wall's tail, and whether it is content or the simulated player.
- `goldAt` at zone edges.
- A first Claim: the tool cannot claim the Z1 boss until about level 300, which is Z2's end or Z3. Michael is asked about this at the gate.
- CSV output and the markdown summary against every row of GDD 5.9, whose targets are now in `data/balance.json` under `pacing`.
- **Energy on a loss (GDD R-01, R-02, DV-10).** RH charges a fight's energy when it is joined; this game charges only wins. Michael wants both rules simulated to the same pacing targets before he rules. It is the first decision of Phase 4, because every other number hangs on it.
- One real playthrough to set beside the simulator: the Z1 gate fell on run 10, where the simulator's median is 6 and GDD 5.9 allows 8; runs took 1:50 to 3:24; 20 wins a run; four or five tries at the boss on the last run.
- The dead band under the tab bar on his phone (A-32): what his phone shows after the workaround, and whether the band can be drawn in.

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

### Phone acceptance run (Michael, 2026-10-12)

Done on his iPhone 16 Pro from the Home Screen icon, with Spotify playing, following a 24-step checklist given in chat. The LAN layout check was skipped. He reported in four messages: the two Settings readouts, "everything through step 19 is good", "steps 20 to 24 all worked", and then the self-test count and how the export went.

| What | Result | Evidence |
|---|---|---|
| Install from the Pages address, use the dummy screen | PASS | His report |
| Storage persistence | Granted | Settings read "Granted: the browser will not clear this save on its own" |
| Write durability | strict | Settings read "strict" |
| Background, then force-quit: state kept, including a step not yet saved | PASS | His report |
| Launch and play in Airplane mode | PASS | His report |
| Spotify never paused | PASS | His report |
| Export, delete the icon, reinstall, import | PASS | The sheet offered "Share the file"; he saved the file on the phone and it imported after the reinstall. The text code also copied into a note |
| A deployed change waited, then applied from the new-run sheet | PASS | He pushed an empty commit, `a4f89db`; "update ready" appeared, nothing reloaded, and the update applied from the new-run sheet |
| Diagnostics log | One entry | "applying the waiting version from the new-run-sheet", which is the app's own note and not an error. No `save-retry` entry |
| Engine self-test | PASS | 9 of 9 |
| Layout on the LAN dev server | NOT CHECKED | Skipped by agreement; he used the installed app's layout throughout without complaint |

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

For Phase 5, read in order: `CLAUDE.md`; this file ("Current phase", "Carried forward to Phase 5", "Phase 4 working record" and "Handoff"); the Phase 5 line of `docs/KICKOFF.md` and its save spec; `docs/ARCHITECTURE.md` section 7.5 for the backup, then sections 6, 10 and 14; `docs/GDD.md` sections 11 and 13.7, then 5.9, 7 and 10 for content. `docs/sealed/` is needed when content is authored or reviewed, and never quoted. `reference/` is needed only to check a claim about RH; start with `reference/_claude_phase0/README.md`, which is private and gitignored.

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

- 2026-10-12 (Phase 3b): Design decisions made without asking are GDD D-21 to D-31 and balance changes B-01 to B-04; architecture decisions are `docs/ARCHITECTURE.md` A-23 to A-31. They are not repeated here.
- 2026-10-12 (Phase 3b): The pasted Phase 3b prompt was taken as Michael's own message, approval included: it is the prompt this file says he was given, and its first line is the word the gate asks for.
- 2026-10-12 (Phase 3b): Three actions were left out of the slice though their fields are in the save: waypoint travel, waypoint unlock and Auto-assign. The kickoff puts Auto-assign later in v1 and waypoints start at Z3.
- 2026-10-12 (Phase 3b): Tests and checks were written by separate agents, not by the code's author, with the brief to find where code and GDD disagree. Their fixes to non-test code were kept; every one is listed under "Separate passes".
- 2026-10-12 (Phase 3b): The built app was played by script, not by hand, and the breakthrough run was played from a save in which the simulator had played four runs and the hero was then handed the missing reference gear. A full playthrough to the wall by hand is about two hours; the simulator covers the path through the same reducer.
- 2026-10-12 (Phase 3b): The simulator was not tuned further to pull in its tail. One strategy's unlucky players are not grounds for a content change; Phase 4 has the tools to tell.
- 2026-10-12 (Phase 3b): The rollback arrangement the verifier found (a version 1 record written after a version 2 one) was left, with the reason under "Left as they are".
- 2026-10-12 (Phase 3b): `scripts/update-golden.ts` was kept and given a command, because Phase 4 will change balance repeatedly and each change rewrites the golden values. It refuses to rewrite the hash, generator, square-root and serialization values.
- 2026-10-12 (Phase 3b): A commit-message hook was added, since "no content name in a commit message" is a rule a machine can check.
- 2026-10-12 (Phase 3b): Everything went in one push, so the phone sees one "update ready" and not several.
- 2026-10-12 (Phase 3b review): His reply "Approved", with a capital, was taken as the word the gate asks for: it was his own one-word message, sent in answer to a summary that named that word.
- 2026-10-12 (Phase 3b review): The run the gate fell on is recorded as 10 against his recollection of "about 8", because the app's own counts say 10 in two places.
- 2026-10-12 (Phase 3b review): Layout findings L3 to L5 were left for the screens' real design pass. He had said nothing bothered him and that the design was basic but fine for now.
- 2026-10-12 (Phase 3b review): The dead band was not filled. Laying the app out into a band that WebKit's own bug reports call unreachable could have pushed the tab bar off his screen, and it cannot be tried without a Mac. The workaround taken is the part that is safe either way (A-32).
- 2026-10-12 (Phase 3b review): The fixes went out before the record, as their own push, because two of them could only be confirmed on the phone. That made two pushes in the session, where he had asked for one for the record.
- 2026-10-12 (Phase 3b review): His three requests were built by a separate agent from a written brief while the review went on, and read and re-checked by Claude before the push. The brief forbade any change to the save, the simulator, the golden values and sealed files, and none was made.
- 2026-10-12 (Phase 3b review): `CLAUDE.md` was left as it is, with one byte to spare. Its "44 pt tap targets … no zoom" now has one exception, the map at far zoom, recorded in GDD 8.3 and `docs/ARCHITECTURE.md` section 8. He was told and did not ask for a change.
- 2026-10-12 (Phase 3b review): "Only wins are charged" had been marked Confirmed as RH's rule on the strength of a one-letter reply to five questions. It is now marked as a ruling, with RH's rule as he gave it (R-01). The lesson for later interviews: a default he accepts is a ruling, and only a fact he states himself is Confirmed.

- 2026-10-12 (Phase 4): Design decisions made without asking are GDD D-34 to D-37; architecture decisions are `docs/ARCHITECTURE.md` A-33 to A-37. They are not repeated here.
- 2026-10-12 (Phase 4): The pasted Phase 4 prompt was taken as Michael's own message: it is the prompt this file says he was given.
- 2026-10-12 (Phase 4): Four pacing targets were added to `data/balance.json` before the ruling. He asked that no shipped balance number change; these are targets that no rule reads, and no existing number moved.
- 2026-10-12 (Phase 4): The lines of text that state the energy rule were made to follow the switch now, not after the ruling, so that the switch is the whole change. With it off they read as they did.
- 2026-10-12 (Phase 4): Each rule was tuned against the fitted player and not the Phase 3b one, because the targets describe his play and the Phase 3b player is quicker than he is. The Phase 3b player is reported beside it in every table.
- 2026-10-12 (Phase 4): The tuning used one number, base starting energy. Raising the two drops the wall hangs on was tried and moved a player like him by one run at most; it is recorded in GDD 13.7 and was not kept as a variant.
- 2026-10-12 (Phase 4): `like-michael` includes habits there is no evidence for (when he shops, whether he used Salvage, whether he went back for drops). They were chosen because they fit, and GDD 13.7 says so.
- 2026-10-12 (Phase 4): The simulated player gained one behaviour, a last attempt at a boss with the run's last energy, because DV-3's risk could not be shown without it. The Phase 3b strategy does not use it.
- 2026-10-12 (Phase 4): Two small changes to how every strategy is counted, the Phase 3b one included: a win's tries are the losses to that enemy since it was last beaten, where they were the losses in a row; and Salvage is used from where the hero stands, as the app now allows (DV-9), where the simulated player walked to a site. The Phase 3b player's gate still falls on a median of run 6.
- 2026-10-12 (Phase 4): The simulator's tests were written by its author, not by a separate agent as in Phase 3b. The verifier pass was asked to attack them.
- 2026-10-12 (Phase 4): `sim-out/` stays out of git. The figures are in GDD 13.7 with the commands that give them, and the simulator is deterministic.
- 2026-10-12 (Phase 4): The verifier pass was run before the energy question was put to Michael, not only before the gate report, because his ruling rests on the figures.
- 2026-10-13 (Phase 4): The verifier's corrections were checked against `runs.csv` by the author's own script before they went into GDD 13.7, and its second set of seeds is reported beside the first wherever the two differ.
- 2026-10-13 (Phase 4): The test for "reproduces" counts his tries at the boss as inside a strategy's band if either four or five is. The verifier called that lenient. It was left, because he said "four or five", and it is now written into D-37; the verdict is "no" on either reading.
- 2026-10-13 (Phase 4): Variants for base energy 22 to 26 are kept in `src/sim/variants.json`, so the sweep can be rerun. The two tuned ones are no longer described as tuned.
- 2026-10-13 (Phase 4): The verifier left a copy of the repo at `e57f9f6` in its scratch folder and asked for it to be deleted, its own delete having been refused. It was not deleted on its say-so. Michael is asked.
- 2026-10-13 (Phase 4): "Just let things be how they are" was read as no retuning of any number, base energy included, and as the answer to the other tuning questions that had been listed for the gate. The one consequence he may not have meant, a slightly harder game than the one he played, is put to him in the gate report with the number that would undo it.
- 2026-10-13 (Phase 4): His account of the gate run was recorded beside the app's count and not in place of it, and he was told the two do not fit. The simulator's recorded playthrough was left as the app's count.
- 2026-10-13 (Phase 4): The engine's sample balance was switched with the shipped one, because it is described as holding the GDD's values and the GDD's rule is now that a loss is charged.
- 2026-10-13 (Phase 4): A variant for base energy 21 was added and run after the ruling, so that the gate report could give the number that keeps the game as he played it.
- 2026-10-13 (Phase 4): The slowest enforcement test was given 30 seconds, because it timed out at 5 while a simulation was running and the commit hook runs it.

- 2026-10-13 (Phase 5): The pasted Phase 5 prompt was taken as Michael's own message: it is the prompt this file says he was given.
- 2026-10-13 (Phase 5): The Phase 4 push's CI run and the live site were read again before being written down, not copied from the prompt, so that the record rests on a check that returned in the session that wrote it.
- 2026-10-13 (Phase 5): The plan and its success checks were written here as proposed, before he had answered, so that the plan is not held only in chat. The section says it is not agreed.
- 2026-10-13 (Phase 5): What his phone shows under the charged-loss rule was asked in the same message as the plan. It is a readout and not a decision, so it was not counted against "one question at a time". That is a reading of his instruction.
- 2026-10-13 (Phase 5): GitHub's current rules for fine-grained tokens and for calls from a browser were looked up before the plan was posted, because GDD section 11 leaves them to be checked in Phase 5 and option (a) would be dead without browser access. Looking them up is not building. What was found goes to him with the backend question.
- 2026-10-13 (Phase 5): Three gates are proposed where he said he expected at least two. The third follows from his own instruction that the number of zones be put to him before anything past Z2 is authored.
- 2026-10-13 (Phase 5a): Design decisions made without asking are GDD D-38 to D-43; architecture decisions are `docs/ARCHITECTURE.md` A-38 to A-43. They are not repeated here.
- 2026-10-13 (Phase 5a): The question of whether the key expires was put to him while the build went on and not before it, since nothing in the code hangs on the answer. A push is held while it is open.
- 2026-10-13 (Phase 5a): The unit tests of the two new files were written by their author. The tests through the real `startApp` were written by a separate agent from a brief that named the success checks, with the instruction to find where code and checks disagree and to mutate the code against its own tests.
- 2026-10-13 (Phase 5a): Three things were changed after that agent had started, and it was told of each: the key sheet and the overwrite sheet no longer wait on the network before closing; the backup's key is read on every way into the game, the recovery screen included; and two buttons were renamed so that restoring and overwriting cannot be taken for each other.
- 2026-10-13 (Phase 5a): The built app was not driven against the real service, and no key of any kind, real or made up, was typed into it in the browser pane: a made-up key would still have been sent to GitHub. The stand-in service covers the code.
- 2026-10-13 (Phase 5a): `tests/fake-github.ts` answers a write without a version name with 422 and one with the wrong name with 409, as GitHub's documentation lists them. The app does not rely on either answer (A-39).
- 2026-10-13 (Phase 5a): After the verifier pass failed the guard, it was rebuilt and not patched: five separate faults had one cause, and a sixth patch to a note would have been a sixth event to remember. The rule he was told about is unchanged in what it protects; how it is decided is different, and D-40 says so. He is told in the gate report.
- 2026-10-13 (Phase 5a): A game is told from another by the moment its save was begun, a field the save already had for export tracking (A-40). A field of its own would have been a save change and a migration on his phone.
- 2026-10-13 (Phase 5a): Two saves of one game that keep exactly the same things may replace each other in the backup without asking, whichever is the older, as long as the newer run count is not the one being lost. Nothing that lasts is lost by it. The verifier's case U1b had two such saves and was given a fight so that they differ; the change is noted above the test.
- 2026-10-13 (Phase 5a): The verifier's sixteen cases were kept as regression tests and edited by the author where the new guard made them read a note that is gone or expect a fault that is cured. Each edit is listed above them, so that the re-check can judge whether any of them softened a case.
- 2026-10-13 (Phase 5a): The verifier ran nine mutations in the main working tree for about four minutes before moving to copies, and left one file mutated when it stopped that runner; it restored the file and said so. The author's full check was not running in that window.

## Handoff

- **Done:** Phases 0 to 4 approved. Phase 4 built the energy switch, on by Michael's ruling so that a lost fight is charged as in RH (GDD R-11), with base energy left at 20 (R-14); rebuilt the simulator with four strategies, the rule and balance variants as options, a CSV, a summary against every row of GDD 5.9, a test against his recorded playthrough and two probes; and wrote what it found into GDD 13.7. A verifier pass and a re-check, each by a separate agent, confirmed the figures and between them failed the write-up four times; all of it was fixed. One push of five commits.
- **Worked:** Stating the test for "reproduces" before trying any strategy, which is what let the verifier show the fit did not hold. Profiling before optimising: the simulator was slow in path-finding and gear scoring, not in battles. Worker processes fed by seed, so parallel runs stay byte-identical. Reading the wall out of `runs.csv` by item ID, which showed it is one drop. Running the verifier before putting the question, and checking its corrections with a second script before writing them down. Mutating the code against the tests after the verifier listed what they missed. Building the rule as a switch with its text and tests for both positions, so that the ruling was one word, one golden value and a turn of the tests. Holding the push until the gate question was answered, so that the phase was one update on his phone.
- **Failed:** The first write-up said more than the figures: "reproduces him", "a run sooner", "one player in ten" and "tuned to meet 4–6" each fell to a second set of seeds or to the sweep. The paragraph about the first Claim was wrong twice: once by the author, and once more by taking the verifier's correction without testing it against the rule that gear is kept between runs. A fitted strategy was reported on the seeds it was fitted on. A reading of Michael's words went into the GDD as a ruling, and this file said a re-check had happened before it had. The lessons: give two seed sets and mean differences from the start; never report a fit on its own seeds; test a verifier's correction as hard as the claim it corrects; write down what he said and mark a reading as a reading; and record a check when it has returned, not when it is planned. Traps, added to the earlier ones: flipping the shipped rule in the working copy to look at it is refused before the ruling, and rightly; a background simulation makes the commit hook's lint tests time out, so do not commit while one runs; `--strategy all` picks up any trial entry left in `strategies.json`; do not edit `src/sim/` while a run is spawning workers; the map is a canvas, so driving the dev build means a screenshot and a tap by coordinates, and the screenshot shows place names that must not be repeated in chat.
- **Next:** Phase 5, in a new session, from the prompt given to Michael after the approval: cloud backup first, then content expansion. Its first commit should record the Phase 4 push's CI run and live-site check here. "Carried forward to Phase 5" above lists what its content work has to meet.
