'use strict';

const fs = require('fs');
const path = require('path');
const { RegistryManager } = require('../src/registry/registry-manager');

const TMP_DIR = path.resolve(__dirname, '../.tmp-merge-test');
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

console.log('\n=== mergeAndSave Test Suite ===\n');

// 1. mergeAndSave on empty disk — writes in-memory data
console.log('1. mergeAndSave — empty disk writes memory data');
{
    const rm = freshManager();
    rm.set('A.one', { locator: 'loc1', tier: 1 });
    rm.recordSuccess('A.one');
    rm.mergeAndSave();

    const rm2 = new RegistryManager(TMP_REGISTRY).load();
    assert(rm2.has('A.one'), 'key persisted');
    assertEqual(rm2.get('A.one').total_runs, 1, 'total_runs persisted');
    assertEqual(rm2.get('A.one').successful_runs, 1, 'successful_runs persisted');
}

// 2. mergeAndSave preserves disk-only keys
console.log('2. mergeAndSave — disk-only keys preserved');
{
    cleanup();
    fs.mkdirSync(TMP_DIR, { recursive: true });
    const seed = {
        version: '1.0.0',
        selectors: {
            'Disk.only': {
                locator: 'disk-loc', tier: 1, state: 'HEALTHY',
                success_rate: 1.0, total_runs: 5, successful_runs: 5,
                heal_attempts: 0, heal_version: 0,
                last_seen: '2026-01-01T00:00:00Z', source_file: 'src/elements/Disk.elements.js',
            },
        },
    };
    fs.writeFileSync(TMP_REGISTRY, JSON.stringify(seed), 'utf8');

    const rm = new RegistryManager(TMP_REGISTRY).load();
    rm.set('Memory.only', { locator: 'mem-loc', tier: 2 });
    rm.mergeAndSave();

    const rm2 = new RegistryManager(TMP_REGISTRY).load();
    assert(rm2.has('Disk.only'), 'disk-only key preserved');
    assert(rm2.has('Memory.only'), 'memory-only key added');
    assertEqual(rm2.get('Disk.only').total_runs, 5, 'disk-only runs preserved');
}

// 3. mergeAndSave — conflict resolution: higher total_runs wins
console.log('3. mergeAndSave — higher total_runs wins conflict');
{
    cleanup();
    fs.mkdirSync(TMP_DIR, { recursive: true });

    // Disk has 10 runs
    const seed = {
        version: '1.0.0',
        selectors: {
            'Login.btn': {
                locator: 'disk-btn', tier: 1, state: 'HEALTHY',
                success_rate: 0.9, total_runs: 10, successful_runs: 9,
                heal_attempts: 0, heal_version: 0,
                last_seen: '2026-01-01T00:00:00Z', source_file: 'src/elements/Login.elements.js',
            },
        },
    };
    fs.writeFileSync(TMP_REGISTRY, JSON.stringify(seed), 'utf8');

    // Memory has 3 runs (started from earlier snapshot)
    const rm = new RegistryManager(TMP_REGISTRY).load();
    // Simulate: this worker loaded at 0 runs, did 3 interactions
    rm.data.selectors['Login.btn'].total_runs = 3;
    rm.data.selectors['Login.btn'].successful_runs = 3;
    rm.data.selectors['Login.btn'].success_rate = 1.0;
    rm.data.selectors['Login.btn'].locator = 'memory-btn';

    // Now disk was updated by another worker to 10 runs since we loaded
    fs.writeFileSync(TMP_REGISTRY, JSON.stringify(seed), 'utf8');

    rm.mergeAndSave();

    const result = new RegistryManager(TMP_REGISTRY).load();
    assertEqual(result.get('Login.btn').total_runs, 10, 'disk version with 10 runs wins');
    assertEqual(result.get('Login.btn').locator, 'disk-btn', 'disk locator preserved');
}

