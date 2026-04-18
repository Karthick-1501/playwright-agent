# Project Instructions

## Non-negotiable rules

1. **Layer order**: Elements → BasePage → Page Object → Test. Never skip or merge.
2. **BasePage ActionEngine**: All interactions in Page Objects go through `this.fill()`, `this.click()`, `this.getText()` etc. Never call locator functions directly. This is what feeds the registry.
3. **No hardcoded strings in test files**. Ever. Use `TestData.get('path')`.
4. **CommonJS only**. `require` / `module.exports`. No `import`/`export`.
5. **No Tier 4 locators**. XPath, class chains, `:nth-child` are banned.

## Before generating any code

1. Check `method_index.json` — if the method already exists, reference it. Don't regenerate.
2. Check `pending_patches.json` — if the config key already exists, don't propose it again.
3. Check the element's registry state — HEALTHY/DEGRADED → use existing locator. BROKEN → generate new. QUARANTINE → skip.

## After adding any method

Update `.agent/method_index.json` with the new method signature, description, `uses_elements`, and `source_file`.

## File write rules

- `src/elements/` — locator builder functions only. One object per page. `module.exports = { {Page}Elements }`.
- `src/pages/` — class extending `BasePage`. All business logic here.
- `src/tests/` — `test.describe` / `test` blocks only. No methods, no logic.
- `config/` — static config only. No runtime logic.

## Locator comment tags (use exactly these, no others)

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
