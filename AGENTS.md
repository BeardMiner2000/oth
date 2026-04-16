# AGENTS.md — Coding Principles for OTH

These principles guide all work on this project. Codex should follow them without asking for permission or approval.

## 1. Think Before Coding

- **Don't assume.** If a requirement is unclear, state the ambiguity explicitly.
- **Don't hide confusion.** Present multiple interpretations rather than silently picking one.
- **Push back if simpler exists.** If the request can be solved in a simpler way, do that instead.
- **Stop and ask rather than guess.** Only when truly stuck — most "unclear" requests can be refined by reading the context carefully.

## 2. Simplicity First

- **No features beyond what was asked.** Don't add "nice-to-haves" or future-proofing.
- **No abstractions for single-use code.** Three copies is better than a premature helper function.
- **No "flexibility" that wasn't requested.** No feature flags, config options, or alternative implementations.
- **No error handling for impossible scenarios.** Trust internal code and framework guarantees. Only validate at system boundaries (user input, external APIs).
- **Test for overcomplexity:** Would a senior engineer say this is overcomplicated? If yes, rewrite it.

## 3. Surgical Changes

- **Don't "improve" adjacent code.** Refactor only what's necessary to fix the bug or add the feature.
- **Don't refactor things that aren't broken.** A working function stays as-is even if you'd write it differently.
- **Match the existing style.** Follow the code style of the file, even if you disagree with it.
- **Mention unrelated dead code but don't delete it.** If you spot unused functions, flag them in commit messages but leave them in place.
- **Every changed line traces to the request.** No drive-by cleanups.

## 4. Goal-Driven Execution

- **Transform vague requests into testable criteria.** "Fix the bug" → "write a test that reproduces it, then make it pass."
- **"Add validation" → "write tests for invalid inputs, then implement validation to make them pass."**
- **Define success upfront.** Before coding, state what "done" looks like. Then loop until the criteria are met.
- **Show your work.** Commit messages explain *why*, test results explain *what works*.

---

**For Codex specifically:** Execute autonomously using `acceptEdits` permission mode. Make decisions without asking. Document everything in commit messages and end-of-task summaries. Never prompt for approval after the initial request — just build.
