# Issues Faced — Playwright AI Agent Integration

## Background

The project is an AI-powered Playwright test automation framework targeting `demo.hyva.io`. The agent pipeline works in four layers: Elements, BasePage, Page Object, Test. The orchestrator runs 7 deterministic gates before calling the Claude API. All generation goes through `node src/agent/cli.js`.

This document covers issues found after the Anthropic API key was connected and first generation attempts were run.

---

## Issue 1 — Orchestrator silently dropped clarifications

**What happened**

Running `node src/agent/cli.js --prompt "generate login test" --page HyvaLogin` completed all 7 gates and called the API. The last line printed was `[ORCHESTRATOR] Gate 7: envelope validated`. No files were written, no errors were shown, no output at all.

Debugging via `runAgent()` directly revealed the agent had returned 5 clarification questions in `clarifications[]` and zero files. The orchestrator logged `files`, `registry_updates`, and `warnings` but had no code path for `clarifications`.

**Fix**

Added a logging block at the end of `runAgent()` in `orchestrator.js` that prints each clarification question numbered, with a re-run hint. Also added a fallback warning when both `files` and `clarifications` are empty so a zero-output run is never silent.

```js
if ((validated.clarifications || []).length) {
  console.log(`\n[ORCHESTRATOR] Agent needs clarification (${validated.clarifications.length}):`);
  validated.clarifications.forEach((c, i) => console.log(`    ${i + 1}. ${c}`));
  console.log(`\n  Re-run with a more specific --prompt that answers the above.`);
}

if (!results.filesWritten.length && !results.registryUpdated.length && !(validated.clarifications || []).length) {
  console.log(`  No files written and no clarifications returned. Check agent context.`);
}
```

---

## Issue 2 — Gate 4 matched wrong element for HyvaLogin

**What happened**

The prompt `"generate login test"` was tokenized by Gate 4. After stop-word filtering the only surviving token was `"login"`. Gate 4 searched `HyvaLogin_summary.json` for elements whose key or label contained `"login"` and matched one element: `HyvaLogin.mainWebsiteStore`, a store-switcher button with nothing to do with the login form.

The agent received one irrelevant element, had no email/password/sign-in context, and responded with clarifications instead of code.

**Fix**

The fix is in how prompts are written, not in the orchestrator. Vague prompts will always trigger this. The correct pattern is to name the elements explicitly:

```
node src/agent/cli.js \
  --prompt "generate happy path test filling emailInput with hyva_login.standard_user.email, passwordInput with hyva_login.standard_user.password, clicking signInButton, assert URL contains customer/account" \
  --page HyvaLogin
```

No code change required. Documented as a usage rule.

---

## Issue 3 — HyvaProductList.blue locator was BROKEN

**What happened**

The blue color filter locator was:

```js
blue: (page) => page.locator('[data-role="layered-filter-block"]').getByRole('radio', { name: 'Blue' })
```

This failed twice. On the Hyva demo site, color filter options render as links not radio inputs. The `[data-role]` attribute also varied across page states.

**Fix**

Replaced with a Tier 1 locator:

```js
blue: (page) => page.getByRole('link', { name: 'Blue' })
```

Registry state reset to HEALTHY, heal_version bumped to 2.

---

## Issue 4 — HyvaProductList.price was a non-locator registered as a locator

**What happened**

The registry contained `HyvaProductList.price` pointing to:

```js
page.getByRole('option', { name: 'Price' })
```

This was BROKEN after 1 run. The `<option>` element inside a `<select>` is not directly interactable in Playwright. `sortByPrice()` works by calling `selectOption(sortBy, 'price')` where `'price'` is the value string passed to the combobox. There is no locator needed for the option itself.

**Fix**

Removed `HyvaProductList.price` from the elements file and from the registry. Added a comment in the elements file clarifying that `'price'` is a value string, not an element.

---

## Issue 5 — HyvaHome.minicartSubtotal locator was BROKEN