// 4. mergeAndSave — conflict resolution: equal total_runs, most recent wins
console.log('4. mergeAndSave — equal runs, most recent last_seen wins');
{
    cleanup();
    fs.mkdirSync(TMP_DIR, { recursive: true });

    const seed = {
        version: '1.0.0',
        selectors: {
            'Login.btn': {
                locator: 'old-btn', tier: 1, state: 'HEALTHY',
                success_rate: 1.0, total_runs: 5, successful_runs: 5,
                heal_attempts: 0, heal_version: 0,
                last_seen: '2026-01-01T00:00:00Z', source_file: 'src/elements/Login.elements.js',
            },
        },
    };
    fs.writeFileSync(TMP_REGISTRY, JSON.stringify(seed), 'utf8');

    const rm = new RegistryManager(TMP_REGISTRY).load();
    rm.data.selectors['Login.btn'].last_seen = '2026-06-01T00:00:00Z';
    rm.data.selectors['Login.btn'].locator = 'new-btn';
    rm.mergeAndSave();

    const result = new RegistryManager(TMP_REGISTRY).load();
    assertEqual(result.get('Login.btn').locator, 'new-btn', 'more recent last_seen wins');
}

// 5. Two independent workers writing — both keys survive
console.log('5. Simulated two-worker merge — both keys survive');
{
    cleanup();
    fs.mkdirSync(TMP_DIR, { recursive: true });

    // Worker A writes first
    const workerA = new RegistryManager(TMP_REGISTRY).load();
    workerA.set('A.elem', { locator: 'a-loc', tier: 1 });
    workerA.recordSuccess('A.elem');
    workerA.mergeAndSave();

    // Worker B loaded the same initial empty state, but adds a different key
    const workerB = new RegistryManager(TMP_REGISTRY);
    workerB.data = { version: '1.0.0', selectors: {} }; // simulate stale load
    workerB.set('B.elem', { locator: 'b-loc', tier: 2 });
    workerB.recordSuccess('B.elem');
    workerB.mergeAndSave();

    const result = new RegistryManager(TMP_REGISTRY).load();
    assert(result.has('A.elem'), 'worker A key survived worker B merge');
    assert(result.has('B.elem'), 'worker B key also present');
    assertEqual(result.get('A.elem').total_runs, 1, 'worker A runs intact');
    assertEqual(result.get('B.elem').total_runs, 1, 'worker B runs intact');
}

// 6. mergeAndSave with corrupted disk file — treats as empty
console.log('6. mergeAndSave — corrupted disk file treated as empty');
{
    cleanup();
    fs.mkdirSync(TMP_DIR, { recursive: true });
    fs.writeFileSync(TMP_REGISTRY, '{{{invalid json', 'utf8');

    const rm = new RegistryManager(TMP_REGISTRY);
    rm.data = { version: '1.0.0', selectors: {} };
    rm.set('Safe.elem', { locator: 'safe', tier: 1 });
    rm.mergeAndSave();

    const result = new RegistryManager(TMP_REGISTRY).load();
    assert(result.has('Safe.elem'), 'data written despite corrupted disk');
}

// 7. Lockfile cleanup — stale lock doesn't block
console.log('7. Stale lockfile cleanup');
{
    cleanup();
    fs.mkdirSync(TMP_DIR, { recursive: true });
    const lockPath = TMP_REGISTRY + '.lock';
    // Create a stale lockfile with old timestamp
    fs.writeFileSync(lockPath, '99999', 'utf8');
    // Backdate it to 20 seconds ago
    const oldTime = new Date(Date.now() - 20000);
    fs.utimesSync(lockPath, oldTime, oldTime);

    const rm = new RegistryManager(TMP_REGISTRY).load();
    rm.set('After.stale', { locator: 'loc', tier: 1 });

    let didNotThrow = true;
    try {
        rm.mergeAndSave();
    } catch (e) {
        didNotThrow = false;
    }
    assert(didNotThrow, 'mergeAndSave succeeds after stale lock cleanup');

    const result = new RegistryManager(TMP_REGISTRY).load();
    assert(result.has('After.stale'), 'data written after stale lock');
    assert(!fs.existsSync(lockPath), 'lockfile released after merge');
}

// ── Results ──
cleanup();
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
