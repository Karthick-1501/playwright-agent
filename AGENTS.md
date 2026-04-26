# Playwright AI Agent — Project Instructions

## Architecture

Strict 4-layer pattern. Never skip or merge layers:

```
Elements → BasePage → Page Object → Test
```

| Layer | Path | Rule |
|---|---|---|
| Elements | `src/elements/{Page}.elements.js` | Locator builder functions ONLY — no logic |
| Base Page | `src/pages/BasePage.js` | ActionEngine + AssertEngine (registry-aware) |
| Page Objects | `src/pages/{Page}.page.js` | ALL page-specific business methods |
| Tests | `src/tests/{feature}/{name}.spec.js` | `describe`/`test` + `TestData.get()` ONLY — no logic |

### Orchestrator vs Agent (hard boundary)

| Concern | Owner |
|---|---|
| Input presence validation | Orchestrator (`src/agent/orchestrator.js`) |
| Stale index halt + ack | Orchestrator |
| Registry state resolution | Orchestrator |
| Scout element filtering | Orchestrator |
| Pending patch deduplication | Orchestrator |
| Tier 3 permission gate | Orchestrator |
| Post-call envelope validation | Orchestrator |
| File write + registry sync | Orchestrator |
| NL → element matching | Agent (`MASTER_MEMORY_v3.0.md`) |
| Locator tier selection | Agent |
| Code generation | Agent |
| Warning/clarification narration | Agent |

## Module System

CommonJS only. Always use `require` / `module.exports`. Never use `import`/`export`.

## BasePage Contract

All interactions in Page Objects MUST go through BasePage ActionEngine methods.
Never call `locatorFn(this.page).fill()` directly — always via `this.fill(registryKey, locatorFn, value)`.

This ensures every interaction is tracked in the registry.

```javascript
// CORRECT
await this.fill('HyvaLogin.emailInput', HyvaLoginElements.emailInput, email);
await this.click('HyvaLogin.signInButton', HyvaLoginElements.signInButton);

// WRONG — bypasses registry tracking
await HyvaLoginElements.emailInput(this.page).fill(email);
```

### Registry I/O

BasePage uses a **lazy-loaded registry singleton** — the registry is NOT loaded at
module init. Each Playwright worker process gets its own Node.js module scope, so
eager loading would read a stale snapshot. Instead, `_ensureRegistry()` loads on
first interaction.

Mutations accumulate in memory during test execution and flush to disk on a
**debounced write queue** (500ms) with `process.on('exit')` guarantee. The flush
uses `mergeAndSave()`, which acquires an exclusive lockfile, re-reads disk state,
merges per-key (higher `total_runs` wins, then most recent `last_seen`), and
writes back atomically. This prevents parallel workers from overwriting each
other's data.

Unknown registry keys are **auto-registered** on first interaction — no seed data required.
At registration time, the locator string and tier are extracted from the element
builder function via `locatorFn.toString()` introspection, so the registry always
stores the actual selector identity (never `null`).

### Error Classification

BasePage classifies errors before recording failures to prevent environment
flakiness from poisoning selector health scores:

| Error Type | Examples | Registry Impact |
|---|---|---|
| **Locator errors** | `TimeoutError` from actions (click/fill), strict mode violation, element intercepted, detached from DOM | `recordFailure()` — selector health degrades |
| **Environment errors** | `Target closed`, `net::ERR_*`, browser crashed, `Protocol error` | Skipped — selector health unchanged |
| **Assertion errors** | `expect(received).toBeVisible()` / `.toHaveText()` — including assertion timeouts | Skipped — element found or assertion-layer problem, not a selector issue |

## Locator Tier System

Apply the highest available tier. Tier 4 is banned.

| Tier | API | Example |
|---|---|---|
| 1 | `page.getByRole()`, `page.getByLabel()` | Semantic — preferred |
| 2 | `page.locator('[data-test="x"]')`, `page.getByTestId()` | Explicit hooks |
| 3 | `page.locator('#id')` | Structural — flag for review |
| 4 ❌ | XPath, class chains, `:nth-child` | **Banned** |

## Self-Healing Registry (`.agent/`)

`.agent/` is gitignored and bootstrapped automatically by `globalSetup.js` on first `npx playwright test`.
The registry starts **empty** — BasePage dynamically populates it during test execution.

**Files:**
- `.agent/registry.json` — selector health per element key (e.g. `HyvaLogin.emailInput`)
- `.agent/method_index.json` — all page object methods with signatures + dependencies
- `.agent/pending_patches.json` — staging area for config patches proposed by the agent
- `.agent/scout/` — Scout output per page (e.g. `HyvaLogin_summary.json`)

**Health states:**

| State | Condition | Action |
|---|---|---|
| `HEALTHY` | `success_rate ≥ 0.85` | Use as-is |
| `DEGRADED` | `0.50–0.84` | Use + flag for monitoring |
| `BROKEN` | `< 0.50` | Auto-heal with candidate from Scout |
| `QUARANTINE` | `heal_attempts ≥ 2` | Block — manual review required |

Registry keys use the format `{Page}.{elementName}` (e.g. `HyvaLogin.signInButton`).

**The heal loop is end-to-end:**
1. BasePage records success/failure after every interaction (debounced flush to disk)
2. `npm run heal` triggers `HealManager.healAllBroken()`
3. Orchestrator syncs the patched locator back to `src/elements/{Page}.elements.js` via line-based replacement

## Config

- **URLs / env**: `config/execution.config.js` — exports `{ baseUrl }`
- **Test data**: `config/testdata.config.js` — access via `TestData.get('hyva_login.standard_user')`
- **Playwright config**: `playwright.config.js` — CI-aware (`process.env.CI`)

## File Naming Conventions

```
src/elements/{Page}.elements.js      # PascalCase page name
src/pages/{Page}.page.js
src/tests/{feature}/{name}.spec.js   # kebab-case feature and name
```

## Allowed Comments (only these — no explanatory comments in generated code)

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

## Hard Limits — Do not generate. Flag and stop.

- Shadow DOM locators (`SHADOW_DOM_DETECTED` in scout warnings)
- Cross-origin iframe interactions (`IFRAME_DETECTED` in scout warnings)
- Browser dialog interactions (alert, confirm, prompt)
- XPath in any form
- Hardcoded string values in test files
- Any selector in QUARANTINE state
- Visual regression assertions
- API mocking / network interception
- Multi-tab orchestration
- Interactions with disabled elements

## Build & Test

```bash
npm install && npx playwright install
npm test                    # headed
npm run test:ci             # headless (CI mode)
npm run test:registry       # unit tests only
npm run scout -- --url https://demo.hyva.io/customer/account/login/ --page HyvaLogin
npm run heal
npm run report
npm run agent -- --prompt "generate login test" --page HyvaLogin
```

## Phase Status

- ✅ Phase 1: Foundation
- ✅ Phase 2: Scout
- ✅ Phase 3: Registry & Self-Healing
- ✅ Phase 4: Code Generator (orchestrator + agent)
- ✅ Phase 5: CLI Orchestration
- ✅ Phase 6: Validation (CI + unit tests)
