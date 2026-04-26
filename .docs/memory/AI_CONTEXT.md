# AI_CONTEXT.md
# Build Progress + Key Decisions
# Update this file after every session.

---

## Current State: v4.0 — All Phases Complete

### Phase Checklist

- [x] Phase 1: Foundation — 4-layer architecture, hyva login test, config
- [x] Phase 2: Scout — CDP dual-pass DOM scanner + benchmark data
- [x] Phase 3: Registry & Self-Healing — RegistryManager + HealManager + unit tests
- [x] Phase 4: Code Generator — orchestrator (7 gates) + Claude API integration
- [x] Phase 5: CLI Orchestration — `--prompt`, `--heal`, `--report` via `src/agent/cli.js`
- [x] Phase 6: Validation — GitHub Actions CI + unit tests + end-to-end heal loop

---

## Architecture Decisions

### v3.0 → v4.0 (current session)

**Gap 1 fixed: Registry ↔ Elements file sync**
- Problem: `registry.json` locators and `HyvaLogin.elements.js` locators were independent, so healed selectors never reached test execution.
- Fix: `orchestrator._syncElementsFile()` patches the elements file after every `registry_updates` envelope entry. The heal loop is now end-to-end.

**Gap 2 fixed: BasePage stub → full ActionEngine + AssertEngine**
- Problem: `BasePage` was 7 lines with only `navigate()`. `total_runs` stayed at 0 forever.
- Fix: `BasePage` now owns `fill()`, `click()`, `getText()`, `isVisible()`, `assertVisible()`, `assertText()`. Every call wraps in try/catch and calls `registry.recordSuccess()` or `recordFailure()` + `registry.save()`. Registry tracking is non-blocking (failures never surface to test).

**Gap 3 fixed: Orchestrator exists as code**
- Problem: `ORCHESTRATOR_SPEC_v1.0.md` described Gates 1–7 as pseudocode only. No `orchestrator.js` file existed. The agent had no caller.
- Fix: `src/agent/orchestrator.js` implements all 7 gates. `runAgent(userPrompt, options)` is the main entry point.

**Gap 4 fixed: CLI entry point**
- Problem: No way to invoke the agent or healer from the command line.
- Fix: `src/agent/cli.js` exposes `--prompt`, `--heal`, `--report` modes. Wired into `package.json` scripts.

**Gap 5 fixed: headless hardcoded**
- Problem: `playwright.config.js` had `headless: false` — broken in CI.
- Fix: `headless: process.env.CI === 'true' || process.env.HEADLESS === 'true'`.

**Gap 6 fixed: No CI**
- Problem: Zero GitHub Actions, no green badge.
- Fix: `.github/workflows/playwright.yml` — unit tests + Playwright tests on push/PR, HTML report uploaded as artifact.

**Gap 7 fixed: `_scoreCandidate` misfires on substring matches**
- Noted: scorer uses substring matching which can prefer `signOutButton` over `signInButton`. Tier priority mitigates this (exact same-tier case is the risk). Flagged for Phase 6 improvement — exact-key match should short-circuit fuzzy scoring.

### v2.1 → v3.0

- MASTER_MEMORY was acting as a script (embedding deterministic control flow for the LLM to simulate). Hard split:
  - MASTER_MEMORY v3.0 (~100 lines): semantic reasoning only — the agent's operating constitution
  - ORCHESTRATOR_SPEC v1.0: all deterministic gates extracted as JS pseudocode
- Agent is purely a code translator and locator router
- Orchestrator owns all control flow

---

## Key Technical Decisions

| Decision | Rationale |
|---|---|
| Registry tracking is non-blocking in BasePage | A broken registry must never cause a test failure |
| Orchestrator syncs elements file, not agent | Agent generates code; file system writes are deterministic — orchestrator owns them |
| `.agent/` is gitignored | Runtime data, not source. Bootstrapped by `globalSetup.js` |
| `pending_patches.json` guard | Silent duplicate config key generation is a real failure mode |
| `max_tokens: 800` enforced via API param | LLMs cannot self-count tokens — the limit belongs in the API call, not the prompt |
| `tmp + rename` for all file writes | Atomic writes prevent corrupt JSON on crash |
| Scout Tier priority: data-test > role+name > #id | Matches MASTER_MEMORY tier system |

---

## Differentiators (vs Playwright MCP, Verdex, etc.)

The dual-pass Scout pattern has converged across tools. Real differentiators:
1. **Persistent selector registry with health-scored state machine** — not just generation, but ongoing health tracking
2. **Versioned operating constitution** (MASTER_MEMORY) — the agent's behaviour is codified and version-controlled
3. **Framework-aware code generation** into the strict 4-layer architecture
4. **Config patch ownership protocol** (`pending_patches.json` guard prevents silent duplicates)
5. **End-to-end heal loop** — healed locators reach test execution by patching the elements file

---

## Open Items / Next Steps

- [ ] Improve `_scoreCandidate` to exact-key match first, fuzzy second
- [ ] Add `last_scouted` timestamp per page to registry for Scout staleness detection
- [ ] Docker setup for fully portable execution
- [ ] Expand to Inventory page (Phase 2 Scout benchmarks show feasibility)
- [ ] HTML dashboard UI for registry health report
