'use strict';

const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// --- CLI ---
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1] || true;
      i++;
    }
  }
  return args;
}

// --- Helpers ---
function toCamelCase(str) {
  if (!str) return '';
  return str
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .trim()
    .replace(/\s+(.)/g, (_, c) => c.toUpperCase())
    .replace(/^(.)/, (_, c) => c.toLowerCase());
}

function estimateTokens(charCount) {
  return Math.ceil(charCount / 4);
}

// --- Pass 1: Accessibility tree via CDP ---
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox',
  'listbox', 'option', 'menuitem', 'tab', 'spinbutton', 'searchbox',
  'switch', 'slider',
]);

async function getA11yElements(cdpClient) {
  const { nodes } = await cdpClient.send('Accessibility.getFullAXTree');
  return nodes
    .filter(n => !n.ignored && n.role?.value && INTERACTIVE_ROLES.has(n.role.value.toLowerCase()))
    .map(n => ({
      role: n.role.value.toLowerCase(),
      name: n.name?.value || null,
      disabled: n.properties?.some(p => p.name === 'disabled' && p.value?.value === true) || false,
    }))
    .filter(n => n.name);
}

// --- Pass 2: DOM overlay (runs in browser) ---
const DOM_OVERLAY_SCRIPT = () => {
  const INTERACTIVE_TAGS = new Set(['INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'A']);
  const els = Array.from(document.querySelectorAll(
    'input, button, select, textarea, a[href], [data-test], [data-qa], [data-testid]'
  ));
  return els
    .filter(el => {
      const s = window.getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
    })
    .map(el => ({
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      dataTest: el.getAttribute('data-test') || null,
      dataQa: el.getAttribute('data-qa') || null,
      dataTestid: el.getAttribute('data-testid') || null,
      placeholder: el.placeholder || null,
      ariaLabel: el.getAttribute('aria-label') || null,
      type: el.type || null,
      disabled: el.disabled || el.hasAttribute('disabled'),
      isInteractive: INTERACTIVE_TAGS.has(el.tagName),
    }));
};

// --- Pass 3: Raw HTML char count ---
const RAW_HTML_SCRIPT = () => document.body.innerHTML.length;

// --- Pass 4: Shadow DOM + iframe detection ---
const SHADOW_SCRIPT = () => {
  const hosts = [];
  for (const el of document.querySelectorAll('*')) {
    if (el.shadowRoot) {
      hosts.push({ tag: el.tagName.toLowerCase(), id: el.id || null, dataTest: el.getAttribute('data-test') || null });
    }
  }
  return hosts;
};

const IFRAME_SCRIPT = () =>
  Array.from(document.querySelectorAll('iframe, frame')).map(f => ({
    id: f.id || null,
    name: f.name || null,
    src: f.src || null,
  }));

// --- Merge ---
function _normalize(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function _findMatchingDom(a11y, domElements, domByHook, domById) {
  const nameNorm = _normalize(a11y.name);
  if (!nameNorm) return null;

  // Exact hook match (original logic)
  const hookMatch = domByHook.get(a11y.name);
  if (hookMatch) return hookMatch;

  // Case-insensitive match on placeholder, ariaLabel, or id
  for (const dom of domElements) {
    if (_normalize(dom.placeholder) === nameNorm) return dom;
    if (_normalize(dom.ariaLabel) === nameNorm) return dom;
    if (_normalize(dom.id) === nameNorm) return dom;
    // Partial: data-test value normalized matches a11y name normalized
    if (dom.dataTest && _normalize(dom.dataTest) === nameNorm) return dom;
    if (dom.dataQa && _normalize(dom.dataQa) === nameNorm) return dom;
    if (dom.dataTestid && _normalize(dom.dataTestid) === nameNorm) return dom;
  }

  return null;
}

function mergeElements(pageName, a11yElements, domElements) {
  const used = new Set();
  const usedDom = new Set();
  const elements = [];

  const domByHook = new Map();
  const domById = new Map();
  for (let i = 0; i < domElements.length; i++) {
    const dom = domElements[i];
    const hook = dom.dataTest || dom.dataQa || dom.dataTestid;
    if (hook) domByHook.set(hook, dom);
    if (dom.id) domById.set(dom.id, dom);
  }

  function buildEntry(key, a11y, dom) {
    let tier, locator;
    if (dom?.dataTest) {
      tier = 2; locator = `page.locator('[data-test="${dom.dataTest}"]')`;
    } else if (dom?.dataTestid) {
      tier = 2; locator = `page.getByTestId('${dom.dataTestid}')`;
    } else if (dom?.dataQa) {
      tier = 2; locator = `page.locator('[data-qa="${dom.dataQa}"]')`;
    } else if (a11y?.role && a11y?.name) {
      tier = 1; locator = `page.getByRole('${a11y.role}', { name: '${a11y.name}' })`;
    } else if (dom?.id) {
      tier = 3; locator = `page.locator('#${dom.id}')`; // [TIER-3: VERIFY STABILITY]
    } else {
      return null;
    }
    return {
      key,
      tag: dom?.tag || null,
      role: a11y?.role || null,
      label: a11y?.name || dom?.placeholder || dom?.ariaLabel || null,
      testId: dom?.dataTestid || null,
      attributes: {
        'data-test': dom?.dataTest || null,
        'data-qa': dom?.dataQa || null,
        id: dom?.id || null,
      },
      tier_suggestion: tier,
      locator_suggestion: locator,
      disabled: a11y?.disabled || dom?.disabled || false,
      source: a11y && dom ? 'a11y+dom' : (a11y ? 'a11y' : 'dom'),
    };
  }

  // Pass A: match each a11y element to its best DOM counterpart
  for (const a11y of a11yElements) {
    const key = `${pageName}.${toCamelCase(a11y.name)}`;
    if (used.has(key)) continue;
    used.add(key);
    const dom = _findMatchingDom(a11y, domElements, domByHook, domById);
    if (dom) usedDom.add(dom);
    const entry = buildEntry(key, a11y, dom);
    if (entry) elements.push(entry);
  }

  // Pass B: DOM-only elements not matched by any a11y entry
  for (const dom of domElements) {
    if (!dom.isInteractive) continue;
    if (usedDom.has(dom)) continue;
    const labelBase = dom.dataTest || dom.dataQa || dom.dataTestid || dom.placeholder || dom.ariaLabel || dom.id;
    if (!labelBase) continue;
    const key = `${pageName}.${toCamelCase(labelBase)}`;
    if (used.has(key)) continue;
    used.add(key);
    const entry = buildEntry(key, null, dom);
    if (entry) elements.push(entry);
  }

  return elements;
}

// --- Main ---
async function run() {
  const args = parseArgs(process.argv);
  if (!args.url || !args.page) {
    console.error('Usage: node src/agent/scout.js --url <url> --page <PageName>');
    process.exit(1);
  }

  const { url, page: pageName } = args;
  console.log(`[scout] Starting: ${pageName} @ ${url}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(url, { waitUntil: 'load', timeout: 30000 });

  const cdp = await context.newCDPSession(page);

  const [a11yElements, domElements, rawHtmlChars, shadowHosts, iframes] = await Promise.all([
    getA11yElements(cdp),
    page.evaluate(DOM_OVERLAY_SCRIPT),
    page.evaluate(RAW_HTML_SCRIPT),
    page.evaluate(SHADOW_SCRIPT),
    page.evaluate(IFRAME_SCRIPT),
  ]);

  await browser.close();
  const elements = mergeElements(pageName, a11yElements, domElements);

  const warnings = [
    ...shadowHosts.map(s => `SHADOW_DOM_DETECTED: ${s.id ? '#' + s.id : s.dataTest ? `[data-test="${s.dataTest}"]` : s.tag}`),
    ...iframes.map(f => `IFRAME_DETECTED: ${f.id ? '#' + f.id : f.name || f.src || 'unknown'}`),
  ];

  const rawTokenEstimate = estimateTokens(rawHtmlChars);
  const scoutJson = JSON.stringify(elements, null, 2);
  const scoutTokenEstimate = estimateTokens(scoutJson.length);
  const reductionPct = parseFloat((((rawTokenEstimate - scoutTokenEstimate) / rawTokenEstimate) * 100).toFixed(1));

  const summary = {
    page: pageName,
    url,
    timestamp: new Date().toISOString(),
    raw_html_chars: rawHtmlChars,
    raw_token_estimate: rawTokenEstimate,
    scout_token_estimate: scoutTokenEstimate,
    reduction_pct: reductionPct,
    elements,
    warnings,
  };

  const outDir = path.resolve(__dirname, '../../.agent/scout');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${pageName}_summary.json`);
  fs.writeFileSync(outFile, JSON.stringify(summary, null, 2), 'utf8');

  console.log(`[scout] Done`);
  console.log(`  Elements found : ${elements.length}`);
  console.log(`  Raw HTML chars : ${rawHtmlChars.toLocaleString()}`);
  console.log(`  Raw tokens     : ~${rawTokenEstimate.toLocaleString()}`);
  console.log(`  Scout tokens   : ~${scoutTokenEstimate.toLocaleString()}`);
  console.log(`  Reduction      : ${reductionPct}%`);
  console.log(`  Warnings       : ${warnings.length}`);
  if (warnings.length) warnings.forEach(w => console.log(`    → ${w}`));
  console.log(`  Output         : .agent/scout/${pageName}_summary.json`);
}

run().catch(err => {
  console.error('[scout] Fatal error:', err);
  process.exit(1);
});
