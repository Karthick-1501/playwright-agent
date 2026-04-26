# ORCHESTRATOR_SPEC.md
# Playwright Agent — Orchestrator Responsibility Contract
# Version: 1.0
# These are the checks and transforms the orchestrator MUST execute
# BEFORE making any Claude API call. The agent assumes all of this is done.

---

## PHILOSOPHY

The agent is a translator, not a validator.
Every check in this file is deterministic — it has a definitive true/false answer
from data on disk. That means code owns it, not a language model.

If any gate below fails: do NOT call the Claude API. Handle it in the orchestrator.

---

## GATE 1 — INPUT PRESENCE

```js
function validateInputs({ methodIndex, pendingPatches, registryContext, scoutSummary }) {
  if (!pendingPatches) {
    throw new OrchestratorError('MISSING_INPUT', 'pending_patches.json is required. Aborting.');
  }
  if (!methodIndex) {
    throw new OrchestratorError('MISSING_INPUT', 'method_index.json is required. Aborting.');
  }
  if (!registryContext) {
    throw new OrchestratorError('MISSING_INPUT', 'registry_context.json is required. Aborting.');
  }
  if (!scoutSummary) {
    throw new OrchestratorError('MISSING_INPUT', 'scout_summary.json is required. Aborting.');
  }
}
```

---

## GATE 2 — STALE INDEX

```js
function checkStaleIndex(methodIndex, options = {}) {
  if (methodIndex.stale === true) {
    if (!options.staleAck) {
      throw new OrchestratorError(
        'STALE_INDEX',
        'method_index.json is stale. Refresh it or re-call with { staleAck: true } to accept duplicate risk.'
      );
    }
    // staleAck accepted — log it, continue, inject warning into agent context
    return { warning: 'INDEX_WARNING: Method index is stale. stale_ack accepted. Duplicate method risk is caller-owned.' };
  }
  return {};
}
```

---

## GATE 3 — REGISTRY RESOLUTION

Pre-resolve every element's registry state BEFORE building agent context.
The agent receives a resolved state, not raw registry data to interpret.

```js
function resolveRegistryState(page, element, registryContext) {
  const record = registryContext?.selectors?.[`${page}.${element}`];

  if (!record) return { registry_state: 'NONE', resolved_selector: null };

  if (record.heal_attempts >= 2) {
    return { registry_state: 'QUARANTINE', resolved_selector: null };
  }
  if (record.success_rate >= 0.85) {
    return { registry_state: 'HEALTHY', resolved_selector: record.locator, heal_version: record.heal_version || 0 };
  }
  if (record.success_rate >= 0.50) {
    return { registry_state: 'DEGRADED', resolved_selector: record.locator };
  }
  return { registry_state: 'BROKEN', resolved_selector: null };
}
```

---

## GATE 4 — SCOUT ELEMENT FILTERING

The agent must never receive 200 elements. Filter to only what the prompt needs.
Do this in the orchestrator before building the context payload.

```js
const ACTION_VERBS = ['click', 'fill', 'type', 'select', 'check', 'navigate', 'assert', 'verify', 'login', 'enter'];
const BROAD_VERBS = ['generate', 'create', 'write', 'build', 'make', 'add', 'test'];

function filterScoutElements(scoutSummary, userPrompt, registryContext) {
  const tokens = userPrompt.toLowerCase().split(/\s+/);

  // Strategy 1: extract target nouns adjacent to action verbs
  const targets = [];
  tokens.forEach((token, i) => {
    if (ACTION_VERBS.includes(token) && tokens[i + 1]) {
      targets.push(tokens[i + 1]);
      if (tokens[i + 2]) targets.push(tokens[i + 2]);
    }
  });

  // Strategy 2: for broad verbs, extract remaining nouns as targets
  if (targets.length === 0) {
    const stopWords = new Set([...ACTION_VERBS, ...BROAD_VERBS,
      'a', 'an', 'the', 'for', 'with', 'and', 'or', 'to', 'in', 'on', 'test', 'spec', 'page']);
    tokens.forEach(token => {
      if (!stopWords.has(token) && token.length > 1) targets.push(token);
    });
  }

  let matched = [];
  if (targets.length > 0) {
    matched = scoutSummary.elements.filter(el => {
      const key = el.key.toLowerCase();
      const label = (el.label || '').toLowerCase();
      return targets.some(t => key.includes(t) || label.includes(t));
    });
  }

  // Strategy 3: if prompt mentions the page name, return ALL elements for that page
  if (matched.length === 0) {
    const pageLower = scoutSummary.page.toLowerCase();
    if (tokens.includes(pageLower)) {
      matched = scoutSummary.elements;
    }
  }

  // No match after all strategies — throw NO_ELEMENTS_MATCHED.
  // If options.interactive is true, runAgent() catches this error and calls
  // promptUserForElement() before re-entering the pipeline. Gate 4 itself
  // always throws — the recovery lives one level up in runAgent().
  if (matched.length === 0) {
    throw new OrchestratorError(
      'NO_ELEMENTS_MATCHED',
      `No scout elements matched targets: [${targets.join(', ')}]. Clarify element role, label, or visible text.`
    );
  }

  // Attach resolved registry state to each matched element
  return matched.map(el => {
    const [page, elementName] = el.key.split('.');
    const registryResult = resolveRegistryState(page, elementName, registryContext);
    return { ...el, dom_only: el.source === 'dom', ...registryResult };
  });
}
```

---

## GATE 4.5 — INTERACTIVE ELEMENT INPUT (fallback when Gate 4 misses)

