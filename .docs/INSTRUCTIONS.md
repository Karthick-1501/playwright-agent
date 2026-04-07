# INSTRUCTIONS.md
# Universal project instructions. Every AI tool MUST read this before generating anything.
# Location: .docs/ — referenced by all IDEs and AI tools.

---

## Rule #1: Read Before You Write

Before generating ANY code or file, you MUST read:
1. **This file** (`.docs/INSTRUCTIONS.md`) — project rules
2. **`.docs/memory/AI_CONTEXT.md`** — full project context, architecture, and progress

If you skip these, your output WILL violate the framework contract.

---

## Rule #2: Update AI_CONTEXT.md on Every Change

After making ANY of the following, update `.docs/memory/AI_CONTEXT.md`:
- ✅ New architectural decision
- ✅ Completed a build phase task (check it off)
- ✅ Changed a design pattern or file structure
- ✅ Added/removed a dependency
- ✅ Changed tool assignments or workflow
- ✅ Discovered a bug or limitation worth noting

**Format**: Update the relevant section. Add new decisions to "Key Decisions Made".
Check off completed tasks in "Build Progress".

This file is the project's living memory. If it's not in AI_CONTEXT.md, it didn't happen.

---

## Rule #3: File Ownership

| Folder | Who Creates Files Here |
|---|---|
| `.docs/ag-generated/` | Antigravity IDE ONLY |
| `.docs/vs-generated/` | VS Code Copilot ONLY |
| `.docs/memory/` | Either tool (with explicit user request) |
| `src/` | Either tool (source code) |
| `.agent/` | Either tool (agent runtime data) |
| `.github/` | Either tool (GitHub configs) |

**Never** create planning/analysis files in `src/` or project root.
**Never** write source code into `.docs/ag-generated/` or `.docs/vs-generated/`.

---

## Rule #4: Framework Contract (Summary)

Full details in `.docs/memory/master_memory.md`. Key rules:

### Layer Order (Non-negotiable)
```
Elements → BasePage → Page Object → Test file
```

### Locator Priority
1. `page.getByRole()` → 2. `page.getByLabel()` → 3. `page.getByTestId()` → 4. `page.locator('[data-test]')` → 5. `page.locator('#id')` (with stability flag)

### BANNED
- XPath, class chains > 1 level, `:nth-child`, numeric attribute sequences

### Method Rules
- Methods → Page Objects only. NEVER in test files.
- Test files → `describe/test` + `TestData.get()` only.
- No hardcoded strings in tests.

---

## Rule #5: Before Generating Code

1. Check `.docs/memory/AI_CONTEXT.md` → "Build Progress" to know what exists
2. Check `.agent/method_index.json` → don't duplicate existing methods
3. Check `.agent/registry.json` → use healthy selectors, don't regenerate
4. Follow the layer order: Elements → BasePage → Page Object → Test
5. After generating, update AI_CONTEXT.md with what you created

---

## Rule #6: Comment Standards

Only these comments are permitted in generated code:
```
// [REGISTRY-HEALED v{n}]
// [REGISTRY-DEGRADED: monitor]
// [REGISTRY-BROKEN: replacement generated]
// [SCOUT-GENERATED]
// [AGENT-GENERATED]
// [TIER-3: VERIFY STABILITY]
// [QUARANTINE: MANUAL REVIEW REQUIRED - {detail}]
```

No explanatory comments. No TODOs. No "this function does X" comments.

---

## File Reference Map

| File | Purpose | When to Read |
|---|---|---|
| `.docs/INSTRUCTIONS.md` | Rules (this file) | Always, first |
| `.docs/memory/AI_CONTEXT.md` | Full context + progress | Always, second |
| `.docs/memory/master_memory.md` | Agent constitution (detailed) | When generating framework code |
| `.docs/memory/project_context.md` | Architecture decisions (detailed) | When making design decisions |
| `.github/copilot-instructions.md` | VS Code Copilot auto-loaded rules | Auto (Copilot only) |
