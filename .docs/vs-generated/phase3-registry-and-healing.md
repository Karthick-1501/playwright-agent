# Phase 3: Registry & Self-Healing — Deep Dive

**Date**: 2026-04-11
**Status**: Complete — 137/137 assertions, 0 lint warnings
**Files created**: `src/registry/registry-manager.js`, `src/registry/heal.js`
**Files modified**: `globalSetup.js`
**Test files**: `tests/registry-manager.test.js`, `tests/heal.test.js`

---

## Table of Contents

1. [The Problem Phase 3 Solves](#1-the-problem-phase-3-solves)
2. [How It Fits in the Architecture](#2-how-it-fits-in-the-architecture)
3. [The Registry Data Model](#3-the-registry-data-model)
4. [RegistryManager — Line by Line](#4-registrymanager--line-by-line)
5. [The State Machine](#5-the-state-machine)
6. [HealManager — Line by Line](#6-healmanager--line-by-line)
7. [The Heal Lifecycle (End to End)](#7-the-heal-lifecycle-end-to-end)
8. [The Scoring Algorithm](#8-the-scoring-algorithm)
9. [The globalSetup Bootstrap Fix](#9-the-globalsetup-bootstrap-fix)
10. [How the Orchestrator Will Use This](#10-how-the-orchestrator-will-use-this)
11. [Design Decisions and Why](#11-design-decisions-and-why)
12. [What the Tests Cover](#12-what-the-tests-cover)

---

## 1. The Problem Phase 3 Solves

In test automation, **selectors break**. A dev renames a `data-test` attribute, removes an `id`, or restructures the DOM. When that happens, every test that touches that element fails.

Traditionally you'd:
1. See the failure in CI
2. Manually hunt for the element in the DOM
3. Update the selector string in your code
4. Re-run tests

Phase 3 automates steps 2–4. The system:
- **Tracks** how often each selector succeeds or fails (`registry-manager.js`)
- **Detects** when a selector is degrading or broken (state machine)
- **Finds** replacement selectors from the Scout output (`heal.js`)
- **Applies** the fix, resets counters, and watches the new selector
- **Quarantines** selectors that keep breaking even after 2 heal attempts (stops wasting resources)

Think of it like a circuit breaker pattern applied to CSS selectors.

---

## 2. How It Fits in the Architecture

```
                    ┌─────────────────┐
                    │   Scout (CDP)   │  Phase 2 — already built
                    │  Scans the DOM  │
                    └────────┬────────┘
                             │ writes
                             ▼
                    .agent/scout/Login_summary.json
                             │
                             │ reads (for heal candidates)
                             ▼
┌─────────────────────────────────────────────────┐
│           Phase 3 — Registry + Heal             │
│                                                 │
│  ┌──────────────────┐   ┌─────────────────┐     │
│  │ RegistryManager   │──▶│  HealManager    │     │
│  │ (CRUD + state)    │◀──│  (find + apply) │     │
│  └──────────┬───────┘   └─────────────────┘     │
│             │ reads/writes                       │
│             ▼                                    │
│   .agent/registry.json                          │
└─────────────────────────────────────────────────┘
                             │
                             │ consumed by (Phase 4)
                             ▼
                    ┌─────────────────┐
                    │  Orchestrator   │  Phase 4 — not yet built
                    │  Gate 3 calls   │
                    │  resolveState() │
                    └─────────────────┘
```

**Key relationship**: RegistryManager owns the data. HealManager reads Scout output and calls RegistryManager to apply fixes. The Orchestrator (Phase 4) will call `resolveState()` before every agent call to tell the AI what's healthy and what's broken.

---

## 3. The Registry Data Model

The registry lives at `.agent/registry.json`. Here's what a single selector record looks like:

```json
{
  "Login.usernameInput": {
    "locator": "page.locator('[data-test=\"username\"]')",
    "tier": 2,
    "state": "HEALTHY",
    "success_rate": 1.0,
    "total_runs": 0,
    "successful_runs": 0,
    "heal_attempts": 0,
    "heal_version": 0,
    "last_seen": "2026-04-11T10:00:00.000Z",
    "last_heal_source": null,
    "source_file": "src/elements/Login.elements.js"
  }
}
```

### Field-by-field explanation:

| Field | Type | What it tracks |
|---|---|---|
| `locator` | string | The Playwright locator string currently in use |
| `tier` | number (1-3) | Locator quality: 1 = semantic (best), 2 = test hooks, 3 = structural (fragile) |
| `state` | string | Current health: HEALTHY / DEGRADED / BROKEN / QUARANTINE |
| `success_rate` | float 0–1 | `successful_runs / total_runs` — recalculated on every run |
| `total_runs` | int | Total number of test runs that used this selector |
| `successful_runs` | int | How many times the selector found the element successfully |
| `heal_attempts` | int | How many times we've tried to fix this selector. **Never resets.** |
| `heal_version` | int | How many times a new locator was actually applied (increments on `applyHeal`) |
| `last_seen` | ISO date | Timestamp of the last interaction (success, failure, or heal) |
| `last_heal_source` | string | Where the replacement came from: `scout-generated` or `agent-generated` |
| `source_file` | string | Which elements file owns this locator (e.g. `src/elements/Login.elements.js`) |

### The key format

Keys use `{PageName}.{elementName}` — e.g. `Login.usernameInput`, `Inventory.addToCartButton`.

This format maps directly to the elements files (`src/elements/Login.elements.js` → `LoginElements.usernameInput`).

---

## 4. RegistryManager — Line by Line

File: `src/registry/registry-manager.js`

### Constructor + Initialization

```javascript
const DEFAULT_REGISTRY_PATH = path.resolve(__dirname, '../../.agent/registry.json');

class RegistryManager {
    constructor(registryPath = DEFAULT_REGISTRY_PATH) {
        this.registryPath = registryPath;
        this.data = null;  // stays null until load() is called
    }
```

**Why `data = null`?** This is a safety guard. Every method calls `_ensureLoaded()` first. If you forget to call `load()`, it throws immediately instead of silently writing bad data. This pattern prevents "I mutated an empty object and saved it, wiping the real registry" bugs.

**Why accept a custom path?** Testing. In tests, we pass a temp directory path so tests never touch the real `.agent/registry.json`. This is dependency injection — the simplest form.

### load()

```javascript
load() {
    if (!fs.existsSync(this.registryPath)) {
        this.data = { version: '1.0.0', selectors: {} };
        return this;
    }
    const raw = fs.readFileSync(this.registryPath, 'utf8');
    this.data = JSON.parse(raw);
    if (!this.data.version) this.data.version = '1.0.0';
    if (!this.data.selectors) this.data.selectors = {};
    return this;
}
```

Three scenarios:
1. **File doesn't exist** → create empty in-memory structure (doesn't write to disk until `save()`)
2. **File exists, well-formed** → load it
3. **File exists, legacy format** (e.g. just `{}`) → patch in missing fields

The `return this` enables chaining: `new RegistryManager().load().get('Login.btn')`.

**Why not auto-save on load?** Separation of concerns. `load()` reads. `save()` writes. You might want to load, inspect data, and decide NOT to save. Keeping them separate prevents accidental overwrites.

### save() — Atomic writes

```javascript
save() {
    const dir = path.dirname(this.registryPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    const tmpPath = this.registryPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmpPath, this.registryPath);
    return this;
}
```

**Why write to a `.tmp` file first, then rename?** This is an **atomic write** pattern. If the process crashes mid-write (power loss, exception), you'd get a corrupted half-written JSON file. With the rename approach:
- If the crash happens during `writeFileSync` → only the `.tmp` file is corrupted, the real file is untouched
- `renameSync` on the same filesystem is atomic on all major OSes — it either completes fully or not at all

This is the same pattern databases use for write-ahead logs.

### CRUD Operations

```javascript
get(key)     → returns the record object, or null if not found
set(key, record) → creates/overwrites with defaults merged in
delete(key)  → removes a key
has(key)     → boolean existence check
keys()       → array of all key strings
getAll()     → shallow copy of all selectors
```

**Why does `set()` merge with `_createDefaults()`?** When creating a new element, you only need to specify `locator` and `tier`. Everything else (success_rate, heal_attempts, etc.) gets sensible defaults. The spread order matters:

```javascript
this.data.selectors[key] = {
    ...this._createDefaults(),  // first: all defaults
    ...record,                  // second: your values override defaults
    last_seen: new Date().toISOString(),  // third: always set a timestamp
};
```

If you pass `{ locator: 'x', tier: 1, success_rate: 0.5 }`, the success_rate overrides the default 1.0. If you omit it, you get 1.0.

**Why does `getAll()` return `{ ...this.data.selectors }`?** Shallow copy. If you modify the returned object, it won't accidentally mutate the internal state. Without the spread, `const all = rm.getAll(); delete all['Login.btn'];` would actually delete it from the registry's internal data.

### recordSuccess() and recordFailure()

```javascript
recordSuccess(key) {
    const record = this.data.selectors[key];
    if (!record) throw new Error(`Selector not found: ${key}`);
    record.total_runs++;
    record.successful_runs++;
    record.success_rate = record.successful_runs / record.total_runs;
    record.last_seen = new Date().toISOString();
    record.state = this._calculateState(record);
    return this;
}
```

Every time a test uses a selector and it works → `recordSuccess()`. Every time it fails to find the element → `recordFailure()`. The `success_rate` is immediately recalculated, and the `state` is re-derived.

**Why throw on missing key?** If you're recording a result for a selector that doesn't exist in the registry, something is deeply wrong — the element was never registered. Throwing immediately surfaces this. Silent no-ops hide bugs.

**Why recalculate state on every call?** The alternative is a scheduled job that recalculates periodically. But with ~100 selectors max (SauceDemo scale), the calculation is trivial — just two comparisons. Recalculating immediately means the state is always consistent. You never have stale state.

### resolveState() — The Orchestrator's Interface

```javascript
resolveState(key) {
    const record = this.data.selectors[key];

    if (!record) {
        return { registry_state: 'NONE', resolved_selector: null };
    }
    if (record.heal_attempts >= STATE_THRESHOLDS.QUARANTINE_HEAL_ATTEMPTS) {
        return { registry_state: 'QUARANTINE', resolved_selector: null };
    }
    if (record.success_rate >= STATE_THRESHOLDS.HEALTHY) {
        return {
            registry_state: 'HEALTHY',
            resolved_selector: record.locator,
            heal_version: record.heal_version || 0,
        };
    }
    if (record.success_rate >= STATE_THRESHOLDS.DEGRADED) {
        return {
            registry_state: 'DEGRADED',
            resolved_selector: record.locator,
        };
    }
    return { registry_state: 'BROKEN', resolved_selector: null };
}
```

This is the **most important method**. In Phase 4, the Orchestrator's Gate 3 will call this for every element before sending context to the Claude API. The AI agent receives the resolved state — it never sees raw registry data.

**Why return a new object instead of just the state string?** Because the consumer needs more than the state. HEALTHY/DEGRADED states include the `resolved_selector` (the locator to use). BROKEN/QUARANTINE return `null` — meaning the AI must generate a new one (BROKEN) or skip entirely (QUARANTINE). HEALTHY also includes `heal_version` so the AI can add `// [REGISTRY-HEALED v3]` comments.

**Why does QUARANTINE check come first?** Because `heal_attempts >= 2` OVERRIDES success_rate. A selector with 100% success rate but 2 heal attempts is still quarantined. This prevents infinite heal loops — if we've tried twice and it keeps breaking, something fundamental is wrong. Stop wasting API calls.

### The Heal Methods

```javascript
incrementHealAttempt(key) {
    record.heal_attempts++;
    record.state = this._calculateState(record);
}

applyHeal(key, { locator, tier, source }) {
    record.locator = locator;           // new locator replaces old
    record.tier = tier;                  // may change (e.g. tier 2 → tier 1)
    record.total_runs = 0;              // reset run counters
    record.successful_runs = 0;         // give the new locator a clean slate
    record.success_rate = 1.0;          // assume healthy until proven otherwise
    record.heal_version = (record.heal_version || 0) + 1;  // track heal count
    record.last_heal_source = source;   // where did this fix come from?
    record.state = this._calculateState(record);
}
```

**Critical design decision: `heal_attempts` is NOT reset in `applyHeal()`.**

Why? Because `heal_attempts` is a LIFETIME counter. It counts how many times we've TRIED to fix this element — successful or not. If we reset it on every heal, a selector that keeps breaking would heal forever, burning API credits. By keeping it cumulative:
- Attempt 1: heal applied, selector works for a while, breaks again
- Attempt 2: heal applied, but now `heal_attempts = 2` → QUARANTINE
- Future: all heal attempts blocked. Manual review required.

**Why reset `total_runs` and `successful_runs`?** Because the old numbers are meaningless — they reflect the OLD locator's performance. The new locator deserves a fresh start. Setting `success_rate = 1.0` is optimistic: we assume the new locator works until failures prove otherwise.

### applyRegistryUpdates() — Processing the Agent's Output

```javascript
applyRegistryUpdates(updates) {
    for (const update of updates) {
        const key = `${update.page}.${update.element}`;
        if (this.has(key)) {
            this.applyHeal(key, { ... });   // existing → update via heal
        } else {
            this.set(key, { ... });          // new → create fresh
        }
    }
}
```

This is how the agent's output envelope gets applied. When the Claude API returns `registry_updates[]`, the Orchestrator calls this method. It handles two cases:
- **Element already exists** → treat as a heal (preserves heal_attempts, increments heal_version)
- **Element is brand new** → create it fresh with defaults

The update format matches the agent's output envelope: `{ page, element, selector, tier, source }`.

---

## 5. The State Machine

```
                    ┌────────────────┐
                    │   NEW ELEMENT   │
                    │  (via set())    │
                    └───────┬────────┘
                            │ success_rate = 1.0
                            ▼
                    ┌────────────────┐
        ┌──────────│    HEALTHY      │──────────┐
        │          │  rate ≥ 0.85    │          │
        │          └────────────────┘          │
        │                  ▲                    │
        │        success   │                    │ failures drop
        │        recovers  │                    │ rate below 0.85
        │                  │                    │
        │          ┌───────┴────────┐          │
        │          │   DEGRADED     │◀─────────┘
        │          │ 0.50 ≤ rate    │
        │          │     < 0.85     │
        │          └───────┬────────┘
        │                  │ more failures
        │                  │ rate drops below 0.50
        │                  ▼
        │          ┌────────────────┐
        │          │    BROKEN      │
        │          │  rate < 0.50   │
        │          └───────┬────────┘
        │                  │
        │                  │ heal attempt applied
        │                  │ (success_rate reset to 1.0)
        │                  │
        │                  ├─── heal_attempts < 2 ──▶ back to HEALTHY
        │                  │
        │                  └─── heal_attempts ≥ 2 ──▼
        │                                    ┌────────────────┐
        │                                    │  QUARANTINE    │
        └────────────────────────────────────│ heal_attempts  │
                         (never)             │     ≥ 2        │
                                             └────────────────┘
                                              ❌ No automatic exit
                                              Requires manual review
```

### The thresholds (defined as constants):

```javascript
const STATE_THRESHOLDS = {
    HEALTHY: 0.85,               // success_rate >= 0.85
    DEGRADED: 0.50,              // success_rate >= 0.50 and < 0.85
    QUARANTINE_HEAL_ATTEMPTS: 2, // heal_attempts >= 2
};
```

### Concrete example with numbers:

Imagine `Login.usernameInput` over time:

| Event | total_runs | successful_runs | success_rate | heal_attempts | State |
|---|---|---|---|---|---|
| Created | 0 | 0 | 1.00 | 0 | HEALTHY |
| 10 test runs pass | 10 | 10 | 1.00 | 0 | HEALTHY |
| Dev renames `data-test` | 12 | 10 | 0.83 | 0 | DEGRADED |
| More failures | 18 | 10 | 0.56 | 0 | DEGRADED |
| Still failing | 21 | 10 | 0.48 | 0 | BROKEN |
| Heal attempt #1 | 0 | 0 | 1.00 | 1 | HEALTHY |
| Works for a while | 15 | 15 | 1.00 | 1 | HEALTHY |
| Breaks again | 20 | 15 | 0.75 | 1 | DEGRADED |
| Gets worse | 22 | 15 | 0.68 | 1 | DEGRADED |
| Falls below 0.50 | 35 | 15 | 0.43 | 1 | BROKEN |
| Heal attempt #2 | 0 | 0 | 1.00 | 2 | **QUARANTINE** |

Even though the success_rate was reset to 1.0, the `heal_attempts = 2` check fires first → QUARANTINE. The system gives up.

### Boundary values (exact):

- `success_rate = 0.85` → HEALTHY (inclusive, `>=`)
- `success_rate = 0.849` → DEGRADED
- `success_rate = 0.50` → DEGRADED (inclusive, `>=`)
- `success_rate = 0.499` → BROKEN
- `success_rate = 1.0` but `heal_attempts = 2` → QUARANTINE (overrides)

---

## 6. HealManager — Line by Line

File: `src/registry/heal.js`

### Constructor

```javascript
class HealManager {
    constructor(registryManager, scoutDir = DEFAULT_SCOUT_DIR) {
        this.registry = registryManager;   // receives the loaded RegistryManager
        this.scoutDir = scoutDir;          // where scout JSON files live
    }
}
```

HealManager doesn't own the registry — it receives it via constructor. This is dependency injection again:
- In production: `new HealManager(new RegistryManager().load())`
- In tests: `new HealManager(new RegistryManager(tempPath).load(), tempScoutDir)`

### State Discovery Methods

```javascript
findBrokenKeys()      → ['Login.btn', 'Inventory.addBtn']
findDegradedKeys()    → ['Login.passwordInput']
findQuarantinedKeys() → ['Login.errorMessage']
```

These scan all registry keys and return arrays filtered by state. The orchestrator would use `findBrokenKeys()` to know what needs healing.

### loadScoutSummary()

```javascript
loadScoutSummary(pageName) {
    const filePath = path.join(this.scoutDir, `${pageName}_summary.json`);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}
```

Given a page name (e.g. `"Login"`), loads `.agent/scout/Login_summary.json`. Returns `null` if the scout hasn't been run for that page. The caller handles the null.

### findCandidates() — The Core Search Logic

```javascript
findCandidates(registryKey, options = {}) {
```

This method answers: **"Given a broken selector, what are the replacement options?"**

Step by step:

1. **Extract page name** from the key: `'Login.usernameInput'` → `'Login'`
2. **Load scout JSON** for that page → gets the list of all interactive elements the scout found on the page
3. **Get the current registry record** to know what locator is currently failing
4. **Filter scout elements** through gates:
   - Skip if `disabled: true` (can't interact with disabled elements)
   - Skip if `locator_suggestion === currentLocator` (that's the one that's already failing)
   - Skip if `tier_suggestion === 3` and `tier3Allowed` is false (tier 3 is gated)
5. **Score each remaining candidate** (see scoring section below)
6. **Skip if score ≤ 0** (no relevance at all)
7. **Sort**: first by tier (lower = better), then by score (higher = better)

The return shape:

```javascript
{
    key: 'Login.usernameInput',
    error: null,                // or 'SCOUT_MISSING' or 'REGISTRY_KEY_MISSING'
    candidates: [
        {
            locator: "page.getByRole('textbox', { name: 'Username' })",
            tier: 1,
            source: 'a11y',
            score: 17,
            scout_key: 'Login.username',
            dom_only: false,
        },
        // ... more candidates, best first
    ]
}
```

### healKey() — The Decision Engine

```javascript
healKey(registryKey, options = {}) {
```

This is the method that actually applies a fix. The decision flow:

```
                    Is it QUARANTINE?
                    ├── yes → return { healed: false, reason: 'QUARANTINE' }
                    └── no
                         │
                    Is it HEALTHY?
                    ├── yes → return { healed: false, reason: 'ALREADY_HEALTHY' }
                    └── no (so it's DEGRADED or BROKEN)
                         │
                    findCandidates()
                    ├── error? → return { healed: false, reason: error }
                    ├── 0 candidates → incrementHealAttempt + return NO_CANDIDATES
                    └── has candidates
                         │
                    Pick best candidate (index 0, already sorted)
                         │
                    incrementHealAttempt()    ← counts the attempt BEFORE applying
                    applyHeal()              ← replaces the locator
                         │
                    return { healed: true, applied: { ... } }
```

**Why increment heal_attempts even when there are no candidates?** Because the system TRIED. The absence of candidates is still an attempt. After 2 failed attempts (no candidates found either time), the element gets quarantined. Without this, a selector with no scout coverage would keep retrying forever.

**Why increment BEFORE applyHeal?** Because `applyHeal` resets `success_rate` to 1.0. If we increment after, the state calculation would see `heal_attempts + 1` with rate 1.0 — which might not trigger QUARANTINE correctly in edge cases. By incrementing first, `applyHeal`'s internal `_calculateState` sees the true heal_attempts count.

### healAllBroken()

```javascript
healAllBroken(options = {}) {
    const broken = this.findBrokenKeys();
    return broken.map(key => this.healKey(key, options));
}
```

Batch operation. Finds all BROKEN keys and heals each one. Returns an array of results. In production, the orchestrator might call this periodically or on-demand.

### getHealthReport()

```javascript
getHealthReport() → {
    total: 4,
    healthy: 2,
    degraded: 1,
    broken: 0,
    quarantined: 1,
    details: { 'Login.btn': { registry_state: 'HEALTHY', ... }, ... }
}
```

Dashboard data. Shows the overall health of the selector registry. Useful for the CLI (Phase 5) to display status.

---

## 7. The Heal Lifecycle (End to End)

Let's walk through a complete real-world scenario:

### Setup
```
Registry has: Login.usernameInput
  locator: page.locator('[data-test="username"]')
  tier: 2
  state: HEALTHY
  success_rate: 1.0
  heal_attempts: 0

Scout has: Login_summary.json with 4 elements including:
  Login.username → page.getByRole('textbox', { name: 'Username' }), tier 1
  Login.loginButton → page.locator('[data-test="login-button"]'), tier 2
```

### Day 1: Everything works
Tests run. `recordSuccess('Login.usernameInput')` called 50 times.
```
success_rate: 1.0 (50/50)
state: HEALTHY
```

### Day 2: Dev removes `data-test="username"` attribute
Tests start failing. `recordFailure('Login.usernameInput')` called 10 times.
```
success_rate: 50/60 = 0.833
state: DEGRADED ← crossed below 0.85
```

The system is aware something is wrong but still tries the selector (DEGRADED selectors are still usable — the Orchestrator passes them through with a monitor flag).

### Day 3: Still failing
10 more failures. `recordFailure()` called 10 more times.
```
success_rate: 50/70 = 0.714
state: DEGRADED (still above 0.50)
```

### Day 4: Crosses the BROKEN threshold
20 more failures. No successes.
```
success_rate: 50/90 = 0.556 → still DEGRADED
...more failures...
success_rate: 50/110 = 0.455 → BROKEN ← crossed below 0.50
```

### Day 5: Self-healing triggers

The system calls `healKey('Login.usernameInput')`:

1. `resolveState` → BROKEN
2. Not QUARANTINE, not HEALTHY → proceed
3. `findCandidates('Login.usernameInput')`:
   - Load `.agent/scout/Login_summary.json`
   - Current locator: `page.locator('[data-test="username"]')`
   - Scout has `Login.username` → `page.getByRole('textbox', { name: 'Username' })`, tier 1
   - Score: name match "username" ≈ partial (+5), label match (+3), a11y source (+1), tier 1 (+3) = **12**
   - Not disabled, not same locator, not tier 3 → candidate accepted
4. Best candidate: `page.getByRole('textbox', { name: 'Username' })` (tier 1, score 12)
5. `incrementHealAttempt` → heal_attempts becomes 1
6. `applyHeal`:
   - locator → `page.getByRole('textbox', { name: 'Username' })`
   - tier → 1 (upgraded from tier 2!)
   - total_runs → 0, successful_runs → 0, success_rate → 1.0 (reset)
   - heal_version → 1
   - last_heal_source → `scout-generated`

```
Result:
  state: HEALTHY (rate = 1.0, heal_attempts = 1 < 2)
  locator: page.getByRole('textbox', { name: 'Username' })
  tier: 1 ← actually BETTER than before
```

**The selector healed itself AND upgraded from tier 2 to tier 1.** The old `data-test` attribute is gone but the accessibility role is stable. Win.

### Worst case: If it breaks AGAIN...

heal_attempts would go to 2 → QUARANTINE. No more automatic healing. A human needs to investigate why this element keeps changing.

---

## 8. The Scoring Algorithm

When `findCandidates()` evaluates a scout element against a broken registry key, it scores on 4 axes:

```javascript
_scoreCandidate(scoutElement, registryKey) {
    // registryKey = 'Login.usernameInput'
    // scoutElement.key = 'Login.username'
```

### Axis 1: Name Match (0, 5, or 10 points)

```javascript
if (scoutKey === elName) score += 10;               // exact: 'usernameInput' === 'usernameInput'
else if (scoutKey.includes(elName) 
      || elName.includes(scoutKey)) score += 5;      // partial: 'username' in 'usernameInput'
```

Exact match is ideal (same element, different locator). Partial match suggests related elements.

### Axis 2: Label Match (0 or 3 points)

```javascript
if (label.includes(elName) || elName.includes(label.replace(/\s/g, ''))) score += 3;
```

The scout element's human-readable label (from the accessibility tree) is compared. `label = "Username"` vs `elName = "usernameInput"` → `"usernameinput".includes("username")` → match, +3.

### Axis 3: Source Quality (0, 1, or 2 points)

```javascript
if (scoutElement.source === 'a11y+dom') score += 2;  // found in BOTH passes
else if (scoutElement.source === 'a11y') score += 1;  // accessibility tree only
// 'dom' only = 0 points
```

Elements found in both the accessibility tree AND the DOM overlay are more reliable — they have both semantic and structural anchors.

### Axis 4: Tier Bonus (1, 2, or 3 points)

```javascript
if (scoutElement.tier_suggestion === 1) score += 3;
else if (scoutElement.tier_suggestion === 2) score += 2;
else if (scoutElement.tier_suggestion === 3) score += 1;
```

Higher-tier locators get a score boost. This means within the same name-match level, tier 1 locators are preferred.

### Sorting: Tier first, then score

```javascript
candidates.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;  // tier 1 before tier 2
    return b.score - a.score;                        // higher score first
});
```

**Tier is the primary sort.** A tier 1 candidate with score 5 beats a tier 2 candidate with score 20. This enforces the project's locator priority: semantic locators are always preferred, regardless of how well the name matches.

### Maximum possible score

```
Exact name match:      10
Label match:            3
a11y+dom source:        2
Tier 1:                 3
─────────────────────────
Total:                 18
```

---

## 9. The globalSetup Bootstrap Fix

### The bug

`globalSetup.js` used `writeIfAbsent()` which only checks if the file EXISTS:

```javascript
// OLD — buggy
function writeIfAbsent(filePath, data) {
    if (!fs.existsSync(filePath)) {            // file exists (even if empty {})
        fs.writeFileSync(filePath, ...);        // so this never runs
    }
}
```

If `.agent/registry.json` existed as `{}` (created by an earlier version, a crashed write, or a manual touch), it would never get overwritten with the proper seed data. The registry would be permanently empty.

### The fix

```javascript
// NEW — fixed
function writeIfInvalid(filePath, data, requiredKey) {
    let shouldWrite = false;
    if (!fs.existsSync(filePath)) {
        shouldWrite = true;
    } else {
        try {
            const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            if (!existing[requiredKey]) shouldWrite = true;     // checks for required key
        } catch {
            shouldWrite = true;                                  // handles corrupted JSON
        }
    }
    if (shouldWrite) {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    }
}
```

Now it checks for a **required structural key**:
- `registry.json` must have `selectors`
- `method_index.json` must have `version`
- `pending_patches.json` must have `patches`

If the key is missing (or the JSON is corrupted), the file gets re-initialized with the seed data.

### Why different keys for each file?

```javascript
writeIfInvalid(path.join(AGENT_DIR, 'registry.json'), INITIAL_REGISTRY, 'selectors');
writeIfInvalid(path.join(AGENT_DIR, 'method_index.json'), INITIAL_METHOD_INDEX, 'version');
writeIfInvalid(path.join(AGENT_DIR, 'pending_patches.json'), INITIAL_PENDING_PATCHES, 'patches');
```

- `registry.json`: The old empty format was `{}` — no `selectors` key. So we check for `selectors`.
- `method_index.json`: The old format was `{ "stale": false, "methods": {} }` — it has `methods` but no `version`. So we check for `version` to detect the old format.
- `pending_patches.json`: The old format was `{}` — no `patches` key. So we check for `patches`.

Each key was chosen to catch the specific legacy format that existed in the repo.

---

## 10. How the Orchestrator Will Use This

In Phase 4, the Orchestrator's **Gate 3 (Registry Resolution)** will use `RegistryManager.resolveState()` like this:

```javascript
// Phase 4 orchestrator pseudocode (not yet built)
const { RegistryManager } = require('../registry/registry-manager');
const rm = new RegistryManager().load();

// For each element the agent needs:
function resolveForAgent(elementKey) {
    const state = rm.resolveState(elementKey);
    
    switch (state.registry_state) {
        case 'HEALTHY':
            // Tell agent: use this selector, it works
            return { ...state };    // includes resolved_selector + heal_version
            
        case 'DEGRADED':
            // Tell agent: use this selector but flag it
            return { ...state };    // includes resolved_selector
            
        case 'BROKEN':
            // Tell agent: generate a new selector from scout data
            return { ...state };    // resolved_selector is null
            
        case 'QUARANTINE':
            // Tell agent: SKIP this element entirely
            return { ...state };    // resolved_selector is null
            
        case 'NONE':
            // Tell agent: never seen this element, generate from scout
            return { ...state };    // resolved_selector is null
    }
}
```

The agent receives the resolved state as a fact. It doesn't evaluate thresholds or look at raw numbers. It just reads the state and follows a decision tree:
- HEALTHY → use the provided locator
- DEGRADED → use the provided locator + add monitoring comment
- BROKEN → generate a new locator from scout output
- QUARANTINE → skip, add to warnings
- NONE → generate from scout

The **HealManager** will be used either:
- **Proactively**: Before an orchestrator call, run `healAllBroken()` to fix what we can
- **Reactively**: After a test failure, record the failure and check if healing is needed
- **On demand**: Via CLI (`node agent-cli.js heal`) in Phase 5

---

## 11. Design Decisions and Why

### Why a class instead of functions?

RegistryManager holds state (`this.data`). A functional approach would require passing the data object through every function call. The class encapsulates the data and ensures `_ensureLoaded()` is checked everywhere. It also enables chaining: `rm.load().recordSuccess('key').save()`.

### Why not use a database?

At SauceDemo scale (~50 elements, ~20 selectors), a JSON file is:
- Zero dependencies (no pg, sqlite, etc.)
- Human-readable (open in VS Code, see everything)
- Easy to debug (just read the file)
- Git-firendly (though `.agent/` is gitignored — each machine bootstraps its own)

A database would be overkill. If the project scales to 1000+ selectors, we'd revisit.

### Why separate RegistryManager and HealManager?

**Single Responsibility**: RegistryManager knows about data. HealManager knows about healing strategy. If we change the scoring algorithm, only `heal.js` changes. If we change the data format, only `registry-manager.js` changes.

Also, RegistryManager is used by MORE than just HealManager — the Orchestrator uses it directly. If heal logic were baked into RegistryManager, the Orchestrator would carry unnecessary dependencies (scout file reading, scoring, etc.).

### Why is heal_attempts a lifetime counter?

The quarantine mechanism needs a reliable "how many times have we tried" counter. If `applyHeal` reset it:
- Break → heal (attempts: 1→0) → break → heal (attempts: 1→0) → forever

The selector would never quarantine. The whole point of QUARANTINE is: "We tried. Twice. It's fundamentally unstable. Stop." Lifetime counting enforces this.

### Why does tier override score in sorting?

Project rule: semantic locators (`page.getByRole()`) are ALWAYS preferred over structural ones (`page.locator('#id')`). A tier 1 locator with a mediocre name match is better than a tier 2 locator with a perfect name match, because tier 1 locators survive DOM restructuring while tier 2 locators are coupled to attribute names.

### Why the 0.85 / 0.50 split?

- **0.85**: Industry standard for "acceptable" reliability. Below this, something is wrong.
- **0.50**: Coin flip. Below this, the selector is actively harmful — failing more than succeeding. At this point, it's cheaper to replace it entirely.

These thresholds can be tuned later if needed (they're constants at the top of the file).

---

## 12. What the Tests Cover

### registry-manager.test.js — 17 groups, 85 assertions

| # | Test | What it proves |
|---|---|---|
| 1 | Load missing file | Creates empty `{ version, selectors }` when no file exists |
| 2 | Load legacy `{}` | Normalizes old empty files by adding missing fields |
| 3 | Load well-formed | Preserves all existing data on load |
| 4 | Save + reload | Data survives write-to-disk and re-read (roundtrip) |
| 5 | CRUD ops | set/get/has/delete/keys/getAll all work correctly |
| 6 | set() defaults | Missing fields get sensible defaults (rate 1.0, attempts 0, etc.) |
| 7 | recordSuccess | Increments both counters, rate stays 1.0, state stays HEALTHY |
| 8 | recordFailure | Only increments total, rate drops to 0, state goes to BROKEN |
| 9 | State transitions | Full HEALTHY→DEGRADED→BROKEN walkthrough with exact numbers |
| 10 | resolveState | All 5 states (NONE, HEALTHY, DEGRADED, BROKEN, QUARANTINE) |
| 11 | resolveStates | Batch operation returns correct states for mixed keys |
| 12 | Heal lifecycle | BROKEN→heal→HEALTHY→break→heal→QUARANTINE (full cycle) |
| 13 | applyRegistryUpdates | Processes agent output: updates existing, creates new |
| 14 | _ensureLoaded | Throws if you forget to call `load()` |
| 15 | Missing key errors | All mutation methods throw for nonexistent keys |
| 16 | Boundary values | 0.85 = HEALTHY, 0.50 = DEGRADED, 0.49 = BROKEN, QUARANTINE overrides |
| 17 | Edge cases | Empty array and null input to applyRegistryUpdates |

### heal.test.js — 17 groups, 52 assertions

| # | Test | What it proves |
|---|---|---|
| 1 | findBrokenKeys | Only returns BROKEN keys, not HEALTHY/DEGRADED/QUARANTINE |
| 2 | Scout missing | Returns error SCOUT_MISSING when no scout file for page |
| 3 | Registry key missing | Returns error REGISTRY_KEY_MISSING for nonexistent key |
| 4 | Disabled excluded | Scout elements with `disabled: true` are never candidates |
| 5 | Same locator skipped | Current locator is excluded from candidates |
| 6 | Tier 3 gating | Tier 3 excluded by default, included when `tier3Allowed: true` |
| 7 | Sort order | Candidates sorted by tier first, then score |
| 8 | QUARANTINE blocked | `healKey()` refuses to heal quarantined elements |
| 9 | HEALTHY skipped | `healKey()` skips healthy elements (nothing to fix) |
| 10 | No candidates | `healKey()` increments heal_attempts even when no candidates found |
| 11 | Successful heal | Full heal: picks best candidate, applies it, updates registry |
| 12 | DOM-only tagging | `source: 'dom'` → `last_heal_source: 'agent-generated'` |
| 13 | Full lifecycle | HEALTHY→BROKEN→heal→BROKEN→heal→QUARANTINE→blocked |
| 14 | healAllBroken | Batch processes all broken keys in one call |
| 15 | getHealthReport | Aggregates counts by state for dashboard display |
| 16 | Scoring | Tier priority overrides name match in candidate ranking |
| 17 | DEGRADED healing | DEGRADED elements can be healed (not just BROKEN) |

### How the tests work (no framework needed)

The tests use plain Node.js — no Jest, no Mocha, no Playwright Test. Just:

```javascript
function assertEqual(actual, expected, label) {
    if (JSON.stringify(actual) === JSON.stringify(expected)) passed++;
    else { failed++; console.error(`FAIL: ${label}`); }
}
```

Each test creates a fresh temp directory, runs operations, asserts results, then cleans up. Tests are fully isolated — they never touch real `.agent/` files.

Run them with:
```bash
node tests/registry-manager.test.js    # 85 assertions
node tests/heal.test.js                # 52 assertions
```

---

## Summary: What Phase 3 Built

| Component | Purpose | Used by |
|---|---|---|
| `RegistryManager` | Track selector health, calculate states, apply heals | Orchestrator (Gate 3), HealManager, future CLI |
| `HealManager` | Find replacement selectors from scout output, apply best candidate | Orchestrator (proactive), CLI (on-demand) |
| `globalSetup fix` | Ensure `.agent/` files always have valid seed data | Every test run (via Playwright config) |

The self-healing loop is now fully functional at the module level. Phase 4 will wire it into the orchestrator so it runs automatically before agent calls.
