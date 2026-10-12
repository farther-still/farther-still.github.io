# Steadfast (ships as "Farther Still"): build rules

**Read `docs/STATUS.md` first, every session.** Design: `docs/GDD.md`. Structure: `docs/ARCHITECTURE.md`. Brief: `docs/KICKOFF.md`.

## Purpose

A personal iPhone PWA for Michael, its only player: an auto-battle, loot-farming inflation RPG that plays like the reference game ("RH") with every name, map, screen and asset original.

## Hard rules

1. Never invent facts about RH. Tag unconfirmed claims `[ASSUMPTION]`/`[OPEN]`, public-source claims `[WEB]`, ChatGPT-recap claims `[GPT]`. Confirmed means `reference/rh_notes.md` or a GDD decisions-log entry marked Confirmed; a ruling is not a fact about RH. Show Michael conflicts; his ruling goes in the log. Never fetch RH sources from the web.
2. Zero audio: no `<audio>`, `<video>`, `Audio()`, Web Audio or any media element. The game must never take the iOS audio session.
3. No monetization, ads or wall-clock mechanics: no refilling energy, cooldowns, daily resets or offline earnings. "Energy" is the per-run battle budget only.
4. Saves are sacred: any save-data change needs a migration and a test.
5. Content and balance numbers live in `data/`, never in code. Content IDs are permanent.
6. One source of truth: GDD (design), ARCHITECTURE (structure), this file (build rules), STATUS (state). Update them in the same commit as the code.
7. Repo and site are public. No secrets. `reference/` stays gitignored. RH's name, art and text never appear in the app or manifest; everything shipped is original.
8. Phased work. At each ⛔ gate: stop, post a gate report (Done / Verified as PASS, FAIL or NOT CHECKED with evidence / New tags / Questions / Next), wait for the literal reply "approved". Answers, questions or silence are not approval.
9. A machine-checkable rule gets a check (enforcement map below). An instruction alone is not enforcement.
10. Faithful by default: no systems RH lacks unless Michael asks. A proposed deviation names the frustration fixed, the cost and the risk, and waits for his ruling. If the benefit is unclear, keep RH's behavior.

## Spoilers

Michael approves systems and never sees content. Sealed: `docs/sealed/` and every `data/` file except `balance.json`, `content-spec.json` and `ids.lock.json`. Never put a zone theme or content name in chat, gate reports, commit messages, STATUS or check output; say Z1–Z8, E1–E3, T1–T4, or an ID. Content review: simulator, automated checks, a separate verifier pass.

## Folder map

File-level roles: ARCHITECTURE section 3. Not built until Phase 3b: `src/sim/` and the content files.

| Path | Role |
|---|---|
| `src/engine/` | Pure, deterministic rules: state, actions, battle, formulas, RNG, pathfinding. Imports nothing |
| `src/content/` | zod schemas and loaders turning `data/` into engine content |
| `src/save/` | Save schema, checksum, invariants, migrations, `SaveBackend`, export, import |
| `src/platform/` | Service worker, storage persistence, share sheet, diagnostics log |
| `src/ui/` | Screens (DOM), map and battle views (Canvas 2D), input, playback |
| `src/sim/`, `src/main.ts` | Headless simulator; app entry point |
| `data/` | `balance.json` (every balance number; Michael reviews it), `ids.lock.json`, `content-spec.json`, sealed content |
| `tests/` | Save fixtures (one frozen record per version), golden replays, hashed RH names |
| `scripts/` | Check scripts behind `npm run check` and `check:dist` |
| Root | Configs, `index.html`, `public/`, `.githooks/`, `.github/workflows/` |
| `reference/` | Private RH material; gitignored |

## Commands

Give Michael exact PowerShell commands; recommend, don't list options.

| Command | Does |
|---|---|
| `npm run dev` | Vite dev server; `-- --host` for the phone on LAN (layout only) |
| `npm run check` | Typecheck, lint, tests, content, repo and prose checks. Must pass before a commit |
| `npm run build`, `npm run check:dist`, `npm run preview` | Build; scan `dist/`; serve it on localhost to try the service worker |
| `npm run sim -- --runs 50` | From 3b: simulator against the GDD 5.9 pacing targets |
| `npm run refnames:build` | From 3b, local only: rebuild the hashed RH-name list |

