# Sealed folder

**Michael: do not open the other files in this folder.** They hold what the spoiler policy keeps unseen until you meet it in play: zone themes and every content name (decisions Q12 and G2 in `docs/GDD.md`).

This README is safe to read. It says only how the folder works.

- `docs/GDD.md` is the design. It refers to zones as Z1–Z8, elements as E1–E3 and enemy types as T1–T4. The files here say what those stand for.
- `.gitattributes` marks everything in this folder except this README as hidden in diffs, so `git diff` and `git show` do not print the contents, and GitHub collapses them.
- Nothing in this folder is quoted in chat, gate reports, commit messages or `docs/STATUS.md`.
- Review of this folder is by automated content checks and a separate verifier pass, never by you.
