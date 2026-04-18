const fs = require('fs');
const path = require('path');

const DEFAULT_REGISTRY_PATH = path.resolve(__dirname, '../../.agent/registry.json');

const STATE_THRESHOLDS = {
    HEALTHY: 0.85,
    DEGRADED: 0.50,
    QUARANTINE_HEAL_ATTEMPTS: 2,
};

class RegistryManager {
    constructor(registryPath = DEFAULT_REGISTRY_PATH) {
        this.registryPath = registryPath;
        this.data = null;
    }

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

    // ── Parallel-safe merge-and-save ─────────────────────────────────────────
    // Acquires an exclusive lockfile, re-reads disk state (other workers may
    // have written since this worker loaded), merges per-key by higher
    // total_runs, writes back atomically, and releases the lock.

    mergeAndSave() {
        const lockPath = this.registryPath + '.lock';
        let acquired = false;

        try {
            acquired = this._acquireLock(lockPath);

            // Re-read disk state inside the lock
            let diskData = { version: '1.0.0', selectors: {} };
            if (fs.existsSync(this.registryPath)) {
                try {
                    diskData = JSON.parse(fs.readFileSync(this.registryPath, 'utf8'));
                    if (!diskData.selectors) diskData.selectors = {};
                } catch (_) {
                    // Corrupted file — treat as empty
                }
            }

            // Merge: for each key, keep the record with more data
            const merged = { version: this.data.version || '1.0.0', selectors: {} };

            const allKeys = new Set([
                ...Object.keys(diskData.selectors),
                ...Object.keys(this.data.selectors),
            ]);

            for (const key of allKeys) {
                const diskRec = diskData.selectors[key];
                const memRec = this.data.selectors[key];

                if (diskRec && memRec) {
                    merged.selectors[key] = this._pickWinner(diskRec, memRec);
                } else {
                    merged.selectors[key] = memRec || diskRec;
                }
            }

            // Atomic write
            this.data = merged;
            const dir = path.dirname(this.registryPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            const tmpPath = this.registryPath + '.tmp';
            fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), 'utf8');
            fs.renameSync(tmpPath, this.registryPath);
        } finally {
            if (acquired) this._releaseLock(lockPath);
        }

