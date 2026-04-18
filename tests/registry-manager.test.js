const fs = require('fs');
const path = require('path');
const { RegistryManager } = require('../src/registry/registry-manager');

const TMP_DIR = path.resolve(__dirname, '../.tmp-test');
const TMP_REGISTRY = path.join(TMP_DIR, 'registry.json');

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

function freshManager() {
    cleanup();
    return new RegistryManager(TMP_REGISTRY).load();
}

// ── Test Suite ──

console.log('\n=== RegistryManager Test Suite ===\n');

// 1. Load creates empty registry when file missing
console.log('1. Load — missing file creates empty registry');
{
    cleanup();
    const rm = new RegistryManager(TMP_REGISTRY).load();
    assertEqual(rm.data.version, '1.0.0', 'version defaults to 1.0.0');
    assertEqual(Object.keys(rm.data.selectors).length, 0, 'selectors empty');
}

// 2. Load handles legacy empty JSON ({})
console.log('2. Load — legacy empty JSON normalized');
{
    cleanup();
    fs.mkdirSync(TMP_DIR, { recursive: true });
    fs.writeFileSync(TMP_REGISTRY, '{}', 'utf8');
    const rm = new RegistryManager(TMP_REGISTRY).load();
    assertEqual(rm.data.version, '1.0.0', 'version added');
    assert(rm.data.selectors !== undefined, 'selectors added');
}

// 3. Load reads existing well-formed registry
console.log('3. Load — reads existing well-formed registry');
{
    cleanup();
    fs.mkdirSync(TMP_DIR, { recursive: true });
    const seed = {
        version: '1.0.0',
        selectors: {
            'Login.usernameInput': {
                locator: "page.locator('[data-test=\"username\"]')",
                tier: 2,
                state: 'HEALTHY',
                success_rate: 1.0,
                total_runs: 0,
                successful_runs: 0,
                heal_attempts: 0,
                last_seen: null,
                source_file: 'src/elements/Login.elements.js',
            },
        },
    };
    fs.writeFileSync(TMP_REGISTRY, JSON.stringify(seed), 'utf8');
    const rm = new RegistryManager(TMP_REGISTRY).load();
    assert(rm.has('Login.usernameInput'), 'selector loaded');
    assertEqual(rm.get('Login.usernameInput').tier, 2, 'tier preserved');
}

// 4. Save + reload roundtrip
console.log('4. Save + reload roundtrip');
{
    const rm = freshManager();
    rm.set('Test.elem', { locator: "page.locator('#x')", tier: 3 });
    rm.save();
    const rm2 = new RegistryManager(TMP_REGISTRY).load();
    assert(rm2.has('Test.elem'), 'element persisted');
    assertEqual(rm2.get('Test.elem').locator, "page.locator('#x')", 'locator roundtripped');
}

// 5. CRUD — set, get, has, delete, keys, getAll
console.log('5. CRUD operations');
{
    const rm = freshManager();
    rm.set('A.one', { locator: 'loc1', tier: 1 });
    rm.set('A.two', { locator: 'loc2', tier: 2 });
    assert(rm.has('A.one'), 'has A.one');
    assert(!rm.has('A.three'), 'does not have A.three');
    assertEqual(rm.keys().length, 2, '2 keys');
    assertEqual(Object.keys(rm.getAll()).length, 2, 'getAll returns 2');

    rm.delete('A.one');
    assert(!rm.has('A.one'), 'A.one deleted');
    assertEqual(rm.keys().length, 1, '1 key remaining');
}

// 6. set() applies defaults
console.log('6. set() applies defaults');
{
    const rm = freshManager();
    rm.set('P.el', { locator: 'loc', tier: 1 });
    const rec = rm.get('P.el');
    assertEqual(rec.success_rate, 1.0, 'default success_rate');
    assertEqual(rec.total_runs, 0, 'default total_runs');
    assertEqual(rec.successful_runs, 0, 'default successful_runs');
    assertEqual(rec.heal_attempts, 0, 'default heal_attempts');
    assertEqual(rec.heal_version, 0, 'default heal_version');
    assertEqual(rec.state, 'HEALTHY', 'default state');
    assert(rec.last_seen !== null, 'last_seen set on create');
}

