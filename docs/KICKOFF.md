Kickoff v2.5 — Codename "Steadfast" (personal successor to Resolute Hero RPG)
Who you're working with
I'm Michael: strong technical power user (Python, SQL, PowerShell, Git), not a full-time engineer. Dev machine: Windows 11 ThinkPad, no Mac. Target device: my iPhone 16 Pro. Be direct, give recommendations instead of option lists, and give exact PowerShell commands whenever I need to run something.
Goal
Build a personal-use auto-battle, loot-farming "inflation" RPG that plays almost exactly like Resolute Hero RPG (Geometric Applications, iOS). Core features: an energy budget per run; levels and gold reset each run, while gear and permanent starting-energy bonuses persist, so each run gets a little farther; exponential level/stat inflation; huge loot variety; deep build options. Match the feel, flow, and depth, where "feel" means pacing, numbers, and decision density, not visual presentation. Every name, enemy, item, zone, map layout, screen layout, piece of art, and line of text must be original. Copy mechanics, never assets, text, or look. "Steadfast" is a codename only.
Public scale reference for the original (full-scope target, NOT v1): the store listing says 400 items, 240+ enemies, 90+ weapons, 12 armor slot types, 5 accessory slots; the developer's v0.10.1 data files show roughly 700 items and 460 enemies (see `reference/rh_web_notes.md`). Stats include:

* crit rate/damage, bonus XP, life regen
* extra turns, double attacks and double hits (stacking), extra stat points per level
* damage reflection, elemental reduction/amplification, surviving fatal attacks
* gold drop rate, item drop rate

Hard rules

1. Never invent facts about how Resolute Hero works. You don't reliably know its mechanics; I do. Tag anything I haven't confirmed as [ASSUMPTION] or [OPEN]. Claims from public sources are [WEB] and claims about RH mechanics from my ChatGPT recap are [GPT] until I confirm them; everything in `reference/rh_notes.md` is confirmed. When sources disagree, show me both; my ruling goes in the decisions log.
2. Zero audio: no <audio>, <video>, Audio(), Web Audio, or other media elements. The game must never take the iOS audio session, because I play with Spotify/YouTube running.
3. No monetization, ads, or wall-clock mechanics: no energy that refills over time, cooldowns, daily resets, or offline earnings. "Energy" means the battle budget per run, nothing else. Animation timing is fine.
4. Saves are sacred (spec below). Any change touching save data needs a migration and a test.
5. All content and balance numbers live in data files, never hardcoded. Content IDs are permanent; display names can change.
6. One source of truth: docs/GDD.md for design, CLAUDE.md for build rules, docs/STATUS.md for where we are. Update them in the same commit as the code they describe.
7. The deployed site is public, and on GitHub Free the repo must be public too. No secrets in code; `reference/` is gitignored; the RH name, art, and text never appear in the app or its manifest.
8. Work in phases. At each ⛔ gate, stop, post a gate report (format below), and wait for me to reply "approved". Questions or silence are not approval.
9. A rule a machine can check gets a check: lint, typecheck, test, CI step, or git hook. An instruction alone is not enforcement.
10. Faithful by default. Don't add systems RH doesn't have (crafting, classes, quests, dialogue, procedural maps, daily tasks, extra currencies, a general-purpose RPG engine) unless I ask. Any proposed deviation from RH names the frustration it fixes, its cost, and what it risks weakening. If the benefit is unclear, keep RH's behavior.

Gate report format

* Done: what was built or decided, files changed
* Verified: each check marked PASS / FAIL / NOT CHECKED, with the command or evidence behind it
* New tags: [ASSUMPTION], [OPEN], [WEB] items added
* Questions: multiple choice, your recommended default marked
* Next: plan for the next phase, 10 bullets max

Stack
Use this stack. If you see a real problem with it, flag it; don't silently swap.

* TypeScript + Vite; vanilla DOM UI + Canvas 2D for map/battle views. No heavy game engine.
* `src/engine/` is pure, deterministic TS: no DOM, seeded RNG, runs headless in Node. The UI calls the engine; the engine never imports the UI. Enforce it: the engine's tsconfig excludes the DOM lib, and lint bans `Math.random`, `Date.now`, and `performance.now` inside `src/engine/`.
* Battles resolve instantly: a pure function takes (state, seed) and returns the result plus an event log. The UI replays the log; battle speed and skip are playback settings. The simulator calls the same function. Per-battle seeds derive from the run seed and battle index.
* Stat allocation is a pluggable policy: my manual choices, the in-game auto-allocator, and the simulator's player strategies all implement one interface.
* Content: `data/*.json`, validated with zod at load time and in tests.
* Storage: IndexedDB via `idb`.
* PWA: manifest + service worker, offline play, `display: standalone`. Never change the display mode (see save spec).
* Tests: Vitest. Hosting: GitHub Pages via GitHub Actions (HTTPS is required for install and the storage APIs).
* Mobile-first: iPhone portrait, safe-area insets, ≥44pt tap targets, one-handed play, nothing that depends on hover, no pinch or double-tap zoom.

