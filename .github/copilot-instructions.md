# Copilot Auto-Loaded Instructions

## MANDATORY: Before generating anything, read these files:
1. `.docs/INSTRUCTIONS.md` — universal rules
2. `.docs/memory/AI_CONTEXT.md` — full project context and build progress

## MANDATORY: After any change, update `.docs/memory/AI_CONTEXT.md`
- Check off completed tasks in Build Progress
- Add new decisions to Key Decisions Made
- This is non-negotiable. Every change gets recorded.

## Quick Reference (full details in INSTRUCTIONS.md)

### Layer Order
Elements → BasePage → Page Object → Test file

### File Ownership
- `src/elements/{Page}.elements.js` — Locator definitions
- `src/pages/{Page}.page.js` — Page Object methods (ALL logic here)
- `src/tests/{feature}/{name}.spec.js` — Test files (describe/test + TestData.get() only)
- Your generated notes → `.docs/vs-generated/` folder
- Do NOT touch `.docs/ag-generated/` — belongs to Antigravity IDE

### Locator Priority
1. `page.getByRole()` → 2. `page.getByLabel()` → 3. `page.getByTestId()` → 4. `[data-test]` → 5. `#id` (flag it)

### BANNED
XPath, class chains > 1 level, `:nth-child`, numeric attributes

### Code Rules
- Methods → Page Objects ONLY. Never in test files.
- No hardcoded strings in tests. Use `TestData.get()`.
- No explanatory comments. Only tagged comments (see .docs/INSTRUCTIONS.md Rule #6).