// 7. recordSuccess — single success
console.log('7. recordSuccess');
{
    const rm = freshManager();
    rm.set('P.el', { locator: 'loc', tier: 1 });
    rm.recordSuccess('P.el');
    const rec = rm.get('P.el');
    assertEqual(rec.total_runs, 1, 'total_runs = 1');
    assertEqual(rec.successful_runs, 1, 'successful_runs = 1');
    assertEqual(rec.success_rate, 1.0, 'success_rate = 1.0');
    assertEqual(rec.state, 'HEALTHY', 'state = HEALTHY');
}

// 8. recordFailure — single failure from fresh → BROKEN
console.log('8. recordFailure — fresh selector, one failure → BROKEN');
{
    const rm = freshManager();
    rm.set('P.el', { locator: 'loc', tier: 1 });
    rm.recordFailure('P.el');
    const rec = rm.get('P.el');
    assertEqual(rec.total_runs, 1, 'total_runs = 1');
    assertEqual(rec.successful_runs, 0, 'successful_runs = 0');
    assertEqual(rec.success_rate, 0, 'success_rate = 0');
    assertEqual(rec.state, 'BROKEN', 'state = BROKEN');
}

// 9. State transitions: HEALTHY → DEGRADED → BROKEN
console.log('9. State transitions: HEALTHY → DEGRADED → BROKEN');
{
    const rm = freshManager();
    rm.set('P.el', { locator: 'loc', tier: 1 });

    // 10 successes → HEALTHY
    for (let i = 0; i < 10; i++) rm.recordSuccess('P.el');
    assertEqual(rm.get('P.el').state, 'HEALTHY', 'after 10/10 = HEALTHY');
    assertEqual(rm.get('P.el').success_rate, 1.0, 'rate = 1.0');

    // 2 failures → 10/12 = 0.833 → DEGRADED
    rm.recordFailure('P.el');
    rm.recordFailure('P.el');
    const rate1 = rm.get('P.el').success_rate;
    assert(Math.abs(rate1 - 10 / 12) < 0.001, `rate ~0.833 (got ${rate1})`);
    assertEqual(rm.get('P.el').state, 'DEGRADED', 'DEGRADED at ~0.833');

    // 6 more failures → 10/18 = 0.556 → still DEGRADED
    for (let i = 0; i < 6; i++) rm.recordFailure('P.el');
    const rate2 = rm.get('P.el').success_rate;
    assert(Math.abs(rate2 - 10 / 18) < 0.001, `rate ~0.556 (got ${rate2})`);
    assertEqual(rm.get('P.el').state, 'DEGRADED', 'DEGRADED at ~0.556');

    // 2 more failures → 10/20 = 0.50 → exact boundary → DEGRADED (>= 0.50)
    rm.recordFailure('P.el');
    rm.recordFailure('P.el');
    const rate3 = rm.get('P.el').success_rate;
    assertEqual(rate3, 0.5, 'rate = 0.50 exact');
    assertEqual(rm.get('P.el').state, 'DEGRADED', 'DEGRADED at exactly 0.50');

    // 1 more failure → 10/21 = 0.476 → BROKEN
    rm.recordFailure('P.el');
    const rate4 = rm.get('P.el').success_rate;
    assert(rate4 < 0.50, `rate < 0.50 (got ${rate4})`);
    assertEqual(rm.get('P.el').state, 'BROKEN', 'BROKEN below 0.50');
}

