const fs = require('fs');
const path = require('path');
const { RegistryManager } = require('../src/registry/registry-manager');
const { HealManager } = require('../src/registry/heal');

const TMP_DIR = path.resolve(__dirname, '../.tmp-heal-test');
const TMP_REGISTRY = path.join(TMP_DIR, 'registry.json');
const TMP_SCOUT = path.join(TMP_DIR, 'scout');

let passed = 0;
let failed = 0;

function assert(condition, label) {
    if (condition) {
        passed++;
    } else {
        failed++;
        console.error(`  FAIL: ${label}`);
    }
}

function assertEqual(actual, expected, label) {
    const match = JSON.stringify(actual) === JSON.stringify(expected);
    if (match) {
        passed++;
    } else {
        failed++;
        console.error(`  FAIL: ${label}`);
        console.error(`    expected: ${JSON.stringify(expected)}`);
        console.error(`    actual:   ${JSON.stringify(actual)}`);
    }
}

function cleanup() {
    if (fs.existsSync(TMP_DIR)) {
        fs.rmSync(TMP_DIR, { recursive: true, force: true });
    }
}

function writeScout(pageName, elements, warnings = []) {
    fs.mkdirSync(TMP_SCOUT, { recursive: true });
    const summary = {
        page: pageName,
        url: 'https://test.example.com',
        timestamp: new Date().toISOString(),
        elements,
        warnings,
    };
    fs.writeFileSync(path.join(TMP_SCOUT, `${pageName}_summary.json`), JSON.stringify(summary, null, 2), 'utf8');
}

function freshSetup() {
    cleanup();
    const rm = new RegistryManager(TMP_REGISTRY).load();
    const hm = new HealManager(rm, TMP_SCOUT);
    return { rm, hm };
}

// ── Test Suite ──

console.log('\n=== HealManager Test Suite ===\n');

// 1. findBrokenKeys — returns only BROKEN
console.log('1. findBrokenKeys');
{
    const { rm, hm } = freshSetup();
    rm.set('P.healthy', { locator: 'h', tier: 1, success_rate: 1.0 });
    rm.set('P.degraded', { locator: 'd', tier: 1, success_rate: 0.70 });
    rm.set('P.broken', { locator: 'b', tier: 1, success_rate: 0.20 });
    rm.set('P.quarantined', { locator: 'q', tier: 1, success_rate: 0.10, heal_attempts: 2 });

    const broken = hm.findBrokenKeys();
    assertEqual(broken.length, 1, 'only 1 broken');
    assertEqual(broken[0], 'P.broken', 'correct key');

    const degraded = hm.findDegradedKeys();
    assertEqual(degraded.length, 1, 'only 1 degraded');
    assertEqual(degraded[0], 'P.degraded', 'correct degraded key');

    const quarantined = hm.findQuarantinedKeys();
    assertEqual(quarantined.length, 1, 'only 1 quarantined');
    assertEqual(quarantined[0], 'P.quarantined', 'correct quarantined key');
}

// 2. findCandidates — scout missing
console.log('2. findCandidates — scout missing');
{
    const { rm, hm } = freshSetup();
    rm.set('Missing.el', { locator: 'old', tier: 2 });
    const result = hm.findCandidates('Missing.el');
    assertEqual(result.error, 'SCOUT_MISSING', 'error when no scout file');
    assertEqual(result.candidates.length, 0, 'empty candidates');
}

// 3. findCandidates — registry key missing
console.log('3. findCandidates — registry key missing');
{
    const { hm } = freshSetup();
    writeScout('Test', []);
    const result = hm.findCandidates('Test.nonexistent');
    assertEqual(result.error, 'REGISTRY_KEY_MISSING', 'error for missing key');
}

// 4. findCandidates — filters disabled elements
console.log('4. findCandidates — disabled elements excluded');
{
    const { rm, hm } = freshSetup();
    rm.set('Login.btn', { locator: 'old-btn', tier: 2 });
    writeScout('Login', [
        {
            key: 'Login.btn',
            role: 'button',
            label: 'Login',
            tier_suggestion: 1,
            locator_suggestion: "page.getByRole('button', { name: 'Login' })",
            disabled: true,
            source: 'a11y',
        },
    ]);
    const result = hm.findCandidates('Login.btn');
    assertEqual(result.candidates.length, 0, 'disabled not included');
}

