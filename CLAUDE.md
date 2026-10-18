# Esports Platform — implementation instructions

## Authority
1. Explicit project-owner instructions and the attached ESP-SRS in Requirements.md determine product scope.
2. IMPLEMENTATION_DECISIONS.md applies the template engineering choices without weakening the ESP-SRS.
3. The active ESP prompt expands execution details; it cannot delete scope.
4. DECISIONS.md and repository conventions resolve documented implementation details.

## Execution
- Run exactly seven top-level prompts, ESP-01 through ESP-07, in manifest order. No slices or extra implementation prompts.
- Confirm at least one Git commit with `git rev-list --all --count` before implementing. Stop and report setup instructions if none exists.
- Inspect the repository first. Preserve user changes and existing source files; scaffold in a temporary folder if necessary.
- Deliver real end-to-end behavior, not plan-only output, placeholder screens or fake integration success.
- All requirements are full-product scope. A checkpoint or exhausted context is not stage completion. Persist progress and resume the SAME prompt.
- No optional delegation requirement. Use specialists only for separable work if useful, and avoid overlapping edits. At most one independent reviewer pass for high-risk work.
- Never create signed state, automatic retry/completion loops, Stop hooks, or custom verifier engines.
- Do not read or create real secret files or dump credential-bearing environment variables. Use `.env.example`; the developer runs `06-CREATE-LOCAL-ENV.cmd` locally when needed.
- Requirements.md, IMPLEMENTATION_DECISIONS.md, CLAUDE.md, README_START_HERE_FA.md, .claude/, tools/, prompts/ and .esports-backups/ are source material protected during product implementation. Approved design changes are made separately by the owner.
- Update PROJECT_STATUS.md, IMPLEMENTATION_STATUS.md, DECISIONS.md and REQUIREMENTS_TRACEABILITY.md when facts change; keep unfinished stages unchecked.
- Run checks appropriate to identity, money, results, concurrency, files, security, accessibility and operational risk. Record commands and actual results; unavailable tests stay unverified.
- Development adapters do not prove production readiness. Missing providers/rules/licenses must be explicit, never bypassed by fake production data.
- Persian RTL/BiDi and Iran-hosted or Iranian runtime services apply throughout.
- Include code and its status changes in one reviewable commit after acceptance. Do not commit user secrets or perform unrequested public deployment/payment.

## Completion report
Report behavior, important changed files, actual commands/tests, decisions/blockers, residual risks, next eligible ESP prompt, and exact resume location if unfinished.
