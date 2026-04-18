const fs = require('fs');
const path = require('path');

const DEFAULT_SCOUT_DIR = path.resolve(__dirname, '../../.agent/scout');

class HealManager {
    constructor(registryManager, scoutDir = DEFAULT_SCOUT_DIR) {
        this.registry = registryManager;
        this.scoutDir = scoutDir;
    }

    findBrokenKeys() {
        this.registry._ensureLoaded();
        return this.registry.keys().filter(key => {
            const state = this.registry.resolveState(key);
            return state.registry_state === 'BROKEN';
        });
    }

    findDegradedKeys() {
        this.registry._ensureLoaded();
        return this.registry.keys().filter(key => {
            const state = this.registry.resolveState(key);
            return state.registry_state === 'DEGRADED';
        });
    }

    findQuarantinedKeys() {
        this.registry._ensureLoaded();
        return this.registry.keys().filter(key => {
            const state = this.registry.resolveState(key);
            return state.registry_state === 'QUARANTINE';
        });
    }

    loadScoutSummary(pageName) {
        const filePath = path.join(this.scoutDir, `${pageName}_summary.json`);
        if (!fs.existsSync(filePath)) return null;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }

    findCandidates(registryKey, options = {}) {
        const [pageName] = registryKey.split('.');
        const summary = this.loadScoutSummary(pageName);
        if (!summary) {
            return { key: registryKey, error: 'SCOUT_MISSING', candidates: [] };
        }

        const record = this.registry.get(registryKey);
        if (!record) {
            return { key: registryKey, error: 'REGISTRY_KEY_MISSING', candidates: [] };
        }

        const currentLocator = record.locator;
        const tier3Allowed = options.tier3Allowed === true;

        const candidates = [];

        for (const el of summary.elements) {
            if (el.disabled) continue;
            if (el.locator_suggestion === currentLocator) continue;

            if (el.tier_suggestion === 3 && !tier3Allowed) continue;

            const score = this._scoreCandidate(el, registryKey);
            if (score <= 0) continue;

            candidates.push({
                locator: el.locator_suggestion,
                tier: el.tier_suggestion,
                source: el.source,
                score,
                scout_key: el.key,
                dom_only: el.source === 'dom',
            });
        }

        candidates.sort((a, b) => {
            if (a.tier !== b.tier) return a.tier - b.tier;
            return b.score - a.score;
        });

        return { key: registryKey, error: null, candidates };
    }

    healKey(registryKey, options = {}) {
        const state = this.registry.resolveState(registryKey);

        if (state.registry_state === 'QUARANTINE') {
            return {
                key: registryKey,
                healed: false,
                reason: 'QUARANTINE',
                message: `${registryKey} is quarantined. Manual review required.`,
            };
        }

        if (state.registry_state === 'HEALTHY') {
            return {
                key: registryKey,
                healed: false,
                reason: 'ALREADY_HEALTHY',
                message: `${registryKey} is healthy. No heal needed.`,
            };
        }

        const { candidates, error } = this.findCandidates(registryKey, options);

        if (error) {
            return {
                key: registryKey,
                healed: false,
                reason: error,
                message: `Cannot find candidates for ${registryKey}: ${error}`,
            };
        }

        if (candidates.length === 0) {
            this.registry.incrementHealAttempt(registryKey);
            return {
                key: registryKey,
                healed: false,
                reason: 'NO_CANDIDATES',
                message: `No suitable replacement found for ${registryKey}.`,
                new_state: this.registry.resolveState(registryKey).registry_state,
            };
        }

        const best = candidates[0];

        this.registry.incrementHealAttempt(registryKey);
        this.registry.applyHeal(registryKey, {
            locator: best.locator,
            tier: best.tier,
            source: best.dom_only ? 'agent-generated' : 'scout-generated',
        });

        return {
            key: registryKey,
            healed: true,
            applied: {
                locator: best.locator,
                tier: best.tier,
                source: best.dom_only ? 'agent-generated' : 'scout-generated',
                scout_key: best.scout_key,
            },
            new_state: this.registry.resolveState(registryKey).registry_state,
            remaining_candidates: candidates.length - 1,
        };
    }

    healAllBroken(options = {}) {
        const broken = this.findBrokenKeys();
        return broken.map(key => this.healKey(key, options));
    }

    getHealthReport() {
        this.registry._ensureLoaded();
        const keys = this.registry.keys();
        const report = {
            total: keys.length,
            healthy: 0,
            degraded: 0,
            broken: 0,
            quarantined: 0,
            details: {},
        };

        for (const key of keys) {
            const state = this.registry.resolveState(key);
            const bucket = state.registry_state.toLowerCase();
            if (bucket === 'healthy') report.healthy++;
            else if (bucket === 'degraded') report.degraded++;
            else if (bucket === 'broken') report.broken++;
            else if (bucket === 'quarantine') report.quarantined++;
            report.details[key] = state;
        }

        return report;
    }

    _scoreCandidate(scoutElement, registryKey) {
        const [, elementName] = registryKey.split('.');
        const elName = elementName.toLowerCase();
        const scoutKey = scoutElement.key.split('.')[1]?.toLowerCase() || '';
        const label = (scoutElement.label || '').toLowerCase();

        let score = 0;

        if (scoutKey === elName) score += 10;
        else if (scoutKey.includes(elName) || elName.includes(scoutKey)) score += 5;

        if (label.includes(elName) || elName.includes(label.replace(/\s/g, ''))) score += 3;

        if (scoutElement.source === 'a11y+dom') score += 2;
        else if (scoutElement.source === 'a11y') score += 1;

        if (scoutElement.tier_suggestion === 1) score += 3;
        else if (scoutElement.tier_suggestion === 2) score += 2;
        else if (scoutElement.tier_suggestion === 3) score += 1;

        return score;
    }
}

module.exports = { HealManager };
