# Steadfast (codename) — build rules (stub; expanded in Phase 2)

**Read `docs/STATUS.md` first, every session.** Full brief: `docs/KICKOFF.md`. Design truth: `docs/GDD.md` (Phase 1).

## Hard rules

1. Never invent facts about the reference game. Tag unconfirmed claims `[ASSUMPTION]`/`[OPEN]`; public-source claims `[WEB]`; ChatGPT-recap claims `[GPT]`. Only `reference/rh_notes.md` is confirmed. Show Michael conflicts; his ruling goes in the decisions log.
2. Zero audio: no `<audio>`, `<video>`, `Audio()`, Web Audio, or any media element.
3. No monetization, ads, or wall-clock mechanics. "Energy" is the per-run battle budget only.
4. Saves are sacred: any save-data change needs a migration and a test.
5. Content and balance numbers live in `data/`, never hardcoded. Content IDs are permanent.
6. One source of truth: `docs/GDD.md` (design), `CLAUDE.md` (build rules), `docs/STATUS.md` (state). Update them in the same commit as the code.
7. Repo and site are public. No secrets. `reference/` stays gitignored. The reference game's name, art, and text never appear in the app or manifest; everything shipped is original.
8. Phased work. At each ⛔ gate: stop, post a gate report (Done / Verified / New tags / Questions / Next), wait for the literal reply "approved". Questions or silence are not approval.
9. A machine-checkable rule gets a check (lint, typecheck, test, CI, hook).
10. Faithful by default: no systems the reference game lacks unless Michael asks. A proposed deviation names the frustration fixed, the cost, and the risk.

## Working rules

- Never fetch reference-game sources from the web.
- Engine (`src/engine/`) is pure and deterministic: no DOM, no `Math.random`/`Date.now`/`performance.now`.
- No hard-wrapped prose in markdown: one line per paragraph or bullet.
- Give Michael exact PowerShell commands; recommend, don't list options.