**What happened**

The locator was:

```js
page.getByText(/subtotal/i)
```

This matched multiple text nodes across the page including footer text. The assertion timed out with a strict mode violation.

**Fix**

Replaced with a locator scoped to the Alpine.js minicart binding:

```js
page.locator('[data-bind*="cart.subtotal"]').first()
```

Registry reset to HEALTHY, heal_version bumped to 2.

---

## Issue 6 — Hyva configurable products require swatch selection before Add to Cart

**What happened**

`hyvaAddToCartAndCheckout.spec.js` called `addLandoGymJacketToCart()` and `addIngridRunningJacketToCart()`, which clicked the Add to Cart button directly. On Hyva, configurable products (jackets) require a size and color swatch to be selected first. The Add to Cart button stays inactive until both are chosen.

The test timed out waiting for:

```
locator('.product-item').filter({ hasText: 'Lando Gym Jacket' }).getByRole('radio', { name: 'XL' })
```

The `landoXL` registry entry was BROKEN after 3 failed runs. The radio pattern was wrong; Hyva swatch inputs use label elements, not radio roles.

**Fix**

Added four new locators in `HyvaHome.elements.js` using `getByLabel()` scoped by product card:

```js
landoSizeXL:    (page) => page.locator('.product-item').filter({ hasText: 'Lando Gym Jacket' }).getByLabel('XL')
landoColorBlue: (page) => page.locator('.product-item').filter({ hasText: 'Lando Gym Jacket' }).getByLabel('Blue')
ingridSizeXS:   (page) => page.locator('.product-item').filter({ hasText: 'Ingrid Running Jacket' }).getByLabel('XS')
ingridColorBlue:(page) => page.locator('.product-item').filter({ hasText: 'Ingrid Running Jacket' }).getByLabel('Blue')
```

Rewrote `addLandoGymJacketToCart()` and `addIngridRunningJacketToCart()` in `HyvaHome.page.js` to follow the correct flow:

```
hover product card -> select size -> select color -> click Add to Cart
```

Removed the dead `landoXL` registry entry. Rewrote the test spec to match, updated the test description to include the swatches being selected (XL/Blue, XS/Blue).

---

## Issue 7 — pending_patches.json had an unresolved placeholder URL

**What happened**

After the first agent run, `pending_patches.json` contained:

```json
{
  "key": "hyvaProductList.url",
  "value": "https://<YOUR_HYVA_STORE_URL>/women/tops-women/hoodies-and-sweatshirts-women.html"
}
```

The agent correctly proposed a config patch but could not know the actual domain. The placeholder was never resolved and would have caused a key conflict on the next generation run.

**Fix**

Cleared `pending_patches.json` to an empty patches array. Updated `testdata.config.js` directly with the correct URLs:

```js
hyvaProductList: {
  url: 'https://demo.hyva.io/women/tops-women/hoodies-and-sweatshirts-women.html',
},
hyvaHome: {
  url: 'https://demo.hyva.io/',
  jacketsUrl: 'https://demo.hyva.io/women/tops-women/jackets-women.html',
},
```

---

## Issue 8 — Stale scout files and registry keys from other sites

**What happened**

The `.agent/scout/` directory contained summaries from 7 sites that are not part of the project: Apple, EaseCloud, HyrTutorials, SelectorsHub, HyvaCart, and SauceDemo Login. The registry contained 4 `Login.*` keys for SauceDemo. The `method_index.json` contained 3 `LoginPage.*` methods pointing to a SauceDemo page object that no longer exists. `globalSetup.js` seeded the same stale methods on fresh clone.

None of these had any backing test or page object in the project.

**Fix**

Deleted 7 scout summary files, leaving only `HyvaHome`, `HyvaLogin`, `HyvaProductList`.

Removed `Login.usernameInput`, `Login.passwordInput`, `Login.loginButton`, `Login.errorMessage` from `registry.json`.

