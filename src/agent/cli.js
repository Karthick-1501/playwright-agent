#!/usr/bin/env node
'use strict';

/**
 * CLI entry point for the AI agent.
 *
 * Usage:
 *   node src/agent/cli.js --prompt "generate login test" [--page Login] [--tier3]
 *   node src/agent/cli.js --heal           # auto-heal all BROKEN selectors
 *   node src/agent/cli.js --report         # print registry health report
 */

const path = require('path');
const { runAgent } = require('./orchestrator');
const { RegistryManager } = require('../registry/registry-manager');
const { HealManager } = require('../registry/heal');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    if (key.startsWith('--')) {
      const name = key.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        args[name] = true;
      } else {
        args[name] = next;
        i++;
      }
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);

  // ── Heal mode ───────────────────────────────────────────────────────────────
  if (args.heal) {
    const AGENT_DIR = path.resolve(__dirname, '../../.agent');
    const registry = new RegistryManager(path.join(AGENT_DIR, 'registry.json')).load();
    const healer = new HealManager(registry, path.join(AGENT_DIR, 'scout'));
    const results = healer.healAllBroken();

    if (results.length === 0) {
      console.log('[HEAL] No BROKEN selectors found.');
      return;
    }

    for (const r of results) {
      if (r.healed) {
        console.log(`[HEAL] ✓ ${r.key} → ${r.applied.locator} (tier ${r.applied.tier})`);
      } else {
        console.log(`[HEAL] ✗ ${r.key} — ${r.reason}`);
      }
    }

    registry.save();
    console.log(`\n[HEAL] Done. ${results.filter(r => r.healed).length}/${results.length} healed.`);
    return;
  }

  // ── Health report mode ──────────────────────────────────────────────────────
  if (args.report) {
    const AGENT_DIR = path.resolve(__dirname, '../../.agent');
    const registry = new RegistryManager(path.join(AGENT_DIR, 'registry.json')).load();
    const healer = new HealManager(registry, path.join(AGENT_DIR, 'scout'));
    const report = healer.getHealthReport();

    console.log('\n=== Registry Health Report ===');
    console.log(`Total     : ${report.total}`);
    console.log(`Healthy   : ${report.healthy}`);
    console.log(`Degraded  : ${report.degraded}`);
    console.log(`Broken    : ${report.broken}`);
    console.log(`Quarantine: ${report.quarantined}`);
    console.log('\nDetails:');
    for (const [key, state] of Object.entries(report.details)) {
      console.log(`  ${key.padEnd(35)} ${state.registry_state}`);
    }
    return;
  }

  // ── Agent generation mode ───────────────────────────────────────────────────
  if (!args.prompt) {
    console.error('Usage: node src/agent/cli.js --prompt "<request>" [--page <PageName>] [--tier3]');
    console.error('       node src/agent/cli.js --heal');
    console.error('       node src/agent/cli.js --report');
    process.exit(1);
  }

  try {
    await runAgent(args.prompt, {
      page: args.page || 'Login',
      tier3Allowed: args.tier3 === true,
      staleAck: args.staleAck === true,
    });
  } catch (err) {
    if (err.code) {
      console.error(`\n[ORCHESTRATOR ERROR] ${err.code}: ${err.message}`);
    } else {
      console.error(`\n[ERROR] ${err.message}`);
    }
    process.exit(1);
  }
}

main();