// 5. findCandidates — filters same locator as current
console.log('5. findCandidates — skips current locator');
{
    const { rm, hm } = freshSetup();
    rm.set('Login.btn', { locator: "page.getByRole('button', { name: 'Login' })", tier: 1 });
    writeScout('Login', [
        {
            key: 'Login.loginButton',
            role: 'button',
            label: 'Login',
            tier_suggestion: 1,
            locator_suggestion: "page.getByRole('button', { name: 'Login' })",
            disabled: false,
            source: 'a11y',
        },
    ]);
    const result = hm.findCandidates('Login.btn');
    assertEqual(result.candidates.length, 0, 'same locator excluded');
}

// 6. findCandidates — tier 3 gated
console.log('6. findCandidates — tier 3 gated by default');
{
    const { rm, hm } = freshSetup();
    rm.set('Login.btn', { locator: 'old', tier: 2 });
    writeScout('Login', [
        {
            key: 'Login.loginButton',
            role: null,
            label: null,
            tier_suggestion: 3,
            locator_suggestion: "page.locator('#login-button')",
            disabled: false,
            source: 'dom',
        },
    ]);
    const noTier3 = hm.findCandidates('Login.btn');
    assertEqual(noTier3.candidates.length, 0, 'tier 3 excluded by default');

    const withTier3 = hm.findCandidates('Login.btn', { tier3Allowed: true });
    assertEqual(withTier3.candidates.length, 1, 'tier 3 included when allowed');
}

// 7. findCandidates — sorted by tier then score
console.log('7. findCandidates — sorted tier > score');
{
    const { rm, hm } = freshSetup();
    rm.set('Login.btn', { locator: 'old', tier: 2 });
    writeScout('Login', [
        {
            key: 'Login.loginButton',
            role: null,
            label: null,
            tier_suggestion: 2,
            locator_suggestion: "page.locator('[data-test=\"login-button\"]')",
            disabled: false,
            source: 'dom',
        },
        {
            key: 'Login.login',
            role: 'button',
            label: 'Login',
            tier_suggestion: 1,
            locator_suggestion: "page.getByRole('button', { name: 'Login' })",
            disabled: false,
            source: 'a11y',
        },
    ]);
    const result = hm.findCandidates('Login.btn');
    assertEqual(result.candidates[0].tier, 1, 'best tier first');
}

// 8. healKey — QUARANTINE blocked
console.log('8. healKey — QUARANTINE blocks heal');
{
    const { rm, hm } = freshSetup();
    rm.set('P.el', { locator: 'old', tier: 2, heal_attempts: 2 });
    writeScout('P', []);
    const result = hm.healKey('P.el');
    assertEqual(result.healed, false, 'not healed');
    assertEqual(result.reason, 'QUARANTINE', 'reason = QUARANTINE');
}

// 9. healKey — HEALTHY skipped
console.log('9. healKey — HEALTHY skipped');
{
    const { rm, hm } = freshSetup();
    rm.set('P.el', { locator: 'old', tier: 1, success_rate: 1.0 });
    const result = hm.healKey('P.el');
    assertEqual(result.healed, false, 'not healed');
    assertEqual(result.reason, 'ALREADY_HEALTHY', 'reason = ALREADY_HEALTHY');
}

// 10. healKey — BROKEN, no candidates → incrementHealAttempt
console.log('10. healKey — BROKEN, no candidates');
{
    const { rm, hm } = freshSetup();
    rm.set('P.el', { locator: 'old', tier: 2, success_rate: 0.20 });
    writeScout('P', []);
    const result = hm.healKey('P.el');
    assertEqual(result.healed, false, 'not healed');
    assertEqual(result.reason, 'NO_CANDIDATES', 'reason = NO_CANDIDATES');
    assertEqual(rm.get('P.el').heal_attempts, 1, 'heal_attempts incremented');
}