Removed `LoginPage.goto`, `LoginPage.login`, `LoginPage.getErrorMessage` from `method_index.json`.

Rewrote `globalSetup.js` METHOD_INDEX_DEFAULT to seed only real Hyva methods. Added the 13 methods that existed in code but were missing from the index: all BasePage actions, all HyvaHomePage methods, all HyvaProductListPage methods.

---

## Issue 9 — method_index.json was missing most real methods

**What happened**

The method index only contained BasePage base methods and the now-removed SauceDemo LoginPage methods. All HyvaHomePage, HyvaProductListPage, and HyvaLoginPage methods were missing. This meant the agent had no visibility into what page object methods already existed, risking duplicate generation on the next prompt.

**Fix**

Added 13 missing methods to `method_index.json` and to `globalSetup.js` so they are seeded correctly on fresh clone.

---

## Summary of files changed

| File | Change |
|---|---|
| `src/agent/orchestrator.js` | Added clarifications logging and zero-output warning |
| `src/elements/HyvaHome.elements.js` | Added 4 swatch locators, removed dead landoXL |
| `src/elements/HyvaProductList.elements.js` | Fixed blue locator, removed price non-locator |
| `src/pages/HyvaHome.page.js` | Rewrote add-to-cart methods with swatch selection flow, fixed minicartSubtotal locator |
| `src/tests/productList/hyvaAddToCartAndCheckout.spec.js` | Rewrote test to match corrected flow and URL |
| `config/testdata.config.js` | Added jacketsUrl, fixed productList URL |
| `.agent/registry.json` | Removed Login.* keys, fixed BROKEN entries, added swatch entries |
| `.agent/method_index.json` | Removed LoginPage.* entries, added 13 real Hyva methods |
| `.agent/pending_patches.json` | Cleared stale placeholder patch |
| `.agent/scout/` | Deleted 7 non-Hyva scout summaries |
| `globalSetup.js` | Rewrote METHOD_INDEX_DEFAULT with Hyva-only methods |

---

## Issue 10 — Gate 4 drops natural English prompts containing 'add', 'open', 'go'

**Symptom:** Prompt `"add Aim Analog Watch to cart and verify minicart"` matched only
`toggleMinicartCartIsEmpty`. The `addToCartAimAnalogWatch` button was not matched at all.

**Root cause:** `add`, `open`, `go`, `submit`, `search` were in `BROAD_VERBS` which Gate 4
strategy 1 ignores entirely. Strategy 1 only extracts nouns adjacent to `ACTION_VERBS`. Since
`add` was not an action verb, `aim` and `analog` were never extracted as targets. Additionally,
stop words (`to`, `and`, `is`, `with`) were not filtered from extracted targets, causing noise
in the match list.

**Fix:** Moved `add`, `open`, `go`, `submit`, `search` from `BROAD_VERBS` into `ACTION_VERBS`.
Added `TARGET_STOP_WORDS` set to filter extracted tokens before scout matching.

**Files changed:** `src/agent/orchestrator.js`

---

## Issue 11 — Agent generates wrong `require` path depth for TestData in test files

**Symptom:** Agent generated `require('../../config/testdata.config')` in test files under
`src/tests/{feature}/`. This resolves to `src/config/testdata.config` which does not exist.
Correct path is `require('../../../config/testdata.config')`.

**Root cause:** `MASTER_MEMORY_v3.0.md` did not specify depth-relative require paths. Agent
inferred from a shallow example and hardcoded two `../` levels instead of three.

**Fix:** Added explicit require path rules to `MASTER_MEMORY_v3.0.md` File Ownership section,
stating all test files are always one subdirectory deep and must use `../../../config/testdata.config`.

**Files changed:** `.docs/memory/MASTER_MEMORY_v3.0.md`

---

## Issue 12 — Agent clicks product link instead of Add to Cart button; strict mode violation on product links

