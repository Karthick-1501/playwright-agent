# Playwright AI Test Agent

[![Playwright Tests](https://github.com/Karthick-1501/playwright-agent/actions/workflows/playwright.yml/badge.svg)](https://github.com/Karthick-1501/playwright-agent/actions/workflows/playwright.yml)

An AI-powered Playwright test automation framework with a **self-healing selector registry**, **CDP-based DOM discovery (Scout)**, and a **fully implemented orchestrator** that enforces a strict 4-layer architecture. The agent (Claude API) is a pure code translator — all deterministic logic lives in the orchestrator.

---

## Architecture

```
Elements → BasePage → Page Object → Test file
```

| Layer | Path | Responsibility |
|---|---|---|
| Elements | `src/elements/{Page}.elements.js` | Locator builder functions only |
| Base Page | `src/pages/BasePage.js` | ActionEngine + AssertEngine (registry-aware) |
| Page Objects | `src/pages/{Page}.page.js` | All page-specific business methods |
| Tests | `src/tests/{feature}/{name}.spec.js` | `describe`/`test` + `TestData.get()` only |
| Config | `config/` | Environment URLs + test data |

### Orchestrator vs Agent (hard boundary)

| Concern | Owner |
|---|---|
| Input presence validation | Orchestrator (`src/agent/orchestrator.js`) |
| Stale index halt + ack | Orchestrator |
| Registry state resolution | Orchestrator |
| Scout element filtering | Orchestrator |
| Interactive element input (Gate 4.5) | Orchestrator |
| Pending patch deduplication | Orchestrator |
| Tier 3 permission gate | Orchestrator |
| Post-call envelope validation | Orchestrator |
| File write + registry sync | Orchestrator |
| NL prompt → element matching | Agent |
| Locator tier selection | Agent |
| Code generation | Agent |
| Warning / clarification narration | Agent |

The orchestrator runs 7 deterministic gates before every Claude API call. The agent receives only clean, pre-resolved context and never re-validates inputs.

---

## Self-Healing Registry

Every test interaction is tracked in `.agent/registry.json` with four health states:

| State | Condition | What happens |
|---|---|---|
| `HEALTHY` | `success_rate ≥ 0.85` | Selector used as-is |
| `DEGRADED` | `0.50–0.84` | Selector used + flagged for monitoring |
| `BROKEN` | `< 0.50` | Auto-heal: Scout finds replacement, elements file patched |
| `QUARANTINE` | `heal_attempts ≥ 2` | Blocked — manual review required |

The healing loop is complete end-to-end:
1. `BasePage.click()` / `fill()` / `getText()` track results in a **debounced write queue** (500ms flush + `process.on('exit')` guarantee). Flush uses `mergeAndSave()` with lockfile-based merge to prevent parallel worker data loss — no per-interaction disk writes
2. `HealManager.healKey()` finds a replacement from Scout data
3. `orchestrator._syncElementsFile()` patches the source `elements.js` via line-based replacement — the fix reaches actual test execution

> **Lazy registry loading:** The registry is NOT loaded at module init. Each Playwright worker process gets its own Node.js module scope, so eager loading would read a stale snapshot. `_ensureRegistry()` loads on first interaction, and `mergeAndSave()` re-reads disk state inside a lockfile before writing, merging per-key by higher `total_runs` (then most recent `last_seen` as tiebreaker).

> **Dynamic registration:** Unknown registry keys are auto-registered on first interaction. The locator string and tier are extracted from the element builder function via `locatorFn.toString()` introspection, so the registry always stores real selector identity. The registry starts empty on fresh clones, and BasePage populates it during the first test run.

> **Error classification:** Not all failures are selector failures. BasePage classifies errors before recording: action `TimeoutError` (from `click`/`fill`) and `strict mode violation` degrade selector health, but network errors (`net::ERR_*`), browser crashes, and assertion errors — including assertion timeouts like `expect().toBeVisible()` timing out after page navigation — are skipped. The `expect(received)` string in error messages is exclusive to the assertion engine, making it a reliable discriminator.

---

## Quick Start

```bash
# Install
npm install
npx playwright install

# Run tests (headed)
npm test

# Run tests (headless, CI mode)
npm run test:ci

# Scout a page
node src/agent/scout.js --url https://demo.hyva.io/customer/account/login/ --page HyvaLogin

# Check registry health
npm run report

# Auto-heal broken selectors
npm run heal

# Run unit tests (registry + heal logic)
npm run test:registry
```

---

## AI Agent

The agent requires an Anthropic API key.

```bash
export ANTHROPIC_API_KEY=sk-ant-...

# Generate test code from a natural language prompt
npm run agent -- --prompt "generate a login test for standard_user" --page HyvaLogin

# With Tier 3 locators allowed
npm run agent -- --prompt "click the submit button" --page HyvaLogin --tier3

# Interactive mode — if Scout hasn't seen the element, describe it via stdin
npm run agent -- --prompt "click addToCartAimAnalogWatch" --page HyvaHome --interactive
```

The orchestrator will:
1. Validate all input files (Gates 1–2)
2. Resolve registry state for each element (Gate 3)
3. Filter Scout data using a 3-strategy heuristic: action-verb targets → noun extraction → page-name fallback (Gate 4)
4. **If Gate 4 misses and `--interactive` is set (Gate 4.5):** pause and ask you to describe the missing element via stdin — role, visible label, tier. No API cost is incurred during this wait. The answer is normalized into the same scout element shape the agent always expects.
5. Build forbidden config key list (Gate 5)
6. Resolve Tier 3 permission (Gate 6)
7. Call Claude API with the resolved context (`max_tokens: 8192`)
8. Validate and apply the response envelope (Gate 7)
9. Write generated files + sync the elements file via line-based replacement

---

## Project Structure

```
├── src/
│   ├── elements/                   # Locator builder functions per page
│   │   └── HyvaLogin.elements.js
│   ├── pages/                      # Page Objects
│   │   ├── BasePage.js             # ActionEngine + AssertEngine (debounced registry I/O)
│   │   └── HyvaLogin.page.js
│   ├── tests/                      # Test specs
│   │   └── hyva-login/
│   │       ├── hyva-login_happy_path.spec.js
│   │       └── hyva-login_sad_path.spec.js
│   ├── registry/                   # Selector health management
│   │   ├── registry-manager.js     # CRUD + state machine
│   │   └── heal.js                 # Candidate finding + healing
│   └── agent/                      # AI agent layer
│       ├── orchestrator.js         # 7 deterministic gates + apply envelope
│       ├── cli.js                  # CLI: --prompt / --heal / --report
│       └── scout.js                # CDP dual-pass DOM scanner (a11y+dom merge)
├── tests/                          # Unit tests (no Playwright dependency)
│   ├── registry-manager.test.js
│   ├── heal.test.js
│   ├── basepage-errors.test.js     # Error classification (_isLocatorError)
│   └── merge-save.test.js          # Parallel-safe mergeAndSave
├── config/
│   ├── execution.config.js         # Base URL
│   └── testdata.config.js          # Test data + TestData.get()
├── .agent/                         # Runtime data (gitignored, bootstrapped by globalSetup)
│   ├── registry.json               # Empty on fresh clone, populated dynamically
│   ├── method_index.json
│   ├── pending_patches.json
│   └── scout/
│       └── HyvaLogin_summary.json
├── .docs/
│   ├── memory/
│   │   ├── MASTER_MEMORY_v3.0.md   # Agent system prompt (operating constitution)
│   │   └── ORCHESTRATOR_SPEC_v1.0.md
│   └── INSTRUCTIONS.md
├── .github/workflows/
│   └── playwright.yml              # CI: unit tests + Playwright tests
├── globalSetup.js
└── playwright.config.js
```

---

## Locator Tier System

| Tier | API | Example | Status |
|---|---|---|---|
| 1 | `page.getByRole()`, `page.getByLabel()` | `page.getByRole('button', { name: 'Login' })` | Preferred |
| 2 | `page.locator('[data-test]')`, `page.getByTestId()` | `page.locator('[data-test="username"]')` | Explicit hooks |
| 3 | `page.locator('#id')` | `page.locator('#login-button')` | Structural — flag for review |
| 4 | XPath, class chains, `:nth-child` | — | **Banned** |

---

## Scout — DOM Element Discovery

Scout is a zero-API-cost utility that extracts interactive elements via Chrome DevTools Protocol before any test generation. It uses a **dual-pass merge**: CDP accessibility tree (roles, labels) + DOM overlay (data-test, id, placeholder), with case-insensitive matching to maximize `a11y+dom` source confidence. The compact JSON summary reduces token cost by 70–95% on real-world pages.

```bash
# Hyva Login
node src/agent/scout.js --url https://demo.hyva.io/customer/account/login/ --page HyvaLogin

# Any page
node src/agent/scout.js --url https://example.com/checkout --page Checkout
```

### Benchmark Results

| Page | Raw tokens | Scout tokens | Reduction | Elements | Warnings |
|---|---|---|---|---|---|
| HyrTutorials | ~180,030 | ~8,622 | **95.2%** | 91 | 11 (iframes) |
| EaseCloud XPath | ~28,748 | ~4,501 | **84.3%** | 47 | 0 |
| SelectorsHub | ~47,210 | ~13,155 | **72.1%** | 136 | 3 (1 shadow, 2 iframe) |
| SauceDemo Login | ~354 | ~363 | -2.5% | 4 | 0 |

> SauceDemo login shows -2.5% because the page is intentionally minimal. The benefit scales with DOM complexity.

---

## Phase Status

| Phase | Description | Status |
|---|---|---|
| 1 | Foundation: 4-layer architecture, login test, config | ✅ Complete |
| 2 | Scout: CDP dual-pass DOM scanner | ✅ Complete |
| 3 | Registry & Self-Healing: state machine + heal manager | ✅ Complete |
| 4 | Code Generator: orchestrator (7 gates) + Claude API | ✅ Complete |
| 5 | CLI Orchestration: `--prompt`, `--heal`, `--report` | ✅ Complete |
| 6 | Validation: CI, unit tests, end-to-end | ✅ Complete |
| 7 | Interactive Mode: Gate 4.5 stdin fallback for unscanned elements | ✅ Complete |

---

## Target Application

[Hyva Demo](https://demo.hyva.io/) — Magento 2 frontend architecture used as the primary target for complex E2E test generation.

## License

ISC