// 11. healKey — BROKEN, successful heal
console.log('11. healKey — BROKEN → successful heal');
{
    const { rm, hm } = freshSetup();
    rm.set('Login.btn', { locator: 'old-btn', tier: 2, success_rate: 0.20 });
    writeScout('Login', [
        {
            key: 'Login.login',
            role: 'button',
            label: 'Login',
            tier_suggestion: 1,
            locator_suggestion: "page.getByRole('button', { name: 'Login' })",
            disabled: false,
            source: 'a11y',
        },
    ]);

    const result = hm.healKey('Login.btn');
    assertEqual(result.healed, true, 'healed successfully');
    assertEqual(result.applied.locator, "page.getByRole('button', { name: 'Login' })", 'new locator applied');
    assertEqual(result.applied.tier, 1, 'tier 1 applied');
    assertEqual(result.applied.source, 'scout-generated', 'source = scout-generated');
    assertEqual(result.new_state, 'HEALTHY', 'new state is HEALTHY');

    const record = rm.get('Login.btn');
    assertEqual(record.locator, "page.getByRole('button', { name: 'Login' })", 'registry updated');
    assertEqual(record.heal_version, 1, 'heal_version bumped');
    assertEqual(record.heal_attempts, 1, 'heal_attempts = 1');
}

// 12. healKey — dom-only source tagging
console.log('12. healKey — dom-only source tagging');
{
    const { rm, hm } = freshSetup();
    rm.set('Login.btn', { locator: 'old', tier: 2, success_rate: 0.10 });
    writeScout('Login', [
        {
            key: 'Login.loginButton',
            role: null,
            label: null,
            tier_suggestion: 2,
            locator_suggestion: "page.locator('[data-test=\"login-button\"]')",
            disabled: false,
            source: 'dom',
        },
    ]);

    const result = hm.healKey('Login.btn');
    assertEqual(result.applied.source, 'agent-generated', 'dom-only → agent-generated');
}

// 13. Full lifecycle: HEALTHY → BROKEN → heal → BROKEN again → heal again → QUARANTINE
console.log('13. Full heal lifecycle → QUARANTINE');
{
    const { rm, hm } = freshSetup();
    rm.set('Login.btn', { locator: 'loc-v0', tier: 2 });

    writeScout('Login', [
        {
            key: 'Login.login',
            role: 'button',
            label: 'Login',
            tier_suggestion: 1,
            locator_suggestion: "page.getByRole('button', { name: 'Login' })",
            disabled: false,
            source: 'a11y',
        },
        {
            key: 'Login.loginButton',
            role: null,
            label: null,
            tier_suggestion: 2,
            locator_suggestion: "page.locator('[data-test=\"login-button\"]')",
            disabled: false,
            source: 'dom',
        },
    ]);

    // Break it
    rm.recordFailure('Login.btn');
    assertEqual(rm.resolveState('Login.btn').registry_state, 'BROKEN', 'starts BROKEN');

    // Heal #1 — should pick tier 1
    const heal1 = hm.healKey('Login.btn');
    assertEqual(heal1.healed, true, 'heal #1 succeeds');
    assertEqual(heal1.applied.tier, 1, 'heal #1 tier 1');
    assertEqual(rm.get('Login.btn').heal_attempts, 1, 'attempts = 1');

    // Break again
    rm.recordFailure('Login.btn');
    assertEqual(rm.resolveState('Login.btn').registry_state, 'BROKEN', 'BROKEN again');

    // Heal #2 — should succeed but quarantine immediately
    hm.healKey('Login.btn');
    // heal_attempts goes to 2 → incrementHealAttempt first → QUARANTINE
    // But the code increments THEN applies heal, so state after applyHeal recomputes
    // heal_attempts = 2 → QUARANTINE regardless of success_rate
    assertEqual(rm.get('Login.btn').heal_attempts, 2, 'attempts = 2');
    assertEqual(rm.resolveState('Login.btn').registry_state, 'QUARANTINE', 'now QUARANTINE');

    // Subsequent heal attempt blocked
    const heal3 = hm.healKey('Login.btn');
    assertEqual(heal3.healed, false, 'heal #3 blocked');
    assertEqual(heal3.reason, 'QUARANTINE', 'blocked by QUARANTINE');
}

