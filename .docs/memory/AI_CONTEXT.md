# AI_CONTEXT.md
# Universal briefing file. Feed this to ANY AI model for full project context.
# Last updated: 2026-04-08 (Phase 1 complete)

---

## What Is This Project?

A **Playwright JS code-generation agent** that takes a natural language prompt
and outputs framework-compliant test automation code. The agent self-heals
broken selectors, tracks element health, and enforces strict architecture rules.

- **Target app**: SauceDemo (https://www.saucedemo.com/)
- **Language**: JavaScript
- **Framework**: Playwright Test
- **Repo**: d:\Github\My Agent\Playwright

---

## Architecture (Non-negotiable)

### Layer Order
```
Elements → BasePage → Page Object → Test file
```

### File Structure
```
src/elements/{Page}.elements.js    ← Locator definitions
src/pages/BasePage.js              ← Shared page object base
src/pages/{Page}.page.js           ← Page-specific methods (ALL logic here)
src/tests/{feature}/{name}.spec.js ← Test files (describe/test blocks only)
.agent/registry.json               ← Selector health tracking
.agent/method_index.json           ← Existing method registry
.agent/pending_patches.json        ← Config staging area
config/execution.config.js         ← Environment/URL config
config/testdata.config.js          ← Test data (TestData.get() helper)
```

### Locator Priority (Strict order)
1. `page.getByRole()` with accessible name
2. `page.getByLabel()`
3. `page.getByTestId()`
4. `page.locator('[data-test]')` / `page.locator('[data-qa]')`
5. `page.locator('#id')` — mark with `// [TIER-3: VERIFY STABILITY]`

### BANNED Locators
- XPath (any form)
- Class chains > 1 level
- Numeric attribute sequences > 4 digits
- `:nth-child`, `:nth-of-type`

### Code Rules
- Methods live in Page Objects. NEVER in test files.
- Test files: describe/test blocks + TestData.get() calls only.
- No hardcoded strings in test files. Ever.
- No inline comments explaining code. Only tagged comments allowed.

---

## Self-Healing System

### Registry States
| State | Condition | Action |
|---|---|---|
| HEALTHY | success_rate ≥ 0.85 | Use selector as-is |
| DEGRADED | 0.50–0.84 | Use selector, monitor |
| BROKEN | < 0.50 | Discard, generate new |
| QUARANTINE | heal_attempts ≥ 2 | Stop. Manual review required |

### Scout
- Runs once per page using Playwright (zero API cost)
- Extracts interactive elements: tag, role, label, testId, attributes
- Only sends unknown elements to the LLM

---

## Development Setup

### Tools
| Tool | Model | Role |
|---|---|---|
| **VS Code Chat** | Copilot Sonnet | Writing code (inline completions, agent mode) |
| **Antigravity IDE** | Claude Opus 4.6 | Architecture, reviews, debugging, commands |
| **Claude.ai** | Free → Pro (May) | Prompt engineering, design brainstorming |

### File Organization
| Folder | Owner |
|---|---|
| `.docs/memory/` | Project context docs (master_memory, project_context, this file) |
| `.docs/ag-generated/` | Files created by Antigravity IDE |
| `.docs/vs-generated/` | Files created by VS Code Copilot |
| `.docs/INSTRUCTIONS.md` | Universal rules for all AI tools |
| `.github/copilot-instructions.md` | Auto-loaded by Copilot |
| `src/` | Source code (both tools write here) |

---

## Key Decisions Made

- ActionEngine dropped → Playwright native auto-waiting is sufficient
- PostgreSQL dropped → Flat JSON registry works at SauceDemo scale
- Registry is `.agent/registry.json`, not a database
- `pending_patches.json` prevents config write collisions
- Method index uses atomic delta merge (STAGING → live promotion)
- Circuit breaker: QUARANTINE after 2 failed heal attempts
- Runtime code generation will use Claude Sonnet API (~$0.01-0.03/call)
- Elements file exports locator builder functions `(page) => page.locator(...)` — enables full Playwright API access per tier
- LoginPage.goto() uses `baseUrl` from execution.config (no hardcoded URLs anywhere)
- method_index.json initialised with `{ "stale": false, "methods": {} }` structure
- Config files live in `config/` folder (not project root) — keeps root clean
- All AI/docs folders consolidated under `.docs/` — hidden dot folder, declutters project explorer

---

## Build Progress

### Phase 1: Foundation
- [x] npm init + install Playwright
- [x] Project structure defined
- [x] AI context files created (master_memory, project_context, copilot-instructions)
- [x] Create folder structure (src/elements, src/pages, src/tests, .agent)
- [x] Build BasePage.js
- [x] Build execution.config.js
- [x] Build testdata.config.js
- [x] Create empty registry.json, method_index.json, pending_patches.json
- [x] Build Login.elements.js + Login.page.js
- [x] Build playwright.config.js
- [x] Write first manual login test → green pass ✅ (verified 2026-04-08)

### Phase 2: Scout
- [ ] Design scout_summary.json schema
- [ ] Build scout.js (DOM element discovery)
- [ ] CLI wrapper: `node scout.js --url <url> --page <pageName>`
- [ ] Run against SauceDemo pages

### Phase 3: Registry & Self-Healing
- [ ] Build registry-manager.js (CRUD + state transitions)
- [ ] Build heal.js (find replacement selectors)
- [ ] QUARANTINE logic
- [ ] Unit tests for state transitions

### Phase 4: Code Generator Core
- [ ] Build context-assembler.js
- [ ] Refine MASTER_MEMORY as system prompt (Claude Pro)
- [ ] Build generator.js (LLM API integration)
- [ ] Build output-validator.js
- [ ] Build file-writer.js + index-sync.js + patch-manager.js
- [ ] End-to-end test: prompt → output → green test

### Phase 5: CLI Orchestration
- [ ] Build agent-cli.js (scout, generate, heal, status commands)
- [ ] --dry-run flag
- [ ] README.md

### Phase 6: Validation
- [ ] Generate full SauceDemo test suite via agent
- [ ] CI pipeline (GitHub Actions)
- [ ] Test heal cycle + QUARANTINE flow
- [ ] Metrics: tokens/call, time/call, pass rate

---

## How To Use This File

**Claude.ai**: Paste this entire file at the start of a conversation.
**VS Code Copilot**: Reference with `#file:.docs/memory/AI_CONTEXT.md`
**Antigravity**: Reference with `@file` or it reads automatically.
**Any other AI**: Paste as context. It has everything.