Save system spec

* Autosave after every battle, every equip/inventory change, at run end, and on `visibilitychange`→hidden and `pagehide`. Commit each battle's result to the save before the UI animates it.
* Slots: one hot slot written on every autosave, plus 5 checkpoint slots rotated at run end. A checkpoint is written only after the state passes schema and invariant checks (e.g., every equipped item exists in inventory). Checksums on all slots. On load, use the newest valid slot, fall back automatically, and tell me when a fallback happened.
* Namespace the IndexedDB database name: every project site on my github.io domain shares one origin.
* `saveVersion` + ordered migrations. Keep fixture saves from every version in `tests/fixtures/saves/`; CI must load and migrate all of them.
* Call `navigator.storage.persist()` on launch and show its status in Settings. Never rely on it.
* Manual export/import: JSON file via the share sheet, plus a copyable text code. Settings shows days since last export; after 10 runs or 7 days without one, show a non-blocking reminder.
* iOS facts to design around: Safari and the Home Screen app don't share storage; the Home Screen exemption from Safari's 7-day storage cap depends on standalone/fullscreen display mode; assume deleting the Home Screen icon deletes the save. The install URL is permanent, so the repo name is locked before my first install.
* `SaveBackend` interface: LocalBackend now; CloudBackend (automatic backup after each run) in Phase 5. In the GDD, compare (a) a private GitHub repo written through the contents API with a fine-grained token scoped to that one repo and stored on-device, where every backup is a commit, and (b) Supabase free tier, which pauses idle projects after 7 days. Default proposal: (a).
* Service worker updates never reload mid-battle. Show "update ready" and apply it between runs.

Phases
Step 0: Put the kickoff on disk (no gate)

* `git init`; `.gitignore` including `reference/`. Before the first commit, confirm `git status --ignored` lists `reference/` as ignored; it holds my personal ChatGPT history.
* Save this prompt verbatim as `docs/KICKOFF.md`.
* Write a stub `CLAUDE.md` (under 2,000 characters): hard rules, gate rule, "read docs/STATUS.md first."
* Create `docs/STATUS.md`: current phase; a PENDING/COMPLETED todo list you re-read each cycle; a handoff section (done / worked / failed / next) updated at every gate and before any session ends.
* Commit.

Phase 0: Interview me
First read everything in `reference/`, including subfolders:

* `rh_notes.md`: my confirmed answers
* `_chatgpt_project_recap/`: ChatGPT's recap of the 30+ chats I had with it while playing RH, plus that project's files
* `rh_web_notes.md`: public-source research, including the developer's published stat formulas
* any screenshots

Start your first batch with section 10 of rh_web_notes.md, answering from the recap wherever you can. Then confirm or reject the [WEB] and [GPT] claims that matter for the GDD rather than asking from scratch. In the recap, my reported reactions (what I liked, complained about, got stuck on, found confusing, and what got me unstuck) are strong evidence for design pillars, anti-patterns, and UI clarity. Its claims about how RH mechanics work are [GPT] guesses unless rh_notes.md or the developer data in rh_web_notes.md backs them, especially lines tagged (explained). Never fetch RH sources yourself. Ask only about what these files don't cover. Batches of ≤5 questions, multiple choice with your recommended default marked; aim for 4 batches or fewer. Test my claims against concrete examples ("when you beat X, what changed?") instead of asking me to agree with your summaries. Cover:

* run structure and what persists between runs
* map/movement and encounters
* combat turn order and exact stat stacking
* leveling and the inflation curve
* loot, rarity, sets, shops
* zones, bosses, endgame
* screens and UI flow, including what the game shows me before I choose a fight or route
* spoiler policy: whether new enemies, items, and secrets stay unseen by me during development, and how I review content if so
* what made RH feel better than Hero's Quest and Inflation RPG, and which anti-patterns to avoid