        return this;
    }

    _acquireLock(lockPath) {
        const MAX_ATTEMPTS = 20;
        const STALE_MS = 10000;
        // Linear backoff: 25ms × attempt (0, 25, 50, ... 475ms)
        // Max total wait: sum(0..19) × 25ms = 190 × 25ms ≈ 4.75s + jitter ≈ 5.25s ceiling
        const BACKOFF_BASE_MS = 25;

        // Stale lock guard — if lockfile is older than 10s, a worker crashed
        try {
            if (fs.existsSync(lockPath)) {
                const stat = fs.statSync(lockPath);
                if (Date.now() - stat.mtimeMs > STALE_MS) {
                    fs.unlinkSync(lockPath);
                }
            }
        } catch (_) {
            // Best-effort stale cleanup
        }

        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            try {
                fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
                return true;
            } catch (_) {
                // Lock held by another worker — busy-wait with linear backoff
                // Attempt 0: ~0ms, attempt 1: ~25ms, ..., attempt 19: ~475ms
                const waitMs = BACKOFF_BASE_MS * attempt * (1 + Math.random() * 0.5);
                const start = Date.now();
                while (Date.now() - start < waitMs) {
                    // synchronous sleep — required for lockfile protocol
                }
            }
        }

        // Could not acquire lock after ~5.25s — fall back to plain save to avoid data loss
        this.save();
        return false;
    }

    _releaseLock(lockPath) {
        try {
            fs.unlinkSync(lockPath);
        } catch (_) {
            // Best-effort cleanup
        }
    }

    _pickWinner(diskRec, memRec) {
        // Higher total_runs = more data = more accurate
        if ((memRec.total_runs || 0) > (diskRec.total_runs || 0)) return memRec;
        if ((diskRec.total_runs || 0) > (memRec.total_runs || 0)) return diskRec;
        // Equal total_runs — prefer most recent
        const diskTime = diskRec.last_seen ? new Date(diskRec.last_seen).getTime() : 0;
        const memTime = memRec.last_seen ? new Date(memRec.last_seen).getTime() : 0;
        return memTime >= diskTime ? memRec : diskRec;
    }


    _ensureLoaded() {
        if (!this.data) {
            throw new Error('Registry not loaded. Call load() first.');
        }
    }

    get(key) {
        this._ensureLoaded();
        return this.data.selectors[key] || null;
    }

    set(key, record) {
        this._ensureLoaded();
        this.data.selectors[key] = {
            ...this._createDefaults(),
            ...record,
            last_seen: new Date().toISOString(),
        };
        return this;
    }

    delete(key) {
        this._ensureLoaded();
        delete this.data.selectors[key];
        return this;
    }

    has(key) {
        this._ensureLoaded();
        return key in this.data.selectors;
    }

    keys() {
        this._ensureLoaded();
        return Object.keys(this.data.selectors);
    }

    getAll() {
        this._ensureLoaded();
        return { ...this.data.selectors };
    }

    recordSuccess(key) {
        this._ensureLoaded();
        const record = this.data.selectors[key];
        if (!record) throw new Error(`Selector not found: ${key}`);
        record.total_runs++;
        record.successful_runs++;
        record.success_rate = record.successful_runs / record.total_runs;
        record.last_seen = new Date().toISOString();
        record.state = this._calculateState(record);
        return this;
    }

    recordFailure(key) {
        this._ensureLoaded();
        const record = this.data.selectors[key];
        if (!record) throw new Error(`Selector not found: ${key}`);
        record.total_runs++;
        record.success_rate = record.total_runs > 0
            ? record.successful_runs / record.total_runs
            : 0;
        record.last_seen = new Date().toISOString();
        record.state = this._calculateState(record);
        return this;
    }

    resolveState(key) {
        this._ensureLoaded();
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

    resolveStates(keys) {
        return keys.reduce((acc, key) => {
            acc[key] = this.resolveState(key);
            return acc;
        }, {});
    }

    incrementHealAttempt(key) {
        this._ensureLoaded();
        const record = this.data.selectors[key];
        if (!record) throw new Error(`Selector not found: ${key}`);
        record.heal_attempts++;
        record.state = this._calculateState(record);
        return this;
    }

    applyHeal(key, { locator, tier, source }) {
        this._ensureLoaded();
        const record = this.data.selectors[key];
        if (!record) throw new Error(`Selector not found: ${key}`);
        record.locator = locator;
        record.tier = tier;
        record.total_runs = 0;
        record.successful_runs = 0;
        record.success_rate = 1.0;
        record.last_seen = new Date().toISOString();
        record.heal_version = (record.heal_version || 0) + 1;
        record.last_heal_source = source;
        record.state = this._calculateState(record);
        return this;
    }

    applyRegistryUpdates(updates) {
        this._ensureLoaded();
        if (!Array.isArray(updates)) return this;

        for (const update of updates) {
            const key = `${update.page}.${update.element}`;
            if (this.has(key)) {
                this.applyHeal(key, {
                    locator: update.selector,
                    tier: update.tier,
                    source: update.source,
                });
            } else {
                this.set(key, {
                    locator: update.selector,
                    tier: update.tier,
                    state: 'HEALTHY',
                    success_rate: 1.0,
                    source_file: `src/elements/${update.page}.elements.js`,
                    heal_version: 0,
                    last_heal_source: update.source,
                });
            }
        }
        return this;
    }

    _calculateState(record) {
        if (record.heal_attempts >= STATE_THRESHOLDS.QUARANTINE_HEAL_ATTEMPTS) {
            return 'QUARANTINE';
        }
        if (record.success_rate >= STATE_THRESHOLDS.HEALTHY) {
            return 'HEALTHY';
        }
        if (record.success_rate >= STATE_THRESHOLDS.DEGRADED) {
            return 'DEGRADED';
        }
        return 'BROKEN';
    }

    _createDefaults() {
        return {
            locator: null,
            tier: null,
            state: 'HEALTHY',
            success_rate: 1.0,
            total_runs: 0,
            successful_runs: 0,
            heal_attempts: 0,
            heal_version: 0,
            last_seen: null,
            last_heal_source: null,
            source_file: null,
        };
    }
}

module.exports = { RegistryManager };