// 10. resolveState — all five states
console.log('10. resolveState — all five registry states');
{
    const rm = freshManager();

    // NONE — nonexistent key
    assertEqual(rm.resolveState('X.nope').registry_state, 'NONE', 'NONE for missing key');
    assertEqual(rm.resolveState('X.nope').resolved_selector, null, 'NONE selector is null');

    // HEALTHY
    rm.set('P.h', { locator: 'h-loc', tier: 1, heal_version: 1 });
    const healthy = rm.resolveState('P.h');
    assertEqual(healthy.registry_state, 'HEALTHY', 'HEALTHY state');
    assertEqual(healthy.resolved_selector, 'h-loc', 'HEALTHY returns locator');
    assertEqual(healthy.heal_version, 1, 'HEALTHY includes heal_version');

    // DEGRADED — success_rate = 0.70
    rm.set('P.d', { locator: 'd-loc', tier: 2, success_rate: 0.70 });
    const degraded = rm.resolveState('P.d');
    assertEqual(degraded.registry_state, 'DEGRADED', 'DEGRADED state');
    assertEqual(degraded.resolved_selector, 'd-loc', 'DEGRADED returns locator');

    // BROKEN — success_rate = 0.20
    rm.set('P.b', { locator: 'b-loc', tier: 2, success_rate: 0.20 });
    const broken = rm.resolveState('P.b');
    assertEqual(broken.registry_state, 'BROKEN', 'BROKEN state');
    assertEqual(broken.resolved_selector, null, 'BROKEN selector is null');

    // QUARANTINE — heal_attempts >= 2 overrides success_rate
    rm.set('P.q', { locator: 'q-loc', tier: 1, success_rate: 1.0, heal_attempts: 2 });
    const quarantine = rm.resolveState('P.q');
    assertEqual(quarantine.registry_state, 'QUARANTINE', 'QUARANTINE state');
    assertEqual(quarantine.resolved_selector, null, 'QUARANTINE selector is null');
}

// 11. resolveStates — batch resolution
console.log('11. resolveStates — batch');
{
    const rm = freshManager();
    rm.set('A.x', { locator: 'lx', tier: 1 });
    rm.set('A.y', { locator: 'ly', tier: 2, success_rate: 0.30 });
    const states = rm.resolveStates(['A.x', 'A.y', 'A.z']);
    assertEqual(states['A.x'].registry_state, 'HEALTHY', 'batch HEALTHY');
    assertEqual(states['A.y'].registry_state, 'BROKEN', 'batch BROKEN');
    assertEqual(states['A.z'].registry_state, 'NONE', 'batch NONE');
}

// 12. Heal cycle: BROKEN → incrementHealAttempt → applyHeal → HEALTHY → break again → QUARANTINE
console.log('12. Full heal lifecycle → QUARANTINE after 2 attempts');
{
    const rm = freshManager();
    rm.set('P.el', { locator: 'old', tier: 2 });

    // Simulate breakage
    rm.recordFailure('P.el');
    assertEqual(rm.get('P.el').state, 'BROKEN', 'broken after failure');

    // Heal attempt #1
    rm.incrementHealAttempt('P.el');
    assertEqual(rm.get('P.el').heal_attempts, 1, 'heal_attempts = 1');
    // Still treatable (< 2)
    assert(rm.get('P.el').state !== 'QUARANTINE', 'not quarantined at 1');

    // Apply heal
    rm.applyHeal('P.el', { locator: 'new1', tier: 1, source: 'scout-generated' });
    const afterHeal1 = rm.get('P.el');
    assertEqual(afterHeal1.locator, 'new1', 'locator updated');
    assertEqual(afterHeal1.tier, 1, 'tier updated');
    assertEqual(afterHeal1.heal_version, 1, 'heal_version = 1');
    assertEqual(afterHeal1.success_rate, 1.0, 'success_rate reset');
    assertEqual(afterHeal1.total_runs, 0, 'total_runs reset');
    // heal_attempts stays at 1 (not reset)
    assertEqual(afterHeal1.heal_attempts, 1, 'heal_attempts NOT reset');
    assertEqual(afterHeal1.last_heal_source, 'scout-generated', 'source tracked');

    // Break again
    rm.recordFailure('P.el');
    assertEqual(rm.get('P.el').state, 'BROKEN', 'broken again');

    // Heal attempt #2
    rm.incrementHealAttempt('P.el');
    assertEqual(rm.get('P.el').heal_attempts, 2, 'heal_attempts = 2');
    assertEqual(rm.get('P.el').state, 'QUARANTINE', 'QUARANTINE after 2 attempts');

    // resolveState confirms QUARANTINE
    const resolved = rm.resolveState('P.el');
    assertEqual(resolved.registry_state, 'QUARANTINE', 'resolveState = QUARANTINE');
    assertEqual(resolved.resolved_selector, null, 'QUARANTINE selector null');
}

