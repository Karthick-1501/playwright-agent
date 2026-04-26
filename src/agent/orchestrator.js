'use strict';

/**
 * Orchestrator — all 7 deterministic gates from ORCHESTRATOR_SPEC_v1.0.md
 * The agent (Claude API) is NEVER called until every gate passes.
 * The agent receives only clean, pre-resolved context. It never re-validates.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

const { RegistryManager } = require('../registry/registry-manager');
const { HealManager } = require('../registry/heal');

const AGENT_DIR = path.resolve(__dirname, '../../.agent');
const MASTER_MEMORY_PATH = path.resolve(__dirname, '../../.docs/memory/MASTER_MEMORY_v3.0.md');
const MAX_TOKENS = 8192;

// ── Error type ───────────────────────────────────────────────────────────────

class OrchestratorError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'OrchestratorError';
    this.code = code;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function generatePromptId() {
  return `orch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function flattenKeys(obj, prefix = '') {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flattenKeys(v, full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}

// ── Interactive element input ────────────────────────────────────────────────
// Called when Gate 4 finds no scout match and options.interactive is true.
// Asks the user to describe the missing element via stdin. Returns a synthetic
// scout element in the exact shape gate4_filterScoutElements() returns, so the
// agent receives it identically to a real scout element.

async function promptUserForElement(pageName) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question) => new Promise((resolve) => rl.question(question, resolve));

  console.log('\n[ORCHESTRATOR] Gate 4: No scout elements matched your prompt.');
  console.log('  Interactive mode — describe the missing element:\n');

  const role  = await ask('  Role (button / link / textbox / combobox / checkbox): ');
  const label = await ask('  Visible label or accessible name (exactly as seen in browser): ');
  const tier  = await ask('  Tier (1 = getByRole/getByLabel, 2 = data-test attr, 3 = #id): ');

  rl.close();

  // Build camelCase key from label
  const camel = label
    .trim()
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .replace(/\s+(.)/g, (_, c) => c.toUpperCase())
    .replace(/^(.)/, (_, c) => c.toLowerCase());

  const key = `${pageName}.${camel}`;
  const tierNum = parseInt(tier.trim(), 10) || 1;

  let locatorSuggestion;
  if (tierNum === 1) {
    locatorSuggestion = `page.getByRole('${role.trim()}', { name: '${label.trim()}' })`;
  } else if (tierNum === 2) {
    locatorSuggestion = `page.locator('[data-test="${camel}"]')`;
  } else {
    locatorSuggestion = `page.locator('#${camel}')`;
  }

  console.log(`\n[ORCHESTRATOR] Element registered: ${key} → ${locatorSuggestion}`);

  return {
    key,
    tag: role.trim() === 'button' ? 'button' : 'a',
    role: role.trim(),
    label: label.trim(),
    tier_suggestion: tierNum,
    locator_suggestion: locatorSuggestion,
    disabled: false,
    source: 'user-provided',
    dom_only: false,
    registry_state: 'NONE',
    resolved_selector: null,
  };
}

// ── Gate 1 — Input Presence ──────────────────────────────────────────────────

function gate1_validateInputs({ methodIndex, pendingPatches, registryContext, scoutSummary }) {
  if (!pendingPatches) throw new OrchestratorError('MISSING_INPUT', 'pending_patches.json is required.');
  if (!methodIndex) throw new OrchestratorError('MISSING_INPUT', 'method_index.json is required.');
  if (!registryContext) throw new OrchestratorError('MISSING_INPUT', 'registry_context.json is required.');
  if (!scoutSummary) throw new OrchestratorError('MISSING_INPUT', 'scout_summary.json is required.');
}

// ── Gate 2 — Stale Index ─────────────────────────────────────────────────────

function gate2_checkStaleIndex(methodIndex, options = {}) {
  if (methodIndex.stale === true) {
    if (!options.staleAck) {
      throw new OrchestratorError(
        'STALE_INDEX',
        'method_index.json is stale. Refresh it or pass { staleAck: true } to continue.'
      );
    }
    return { warning: 'INDEX_WARNING: Method index is stale. stale_ack accepted. Duplicate method risk is caller-owned.' };
  }
  return {};
}

// ── Gate 3 — Registry State Resolution ──────────────────────────────────────

function gate3_resolveRegistryState(page, element, registryContext) {
  const record = registryContext?.selectors?.[`${page}.${element}`];

  if (!record) return { registry_state: 'NONE', resolved_selector: null };

  if (record.heal_attempts >= 2) {
    return { registry_state: 'QUARANTINE', resolved_selector: null };
  }
  if (record.success_rate >= 0.85) {
    return {
      registry_state: 'HEALTHY',
      resolved_selector: record.locator,
      heal_version: record.heal_version || 0,
    };
  }
  if (record.success_rate >= 0.50) {
    return { registry_state: 'DEGRADED', resolved_selector: record.locator };
  }
  return { registry_state: 'BROKEN', resolved_selector: null };
}

// ── Gate 4 — Scout Element Filtering ─────────────────────────────────────────

const ACTION_VERBS = ['click', 'fill', 'type', 'select', 'check', 'navigate', 'assert', 'verify',
  'login', 'enter', 'add', 'open', 'go', 'submit', 'search'];
const BROAD_VERBS = ['generate', 'create', 'write', 'build', 'make', 'test'];

// Stop words filtered from extracted targets — these are prepositions/conjunctions that
// appear adjacent to action verbs but are never element names. Also includes domain
// noise words that match too broadly against scout element keys (cart, watch, subtotal, etc.)
const TARGET_STOP_WORDS = new Set([
  // prepositions / conjunctions
  'a', 'an', 'the', 'for', 'with', 'and', 'or', 'to', 'in', 'on', 'of', 'that', 'this', 'it',
  'is', 'are', 'was', 'be', 'at', 'by', 'as', 'up',
  // test-domain nouns that cause over-matching
  'cart', 'subtotal', 'ui', 'url', 'then', 'visible', 'page',
  // generic product-type words (too broad — match every watch/jacket)
  'watch', 'jacket', 'bag', 'item', 'product',
  // assertion words
  'contains', 'assert', 'verify', 'calculate',
]);

function gate4_filterScoutElements(scoutSummary, userPrompt, registryContext) {
  const tokens = userPrompt.toLowerCase().split(/\s+/);

  // Strategy 1: scan forward from each action verb collecting all noun tokens until
  // the next action verb or end of prompt. Filtered through TARGET_STOP_WORDS.
  // This handles prompts like "add Aim Analog Watch and Endurance Watch to cart" where
  // multiple product names follow a single action verb — [i+1, i+2] only captured the first.
  const targets = [];
  tokens.forEach((token, i) => {
    if (ACTION_VERBS.includes(token)) {
      let j = i + 1;
      while (j < tokens.length && !ACTION_VERBS.includes(tokens[j]) && !BROAD_VERBS.includes(tokens[j])) {
        if (!TARGET_STOP_WORDS.has(tokens[j]) && tokens[j].length > 1) {
          targets.push(tokens[j]);
        }
        j++;
      }
    }
  });

  // Strategy 2: for broad verbs (generate, create), extract all remaining nouns
  // as potential page/element name matches
  if (targets.length === 0) {
    const stopWords = new Set([
      ...ACTION_VERBS, ...BROAD_VERBS,
      // determiners & prepositions
      'a', 'an', 'the', 'for', 'with', 'and', 'or', 'to', 'in', 'on', 'of', 'that', 'this', 'it',
      // test-domain nouns (not element names)
      'test', 'tests', 'spec', 'page', 'flow', 'case', 'cases', 'scenario', 'scenarios', 'suite',
      // qualifiers & adjectives
      'comprehensive', 'complete', 'full', 'all', 'basic', 'simple', 'every', 'each', 'new',
      'happy', 'sad', 'negative', 'positive', 'valid', 'invalid', 'path',
      'should', 'using', 'multiple', 'different', 'various', 'entire',
    ]);
    tokens.forEach(token => {
      if (!stopWords.has(token) && token.length > 2) {
        targets.push(token);
      }
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

  // Strategy 3: if no specific matches, check if prompt mentions the page name
  // and return ALL elements for that page (covers "generate a login test")
  if (matched.length === 0) {
    const pageLower = scoutSummary.page.toLowerCase();
    if (tokens.includes(pageLower)) {
      matched = scoutSummary.elements;
    }
  }

  // No match after all strategies — throw, do NOT silently dump all elements
  if (matched.length === 0) {
    throw new OrchestratorError(
      'NO_ELEMENTS_MATCHED',
      `No scout elements matched targets: [${targets.join(', ')}]. Clarify element role, label, or visible text.`
    );
  }

  const [firstEl] = matched;
  const page = firstEl?.key?.split('.')[0] || scoutSummary.page;

  return matched.map(el => {
    const [elPage, elementName] = el.key.split('.');
    const registryResult = gate3_resolveRegistryState(elPage || page, elementName, registryContext);
    return {
      ...el,
      dom_only: el.source === 'dom',
      ...registryResult,
    };
  });
}

// ── Gate 5 — Pending Patch Deduplication ─────────────────────────────────────

function gate5_buildForbiddenKeys(testdataConfig, pendingPatches) {
  const existing = flattenKeys(testdataConfig._data || testdataConfig);
  const pending = Object.keys(pendingPatches.patches || pendingPatches);
  return new Set([...existing, ...pending]);
}

// ── Gate 6 — Tier 3 Permission ────────────────────────────────────────────────

function gate6_resolveTier3(options = {}) {
  return options.tier3Allowed === true;
}

// ── Gate 7 — Post-call Envelope Validation ───────────────────────────────────

const ALLOWED_DIRS = ['src/elements/', 'src/pages/', 'src/tests/', 'config/'];

function gate7_validateEnvelope(envelope, forbiddenKeys) {
  if (!envelope || typeof envelope !== 'object') {
    throw new OrchestratorError('INVALID_ENVELOPE', 'Agent response is not a valid JSON object.');
  }

  // Strip duplicate config keys
  if (envelope.config_patch?.patches) {
    envelope.config_patch.patches = envelope.config_patch.patches.filter(p => {
      if (forbiddenKeys.has(p.key)) {
        console.warn(`[ORCHESTRATOR] Stripped duplicate key: ${p.key}`);
        return false;
      }
      return true;
    });
  }

  // Validate proposed_by_prompt format
  envelope.config_patch?.patches?.forEach(p => {
    if (!/^[\w-]+\/[\w-]+$/.test(p.proposed_by_prompt)) {
      throw new OrchestratorError(
        'INVALID_PATCH_FORMAT',
        `proposed_by_prompt must be "{feature}/{test_name}", got: ${p.proposed_by_prompt}`
      );
    }
  });

  // Reject file paths outside allowed dirs
  envelope.files?.forEach(f => {
    if (!ALLOWED_DIRS.some(dir => f.path.startsWith(dir))) {
      throw new OrchestratorError('INVALID_FILE_PATH', `Agent wrote outside allowed dirs: ${f.path}`);
    }
  });

  return envelope;
}

// ── Apply Envelope ─────────────────────────────────────────────────────────────

function applyEnvelope(envelope, projectRoot) {
  const results = { filesWritten: [], registryUpdated: [], warnings: envelope.warnings || [] };

  // Write files
  for (const file of envelope.files || []) {
    const absPath = path.resolve(projectRoot, file.path);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, file.content, 'utf8');
    results.filesWritten.push(file.path);
    console.log(`[ORCHESTRATOR] Wrote ${file.status}: ${file.path}`);
  }

  // Apply registry updates — including patching the elements file
  if ((envelope.registry_updates || []).length > 0) {
    const registryManager = new RegistryManager(path.join(AGENT_DIR, 'registry.json'));
    registryManager.load();
    registryManager.applyRegistryUpdates(envelope.registry_updates);
    registryManager.save();

    // Sync elements files with healed locators
    for (const update of envelope.registry_updates) {
      _syncElementsFile(update, projectRoot);
      results.registryUpdated.push(`${update.page}.${update.element}`);
    }

    console.log(`[ORCHESTRATOR] Registry updated: ${results.registryUpdated.join(', ')}`);
  }

  // Apply config patches to testdata.config.js
  if ((envelope.config_patch?.patches || []).length > 0) {
    _applyConfigPatches(envelope.config_patch.patches, projectRoot);
  }

  return results;
}

function _syncElementsFile(update, projectRoot) {
  const elementsPath = path.resolve(projectRoot, `src/elements/${update.page}.elements.js`);
  if (!fs.existsSync(elementsPath)) return;

  const content = fs.readFileSync(elementsPath, 'utf8');
  const elementName = update.element;
  const lines = content.split('\n');

  const comment = update.source === 'agent-generated'
    ? '// [AGENT-GENERATED: DOM-ONLY]'
    : `// [REGISTRY-HEALED v${update.heal_version || 1}]`;

  const newLine = `  ${elementName}: (page) => ${update.selector}, ${comment}`;

  const idx = lines.findIndex(l => l.trim().startsWith(elementName + ':'));
  if (idx === -1) return;

  lines[idx] = newLine;
  const tmpPath = elementsPath + '.tmp';
  fs.writeFileSync(tmpPath, lines.join('\n'), 'utf8');
  fs.renameSync(tmpPath, elementsPath);
  console.log(`[ORCHESTRATOR] Synced elements file: ${update.page}.elements.js → ${elementName}`);
}

function _applyConfigPatches(patches, projectRoot) {
  const configPath = path.resolve(projectRoot, 'config/testdata.config.js');
  // Log patches as pending — full merge deferred to Phase 5 CLI
  const pendingPath = path.join(AGENT_DIR, 'pending_patches.json');
  const existing = loadJson(pendingPath) || { version: '1.0.0', patches: [] };
  existing.patches.push(...patches);
  fs.writeFileSync(pendingPath, JSON.stringify(existing, null, 2), 'utf8');
  console.log(`[ORCHESTRATOR] Staged ${patches.length} config patch(es) to pending_patches.json`);
}

// ── Main Entry Point ──────────────────────────────────────────────────────────

async function runAgent(userPrompt, options = {}) {
  const projectRoot = path.resolve(__dirname, '../..');
  const promptId = generatePromptId();

  console.log(`\n[ORCHESTRATOR] Starting — prompt_id: ${promptId}`);
  console.log(`[ORCHESTRATOR] User prompt: "${userPrompt}"`);

  // Load context files
  const methodIndex = loadJson(path.join(AGENT_DIR, 'method_index.json'));
  const pendingPatches = loadJson(path.join(AGENT_DIR, 'pending_patches.json'));
  const registryContext = loadJson(path.join(AGENT_DIR, 'registry.json'));

  // Determine which scout summary to use (default to Login if not specified)
  const pageName = options.page || 'Login';
  const scoutSummary = loadJson(path.join(AGENT_DIR, 'scout', `${pageName}_summary.json`));

  // Gate 1
  gate1_validateInputs({ methodIndex, pendingPatches, registryContext, scoutSummary });
  console.log('[ORCHESTRATOR] Gate 1: inputs present ✓');

  // Gate 2
  const staleResult = gate2_checkStaleIndex(methodIndex, options);
  if (staleResult.warning) console.warn(`[ORCHESTRATOR] ${staleResult.warning}`);
  console.log('[ORCHESTRATOR] Gate 2: index freshness ✓');

  // Gate 3 + 4
  let filteredElements;
  try {
    filteredElements = gate4_filterScoutElements(scoutSummary, userPrompt, registryContext);
  } catch (err) {
    if (err.code === 'NO_ELEMENTS_MATCHED' && options.interactive) {
      const userElement = await promptUserForElement(pageName);
      filteredElements = [userElement];
    } else {
      throw err;
    }
  }
  console.log(`[ORCHESTRATOR] Gates 3+4: resolved ${filteredElements.length} element(s) ✓`);

  // Gate 5
  const testdataConfig = require(path.resolve(projectRoot, 'config/testdata.config.js'));
  const forbiddenKeys = gate5_buildForbiddenKeys(testdataConfig, pendingPatches);
  console.log(`[ORCHESTRATOR] Gate 5: ${forbiddenKeys.size} forbidden key(s) ✓`);

  // Gate 6
  const tier3Allowed = gate6_resolveTier3(options);
  console.log(`[ORCHESTRATOR] Gate 6: tier3_allowed=${tier3Allowed} ✓`);

  // Build agent context payload
  const agentContext = {
    prompt_id: promptId,
    tier3_allowed: tier3Allowed,
    stale_warning: staleResult.warning || null,
    method_index: methodIndex,
    pending_patches: pendingPatches,
    scout_elements: filteredElements,
    forbidden_keys: [...forbiddenKeys],
    user_prompt: userPrompt,
  };

  // Load MASTER_MEMORY system prompt
  if (!fs.existsSync(MASTER_MEMORY_PATH)) {
    throw new OrchestratorError('MISSING_INPUT', 'MASTER_MEMORY_v3.0.md not found.');
  }
  const systemPrompt = fs.readFileSync(MASTER_MEMORY_PATH, 'utf8');

  // Call Claude API
  console.log('[ORCHESTRATOR] Calling Claude API…');

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new OrchestratorError('MISSING_API_KEY', 'ANTHROPIC_API_KEY environment variable is not set.');
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: JSON.stringify(agentContext),
      },
    ],
  });

  const rawContent = response.content[0]?.text || '';

  // Parse envelope
  let envelope;
  try {
    const clean = rawContent.replace(/^```json\s*/m, '').replace(/```\s*$/m, '').trim();
    envelope = JSON.parse(clean);
  } catch (parseErr) {
    throw new OrchestratorError('INVALID_ENVELOPE', `Agent response is not valid JSON: ${parseErr.message}\n\nRaw:\n${rawContent}`);
  }

  // Gate 7
  const validated = gate7_validateEnvelope(envelope, forbiddenKeys);
  console.log('[ORCHESTRATOR] Gate 7: envelope validated ✓');

  // Apply envelope
  const results = applyEnvelope(validated, projectRoot);

  console.log(`\n[ORCHESTRATOR] Done — prompt_id: ${promptId}`);
  if (results.filesWritten.length) console.log(`  Files written   : ${results.filesWritten.join(', ')}`);
  if (results.registryUpdated.length) console.log(`  Registry updated: ${results.registryUpdated.join(', ')}`);
  if (results.warnings.length) {
    console.log(`  Warnings (${results.warnings.length}):`);
    results.warnings.forEach(w => console.log(`    → ${w}`));
  }

  if ((validated.clarifications || []).length) {
    console.log(`\n[ORCHESTRATOR] ⚠ Agent needs clarification before generating (${validated.clarifications.length}):`);
    validated.clarifications.forEach((c, i) => console.log(`    ${i + 1}. ${c}`));
    console.log(`\n  → Re-run with a more specific --prompt that answers the above.`);
  }

  if (!results.filesWritten.length && !results.registryUpdated.length && !(validated.clarifications || []).length) {
    console.log(`  ⚠ No files written and no clarifications returned. Check agent context — scout may be missing target elements.`);
  }

  return { promptId, envelope: validated, results };
}

module.exports = { runAgent, OrchestratorError };