// 14. healAllBroken — processes multiple keys
console.log('14. healAllBroken');
{
    const { rm, hm } = freshSetup();
    rm.set('Login.a', { locator: 'old-a', tier: 2, success_rate: 0.10 });
    rm.set('Login.b', { locator: 'old-b', tier: 2, success_rate: 0.30 });
    rm.set('Login.c', { locator: 'ok', tier: 1, success_rate: 1.0 });

    writeScout('Login', [
        {
            key: 'Login.aButton',
            role: 'button',
            label: 'A',
            tier_suggestion: 1,
            locator_suggestion: "page.getByRole('button', { name: 'A' })",
            disabled: false,
            source: 'a11y',
        },
    ]);

    const results = hm.healAllBroken();
    assertEqual(results.length, 2, '2 broken keys processed');
    // At least one should have healed (Login.a has a candidate from scout)
    assert(results.some(r => r.healed), 'at least one healed');
}

// 15. getHealthReport
console.log('15. getHealthReport');
{
    const { rm, hm } = freshSetup();
    rm.set('P.h1', { locator: 'l', tier: 1, success_rate: 1.0 });
    rm.set('P.h2', { locator: 'l', tier: 1, success_rate: 0.90 });
    rm.set('P.d', { locator: 'l', tier: 1, success_rate: 0.60 });
    rm.set('P.b', { locator: 'l', tier: 1, success_rate: 0.20 });
    rm.set('P.q', { locator: 'l', tier: 1, success_rate: 0.10, heal_attempts: 3 });

    const report = hm.getHealthReport();
    assertEqual(report.total, 5, 'total = 5');
    assertEqual(report.healthy, 2, 'healthy = 2');
    assertEqual(report.degraded, 1, 'degraded = 1');
    assertEqual(report.broken, 1, 'broken = 1');
    assertEqual(report.quarantined, 1, 'quarantined = 1');
    assert(report.details['P.h1'].registry_state === 'HEALTHY', 'detail for P.h1');
    assert(report.details['P.q'].registry_state === 'QUARANTINE', 'detail for P.q');
}

// 16. Scoring — exact key match preferred over partial
console.log('16. Scoring — exact name match scores highest');
{
    const { rm, hm } = freshSetup();
    rm.set('Login.loginButton', { locator: 'old', tier: 2, success_rate: 0.10 });
    writeScout('Login', [
        {
            key: 'Login.loginButton',
            role: 'button',
            label: 'Login',
            tier_suggestion: 2,
            locator_suggestion: "page.locator('[data-test=\"login-button\"]')",
            disabled: false,
            source: 'dom',
        },
        {
            key: 'Login.submitButton',
            role: 'button',
            label: 'Submit',
            tier_suggestion: 1,
            locator_suggestion: "page.getByRole('button', { name: 'Submit' })",
            disabled: false,
            source: 'a11y',
        },
    ]);

    const result = hm.findCandidates('Login.loginButton');
    // Both should be candidates but loginButton should rank higher within same tier consideration
    assert(result.candidates.length >= 1, 'at least 1 candidate');
    // Exact match (key=Login.loginButton) has +10 score vs Submit having +0 name match
    // But tier 1 sorts before tier 2 — so Submit (tier 1) comes first in sort
    // This is correct: tier priority > name match
    assertEqual(result.candidates[0].tier, 1, 'tier 1 preferred despite name mismatch');
}

// 17. healKey — DEGRADED elements can be healed
console.log('17. healKey — DEGRADED can be healed');
{
    const { rm, hm } = freshSetup();
    rm.set('Login.btn', { locator: 'degraded-loc', tier: 2, success_rate: 0.60 });
    writeScout('Login', [
        {
            key: 'Login.login',
            role: 'button',
            label: 'Login',
            tier_suggestion: 1,
            locator_suggestion: "page.getByRole('button', { name: 'Login' })",
            disabled: false,
            source: 'a11y',
        },
    ]);

    const result = hm.healKey('Login.btn');
    assertEqual(result.healed, true, 'DEGRADED healed');
    assertEqual(result.applied.tier, 1, 'upgraded to tier 1');
}

// ── Results ──
cleanup();
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