Triggered only when Gate 4 throws `NO_ELEMENTS_MATCHED` AND `options.interactive === true`.
The orchestrator pauses execution, prompts the user via stdin to describe the missing element,
and constructs a synthetic scout element in the exact shape Gate 4 normally returns.
The agent is completely unaware of the difference — it receives the same element shape
regardless of whether the source was Scout or user input.

**This gate does NOT re-run Scout.** Re-running Scout would produce the same result
because Scout missed the element due to DOM conditions (lazy load, hover-reveal, post-hydration
rendering), not timing. The user describing the element is the correct recovery path.

```js
async function promptUserForElement(pageName) {
  // Prompts user for: role, visible label, tier preference
  // Returns a synthetic scout element:
  return {
    key: `${pageName}.${camel}`,       // camelCase derived from label
    role,
    label,
    tier_suggestion: tierNum,
    locator_suggestion,                // built from role + label + tier
    disabled: false,
    source: 'user-provided',           // distinguishes from scout/dom sources
    dom_only: false,
    registry_state: 'NONE',
    resolved_selector: null,
  };
}
```

**Agent instruction:** When `source === 'user-provided'`, use `locator_suggestion` as-is.
Comment the generated locator with `// [USER-PROVIDED]`.

**CLI flag:** `--interactive` — opt-in only. Without this flag, Gate 4 errors as before.

```bash
node src/agent/cli.js --prompt "..." --page HyvaHome --interactive
```

**Billing note:** No API call is made while stdin is waiting. The Claude API is only
called after all gates (including 4.5) pass. User input is zero-cost.

---

## GATE 5 — PENDING PATCH DEDUPLICATION

```js
function buildSafeConfigKeys(testdataConfig, pendingPatches) {
  const existingKeys = new Set([
    ...Object.keys(flattenKeys(testdataConfig)),
    ...Object.keys(pendingPatches)
  ]);
  return existingKeys; // pass to agent context as forbidden_keys[]
}
// Agent receives forbidden_keys[]. Any key it proposes that matches → orchestrator strips it post-call.
```

---

## GATE 6 — TIER 3 PERMISSION

```js
function resolveTier3(options = {}) {
  // tier3Allowed is a deliberate caller opt-in. Default: false.
  return options.tier3Allowed === true;
}
```

Pass `tier3_allowed: boolean` into agent context. Agent reads it as a boolean fact, not a rule to evaluate.

---

## GATE 7 — POST-CALL ENVELOPE VALIDATION

After the Claude API responds, validate the envelope before writing any files.

```js
function validateEnvelope(envelope, forbiddenKeys) {
  // 1. Strip any config_patch keys that already exist
  if (envelope.config_patch?.patches) {
    envelope.config_patch.patches = envelope.config_patch.patches.filter(p => {
      if (forbiddenKeys.has(p.key)) {
        console.warn(`[ORCHESTRATOR] Stripped duplicate key from agent output: ${p.key}`);
        return false;
      }
      return true;
    });
  }

  // 2. Validate proposed_by_prompt format: "{feature}/{test_name}"
  envelope.config_patch?.patches?.forEach(p => {
    if (!/^[\w-]+\/[\w-]+$/.test(p.proposed_by_prompt)) {
      throw new OrchestratorError('INVALID_PATCH_FORMAT', `proposed_by_prompt must be "{feature}/{test_name}", got: ${p.proposed_by_prompt}`);
    }
  });

  // 3. Reject any file path outside allowed directories
  const ALLOWED_DIRS = ['src/elements/', 'src/pages/', 'src/tests/', 'config/'];
  envelope.files?.forEach(f => {
    if (!ALLOWED_DIRS.some(dir => f.path.startsWith(dir))) {
      throw new OrchestratorError('INVALID_FILE_PATH', `Agent attempted to write outside allowed dirs: ${f.path}`);
    }
  });

  return envelope;
}
```

---

## CONTEXT PAYLOAD SHAPE (what you send to the agent)

```js
const agentContext = {
  prompt_id: generateUUID(),
  tier3_allowed: resolveTier3(options),
  stale_warning: staleResult.warning || null,
  method_index: methodIndex,             // full, for method lookup
  pending_patches: pendingPatches,       // full, for key lookup
  scout_elements: filteredElements,      // pre-filtered + registry state attached
  forbidden_keys: [...buildSafeConfigKeys(testdataConfig, pendingPatches)],
  user_prompt: userPrompt
};
```

Do NOT send:
- Raw `registry_context.json` (pre-resolved into each element)
- Raw `scout_summary.json` unfiltered (pre-filtered to matched elements)
- Raw `testdata.config.js` (pre-extracted to `forbidden_keys[]`)

---

## ERROR TYPES

```js
class OrchestratorError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // MISSING_INPUT | STALE_INDEX | NO_ELEMENTS_MATCHED | INVALID_PATCH_FORMAT | INVALID_FILE_PATH | INVALID_ENVELOPE
  }
}
```

Surface these to the UI/caller. Do not swallow them silently.

---

## WHAT THE ORCHESTRATOR OWNS (summary)

| Concern                          | Owner        |
|----------------------------------|--------------|
| Input presence validation        | Orchestrator |
| Stale index halt + ack           | Orchestrator |
| Registry state resolution        | Orchestrator |
| Scout element filtering          | Orchestrator |
| Interactive element input (Gate 4.5) | Orchestrator |
| Pending patch deduplication      | Orchestrator |
| Tier 3 permission gate           | Orchestrator |
| Post-call envelope validation    | Orchestrator |
| Token limit enforcement          | API max_tokens param |
| Locator tier selection           | Agent        |
| NL → element matching            | Agent        |
| Code generation                  | Agent        |
| Multi-file split signaling       | Agent        |
| Warning narration                | Agent        |