## Conventions

- TypeScript strict, no `any`, named exports. No framework, no game engine.
- The engine is a reducer: `step(state, action, content)` returns new state and events, and rejects a disallowed action without throwing. UI and simulator call the same functions.
- In `src/engine/`: no DOM, clock, random or locale APIs. Only `+ − × ÷`, bit operations and `Math.sqrt`, `floor`, `ceil`, `trunc`, `min`, `max`, `abs`, `imul`. No `**`. Use the engine's own `log10`.
- Engine formulas hold no number literal but 0, 1, 2 and 100; the rest come from `balance.json`. Exempt: `math/`, `rng.ts`, `hash.ts`.
- Every roll draws from a named seeded stream in the order GDD 3.2 lists.
- Level, unspent points and remaining energy are derived, never stored.
- Save before show: commit the hot slot before animating a result. Never overwrite a save that could not be read; quarantine it.
- Tests sit beside the code (`*.test.ts`); each formula is tested at its GDD calibration points.
- Mobile first: iPhone portrait, safe-area insets, 44 pt tap targets, one-handed, no hover, no zoom.
- Markdown: one line per paragraph or bullet. Never hard-wrap.
- Commits: `Phase N: what changed`; docs in the same commit; sealed content in its own; push once checks pass. Use absolute paths in shell calls: `cd` moves the session.

## Save-change checklist

1. Bump `SAVE_VERSION` and add the next ordered migration.
2. In the same commit, add a fixture written by the new version: a full slot record with checksum. Never edit a fixture.
3. Update the save schema and the invariant checks.
4. Update the reset ledger (GDD 2.5) if a field was added or moved.
5. Every fixture must still load and migrate.

## Content rules

- IDs are opaque (`z01`, `e001`, `i001`), never reused or removed, recorded with their kind in `ids.lock.json`.
- Display names live only in `data/strings.en.json` and follow section S5 of the sealed appendix.
- Enemy stats come from level, zone, role and modifiers (GDD 5.4). Item lines are hand-written inside the GDD 5.6 budget; each zone names a reference loadout.

## Enforcement map

All but `check:dist` run in `npm run check`, run by the pre-commit hook and CI; `tests/enforcement.test.ts` proves each ban fires. From 3b: content checks, RH-name test, battle replays.

| Rule | Check |
|---|---|
| 2 audio | ESLint bans media globals; `check:dist` scans the build |
| 3 clock, ads | ESLint bans clock and random in the engine; build-time CSP; `check:dist` flags external URLs |
| 4 saves | Fixture tests (migrate, byte-exact round trip, rejected records kept); schema-hash and type-equality tests |
| 5 data and IDs | Lint rejects other number literals in the engine; ID lock compared with the previous commit |
| 7 secrets, RH | `check-repo` (`reference/` untracked, token patterns); hashed RH-name test; `check:dist` finds RH's title |
| Pure engine | Engine tsconfig without the DOM lib; `Math` allowlist; restricted imports |
| Determinism | Golden replays; on-device self-test in Settings |
| Content (GDD 7.9) | `scripts/check-content.ts` |
| Spoilers | `.gitattributes -diff`; checks print IDs only; `check-repo` finds content names in unsealed text |
| PWA, phone | Tests pin database and store names; `check:dist` checks manifest, CSP, viewport tag, no `:hover` |
| Prose | `scripts/check-prose.ts` (KICKOFF.md excluded) |
| 1, 6, 8, 10 | Instruction only: not machine-checkable |

## Definition of done

- `npm run check` passes; for anything shipped, `check:dist` passes too.
- GDD, ARCHITECTURE, this file and STATUS match the code, in the same commit.
- A new rule has a check, or is listed above as instruction only.
- Save changes followed the checklist. Golden replays changed only with a logged balance decision.
- STATUS todo and handoff are current. At a gate: report posted with evidence, then stop.
