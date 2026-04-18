# Copilot Auto-Loaded Instructions
# Full agent spec: .docs/memory/MASTER_MEMORY_v3.0.md
# Orchestrator contract: .docs/memory/ORCHESTRATOR_SPEC_v1.0.md
# This file is a binding summary for VS Code Copilot.

---

## MANDATORY: Read before generating anything
1. `.docs/INSTRUCTIONS.md` — universal project rules
2. `.docs/memory/AI_CONTEXT.md` — build progress + key decisions

## MANDATORY: After any change
Update `.docs/memory/AI_CONTEXT.md` — check off completed tasks, record new decisions.

---

## Architecture: Orchestrator vs Agent

Two distinct layers with a hard boundary:

**Orchestrator** (`src/agent/orchestrator.js` — deterministic, 7 gates):
1. Input presence validation
2. Stale index detection
3. Registry state pre-resolution (HEALTHY/DEGRADED/BROKEN/QUARANTINE)
4. Scout element filtering (only matched elements sent to agent)
5. Pending patch deduplication (builds `forbidden_keys[]`)
6. Tier 3 locator permission
7. Post-call envelope validation + file write + elements file sync

**Agent** (Claude API, `MASTER_MEMORY_v3.0.md` as system prompt):
- NL prompt → element matching
- Locator tier selection given pre-resolved registry state
- Generating Playwright code into the correct framework layer
- Warning/clarification narration

**The agent NEVER validates inputs. The orchestrator NEVER writes Playwright code.**

---

## Layer Order (non-negotiable)
```
Elements → BasePage → Page Object → Test file
```

## BasePage Contract — CRITICAL

All interactions MUST go through BasePage ActionEngine. Never call locator functions directly.

```javascript
// CORRECT — registry tracks this interaction
await this.fill('Login.usernameInput', LoginElements.usernameInput, username);
await this.click('Login.loginButton', LoginElements.loginButton);

// WRONG — bypasses registry, breaks health tracking
await LoginElements.usernameInput(this.page).fill(username);
```

---

## File Ownership

| Path | Rule |
|---|---|
| `src/elements/{Page}.elements.js` | Locator builder functions ONLY |
| `src/pages/BasePage.js` | ActionEngine + AssertEngine — never modify without updating method_index |
| `src/pages/{Page}.page.js` | ALL page-specific business methods |
| `src/tests/{feature}/{name}.spec.js` | `describe`/`test` + `TestData.get()` ONLY |
| `src/agent/orchestrator.js` | 7 deterministic gates — do not add LLM calls here |
| `src/agent/cli.js` | CLI entry point |
| `src/agent/scout.js` | CDP dual-pass scanner |
| `config/execution.config.js` | Base URL only |
| `config/testdata.config.js` | Test data — access via `TestData.get('path.to.value')` |
| `.agent/registry.json` | Selector health store — synced by orchestrator |
| `.agent/method_index.json` | Existing method registry — update after adding methods |
| `.agent/pending_patches.json` | Config patches staging area |

---

## Locator Tier Priority

| Tier | API | Status |
|---|---|---|
| 1 | `page.getByRole()` / `page.getByLabel()` | Preferred |
| 2 | `page.locator('[data-test]')` / `page.getByTestId()` | Explicit hooks |
| 3 | `page.locator('#id')` — only if `tier3_allowed == true` | Flag: `// [TIER-3: VERIFY STABILITY]` |
| 4 | XPath, class chains, `:nth-child` | **BANNED** |

---

## Allowed Comments (only these — no explanatory prose in generated code)
```
// [REGISTRY-HEALED v{n}]
// [REGISTRY-DEGRADED: monitor]
// [REGISTRY-BROKEN: replacement generated]
// [SCOUT-GENERATED]
// [AGENT-GENERATED]
// [AGENT-GENERATED: DOM-ONLY]
// [TIER-3: VERIFY STABILITY]
// [QUARANTINE: MANUAL REVIEW REQUIRED - {detail}]
```

---

## Hard Limits — do not generate, flag and stop
- Shadow DOM, cross-origin iframes, browser dialogs
- XPath in any form
- Hardcoded strings in test files
- QUARANTINE selectors
- Visual regression, API mocking, multi-tab orchestration
- Disabled element interactions