If I say "don't remember," use your default and tag it [ASSUMPTION]. Use screenshots only to understand mechanics and flow; never reproduce their art, names, or layouts. ⛔
Phase 1: docs/GDD.md
Sections:

* design pillars (the feel to protect), each anchored to specific evidence from the recap or the interview
* core loop and run structure, including a reset ledger: what resets each run and what persists (this drives the save schema)
* combat resolution order, with formulas
* full stat dictionary: definition, formula, stacking rules, caps
* progression and inflation curves, with pacing targets: time per run, runs per zone, total hours. Every curve is a formula whose parameters live in `data/balance.json`.
* numeric representation: projected peak magnitudes for level, stats, damage, and gold; then choose plain JS numbers (exact to ~9e15, overflow past ~1.8e308) or a big-number library, plus the display format for huge numbers. Decide this before any save format exists; changing it later means migrating every numeric field.
* loot system, zones/enemy families, economy
* UI screen map and flow
* anti-patterns
* v1 scope vs. full scope
* open-questions log and decisions log

Also propose 5 original game names. ⛔
Phase 2: CLAUDE.md + architecture
Expand the stub CLAUDE.md, under 8,000 characters, covering:

* project purpose and the hard rules above
* folder map with each file's role
* commands
* coding/testing conventions
* save-change checklist and content-authoring rules
* enforcement map: which check enforces which rule
* definition of done

Plus `docs/ARCHITECTURE.md` with a module diagram. ⛔
Phase 3a: Walking skeleton (platform before game)
Scaffold the repo, CI, and GitHub Pages deploy. Ship an installable PWA with no game yet, just a dummy state (a counter and a fake inventory):

* the full save system minus cloud backup, with fixture/migration tests in CI
* export/import, persist() status, the "update ready" flow
* Settings, plus an in-app diagnostics log: capture `error` and `unhandledrejection` into a ring buffer in IndexedDB, viewable in Settings and included in exports. I have no Mac, so Safari Web Inspector on the phone is not available.
* enforcement: lint bans on audio/media APIs and engine impurity; a CI step that scans the built `dist/` for audio/media usage; a git pre-commit hook running typecheck, lint, and tests

Give me exact steps to test on my iPhone: the LAN dev server for UI checks only (a plain-HTTP LAN address is not a secure context, so no service worker), then Add to Home Screen from the Pages URL for everything else. My acceptance run, with Spotify playing: install, use, background/foreground, force-quit, relaunch; Spotify never pauses and state survives. Export → delete icon → reinstall → import round-trips. Deploy a change and confirm it waits for "update ready." ⛔
Phase 3b: Vertical slice
The slice exists to answer one question: does the core loop produce a breakthrough? It must contain one complete arc:

* a wall: an enemy or destination I can't beat on early runs
* a persistent gain that changes what I can do, not just a bigger number: kept gear, or a permanent starting-energy bonus from a first boss kill
* the run where I break through
* a visible next destination worth wanting

Content is whatever the arc needs, roughly 1 zone plus a glimpse of the next, ~10 enemies, ~25 items across weapon/armor/accessory slots. Also implement:

* the full run loop: start → battles → run end → persistent progress
* auto-battle with the core stats; inventory/equip; battle speed
* manual stat allocation through the policy interface (the auto-allocator comes later in v1)
* archaeology as the run's gold sink: gold resets each run, so without it gold means nothing in the slice
* golden replay tests: fixed seed + loadout → identical event-log hash. Update snapshots only for an intended balance change recorded in the decisions log.
* `npm run sim -- --runs 50`: level, zone reached, and runs-to-breakthrough vs. the GDD pacing targets

Pacing can be compressed; say what the compression prevents us from learning. This slice tests whether the progression relationships work, not whether the full campaign holds up. Placeholder art (shapes/emoji) is fine.
Gate evidence comes in two separate parts: the automated functional checks, and a playtest rubric that I score myself (PASS / FAIL / NOT CHECKED, with notes):

* did the wall feel real?
* did the gear I kept change my options?
* did the breakthrough land?
* did I want another run? ⛔

Phase 4: Balance simulator
Expand the 3b sim: configurable player strategies, N runs, CSV output (run #, level, power, zone reached, gold, drops), plus a markdown summary comparing results to the GDD pacing targets. ⛔
Phase 5: Cloud backup, then content expansion
Planned after Phase 4.
Start now
Do Step 0. Then give me a 5-line summary of your understanding plus any concerns about this plan, and begin Phase 0.