// 13. applyRegistryUpdates — new + existing elements
console.log('13. applyRegistryUpdates — agent envelope processing');
{
    const rm = freshManager();
    rm.set('Login.btn', { locator: 'old-btn', tier: 2 });

    const updates = [
        { page: 'Login', element: 'btn', selector: 'new-btn', tier: 1, source: 'registry-healed' },
        { page: 'Inventory', element: 'title', selector: 'inv-title', tier: 1, source: 'scout-generated' },
    ];
    rm.applyRegistryUpdates(updates);

    // Existing updated via applyHeal
    const btn = rm.get('Login.btn');
    assertEqual(btn.locator, 'new-btn', 'existing locator updated');
    assertEqual(btn.tier, 1, 'existing tier updated');
    assertEqual(btn.heal_version, 1, 'heal_version bumped');

    // New element created
    assert(rm.has('Inventory.title'), 'new element created');
    const title = rm.get('Inventory.title');
    assertEqual(title.locator, 'inv-title', 'new locator set');
    assertEqual(title.source_file, 'src/elements/Inventory.elements.js', 'source_file inferred');
}

// 14. _ensureLoaded guard
console.log('14. _ensureLoaded guard — throws before load()');
{
    const rm = new RegistryManager(TMP_REGISTRY);
    let threw = false;
    try {
        rm.get('X.y');
    } catch (e) {
        threw = e.message.includes('not loaded');
    }
    assert(threw, 'throws before load()');
}

// 15. Error on missing key for record/heal operations
console.log('15. Missing key errors');
{
    const rm = freshManager();
    let threw1 = false;
    try { rm.recordSuccess('X.missing'); } catch { threw1 = true; }
    assert(threw1, 'recordSuccess throws for missing key');

    let threw2 = false;
    try { rm.recordFailure('X.missing'); } catch { threw2 = true; }
    assert(threw2, 'recordFailure throws for missing key');

    let threw3 = false;
    try { rm.incrementHealAttempt('X.missing'); } catch { threw3 = true; }
    assert(threw3, 'incrementHealAttempt throws for missing key');

    let threw4 = false;
    try { rm.applyHeal('X.missing', { locator: 'x', tier: 1, source: 'x' }); } catch { threw4 = true; }
    assert(threw4, 'applyHeal throws for missing key');
}

// 16. Boundary: success_rate = 0.85 exactly → HEALTHY
console.log('16. Boundary tests for state thresholds');
{
    const rm = freshManager();
    rm.set('P.exact85', { locator: 'l', tier: 1, success_rate: 0.85 });
    assertEqual(rm.resolveState('P.exact85').registry_state, 'HEALTHY', '0.85 = HEALTHY boundary');

    rm.set('P.exact50', { locator: 'l', tier: 1, success_rate: 0.50 });
    assertEqual(rm.resolveState('P.exact50').registry_state, 'DEGRADED', '0.50 = DEGRADED boundary');

    rm.set('P.below50', { locator: 'l', tier: 1, success_rate: 0.49 });
    assertEqual(rm.resolveState('P.below50').registry_state, 'BROKEN', '0.49 = BROKEN');

    rm.set('P.quarantineOverride', { locator: 'l', tier: 1, success_rate: 1.0, heal_attempts: 3 });
    assertEqual(rm.resolveState('P.quarantineOverride').registry_state, 'QUARANTINE', 'QUARANTINE overrides HEALTHY');
}

// 17. applyRegistryUpdates with empty/null array
console.log('17. applyRegistryUpdates — edge cases');
{
    const rm = freshManager();
    rm.applyRegistryUpdates([]);
    assertEqual(rm.keys().length, 0, 'empty array is no-op');
    rm.applyRegistryUpdates(null);
    assertEqual(rm.keys().length, 0, 'null is no-op');
}

// ── Results ──
cleanup();
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
