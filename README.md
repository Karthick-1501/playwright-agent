# Playwright AI Agent

An AI-powered code-generation agent that produces framework-compliant Playwright test automation code. The agent self-heals broken selectors, tracks element health via a local registry, and enforces strict architectural patterns.

## Architecture

```
Elements → BasePage → Page Object → Test file
```

| Layer | Path | Responsibility |
|---|---|---|
| Elements | `src/elements/{Page}.elements.js` | Locator definitions |
| Base Page | `src/pages/BasePage.js` | Shared page object base |
| Page Objects | `src/pages/{Page}.page.js` | All page-specific logic |
| Tests | `src/tests/{feature}/{name}.spec.js` | `describe`/`test` blocks only |
| Config | `config/` | Environment URLs + test data |

## Self-Healing Registry

Selectors are tracked in `.agent/registry.json` with health states:

| State | Condition | Action |
|---|---|---|
| `HEALTHY` | success_rate ≥ 0.85 | Use as-is |
| `DEGRADED` | 0.50–0.84 | Use + monitor |
| `BROKEN` | < 0.50 | Auto-heal with new selector |
| `QUARANTINE` | heal_attempts ≥ 2 | Manual review required |

## Quick Start

```bash
# Install
npm install
npx playwright install

# Run tests
npx playwright test

# Run with headed browser
npx playwright test --headed
```

## Project Structure

```
├── src/
│   ├── elements/          # Locator definitions per page
│   ├── pages/             # Page Objects (all logic here)
│   └── tests/             # Test specs
├── config/
│   ├── execution.config.js    # Environment/URL config
│   └── testdata.config.js     # Test data + TestData.get() helper
├── .agent/
│   ├── registry.json          # Selector health tracking
│   ├── method_index.json      # Existing method registry
│   └── pending_patches.json   # Config staging area
└── playwright.config.js
```

## Locator Priority

Selectors follow a strict tier system:

1. **Tier 1** — `page.getByRole()`, `page.getByLabel()` (semantic)
2. **Tier 2** — `page.getByTestId()`, `[data-test]`, `[data-qa]` (explicit hooks)
3. **Tier 3** — `#id` (structural, flagged for stability review)
4. **Tier 4** — ❌ XPath, class chains, `:nth-child` (banned)

## Target Application

[SauceDemo](https://www.saucedemo.com/) — Sauce Labs' demo e-commerce app.

## Status

🟢 Phase 1: Foundation — Complete  
⬜ Phase 2: Scout (DOM discovery)  
⬜ Phase 3: Registry & Self-Healing  
⬜ Phase 4: Code Generator Core  
⬜ Phase 5: CLI Orchestration  
⬜ Phase 6: Validation  

## License

ISC