**Symptom 1:** Prompt `"add Aim Analog Watch to cart"` caused the agent to generate a click on
`HyvaHome.aimAnalogWatch` (the product title link) instead of `HyvaHome.addToCartAimAnalogWatch`
(the Add to Cart button). Clicking the link navigates to the PDP — a completely different flow.

**Root cause:** Gate 4 passed both elements to the agent. Without a disambiguation rule, the
agent chose the link because "clicking a product name" is a plausible interpretation of "add to
cart" (navigate to PDP, then add). The agent needed an explicit rule to always prefer the button
when both are present.

**Fix:** Added Add to Cart disambiguation rule to `MASTER_MEMORY_v3.0.md` LOCATOR ROUTING section.

**Symptom 2:** `aimAnalogWatch` (and all other product card links) used `getByRole('link', { name: '...' })`
which resolves to 2 elements on Hyva — the product photo `<a>` and the product title `<a>` share
the same accessible name. This causes a strict mode violation.

**Root cause:** Scout's A11y-only links (`source: 'a11y'`) don't account for Hyva's dual-anchor
product card pattern. Scout writes the locator suggestion without checking for multiplicity.

**Fix 1:** Patched all 31 `source: 'a11y'` link locators in `HyvaHome_summary.json` and 15 in
`HyvaLogin_summary.json` to append `.first()`.
**Fix 2:** Added strict mode guard rule to `MASTER_MEMORY_v3.0.md` so the agent always appends
`.first()` when generating locators for `source: 'a11y'` links.

**Files changed:** `.docs/memory/MASTER_MEMORY_v3.0.md`, `.agent/scout/HyvaHome_summary.json`,
`.agent/scout/HyvaLogin_summary.json`

---

## Issue 18 — `getProductPrice()` references elements that don't exist

**Symptom:** Test fails at runtime — `el.aimAnalogWatchPrice` and `el.enduranceWatchPrice`
are `undefined`. The method `getProductPrice()` was generated by the agent but the supporting
element locators were never created in `HyvaHome.elements.js`.

**Root cause:** Agent generated `getProductPrice()` in the Page Object referencing
`el.aimAnalogWatchPrice` and `el.enduranceWatchPrice`, but never generated the corresponding
entries in the elements file. Scout has 0 price elements because Hyva product card prices are
not in the A11y tree — they render inside `<span class="price">` which has no accessible role.

**Fix:** Manually added price locators to `HyvaHome.elements.js` using the Hyva product card
scoped pattern:
  `page.locator('.product-item').filter({ hasText: 'Aim Analog Watch' }).locator('.price').first()`
Added the pattern and known manual elements to `MASTER_MEMORY_v3.0.md` so agent generates
them correctly in future.

**Files changed:** `src/elements/HyvaHome.elements.js`, `.docs/memory/MASTER_MEMORY_v3.0.md`

---

## Issue 19 — `HyvaHome.page.js` used default export instead of named export

**Symptom:** `const { HyvaHomePage } = require('../../pages/HyvaHome.page')` in test files
returns `undefined` for `HyvaHomePage` because the page used `module.exports = HyvaHomePage`
(default export) instead of `module.exports = { HyvaHomePage }` (named export).

**Root cause:** Agent generated `module.exports = HyvaHomePage` — inconsistent with all other
Page Objects in the project which use named exports. This is the second time this pattern has
appeared (Issue 16 covered the require side; this covers the export side).

**Fix:** Changed `module.exports = HyvaHomePage` to `module.exports = { HyvaHomePage }`.
Added named export rule to MASTER_MEMORY HARD LIMITS and DATA VALUES sections.
Also fixed `addEnduranceWatchToCart.spec.js` which had the inverse problem — used
`const HyvaHomePage = require(...)` without destructuring.

**Files changed:** `src/pages/HyvaHome.page.js`, `src/tests/cart/addEnduranceWatchToCart.spec.js`,
`.docs/memory/MASTER_MEMORY_v3.0.md`
