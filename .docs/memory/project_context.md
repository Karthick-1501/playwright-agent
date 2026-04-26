# Project Context

## What this is

A portfolio/LinkedIn project demonstrating AI-assisted test automation. The framework targets SauceDemo and uses a fully AI-assisted approach where:

- A **Scout** extracts interactive elements from pages via Chrome DevTools Protocol (no API cost)
- An **Orchestrator** validates context deterministically across 7 gates before any LLM call
- A **Claude API agent** translates pre-resolved context into framework-compliant Playwright code
- A **self-healing registry** tracks selector health and auto-patches elements files when locators break

## Tech Stack

- Claude API (agent brain) — `@anthropic-ai/sdk`
- Playwright (test runner)
- Node.js / CommonJS
- PostgreSQL (selector memory — deferred to later phase)
- Docker (portability — deferred to later phase)

## Target Application

Hyva Demo — https://demo.hyva.io

## Budget

- GitHub Copilot for day-to-day coding
- ~$5 Claude API budget for agent calls (scaling to Claude Pro)

## Commit Convention

Format: `type: short punchy summary` followed by grouped bullet sections by area.

Example:
```
feat: complete Phases 3-6 — orchestrator, CLI, heal loop, CI

Architecture:
- Implement 7-gate orchestrator in src/agent/orchestrator.js
- Add BasePage ActionEngine + AssertEngine with registry tracking
- Sync elements file after every registry heal (closes registry↔elements gap)

Testing:
- Add hyva-login_sad_path.spec.js (invalid credentials)
- Add GitHub Actions CI workflow

CLI:
- src/agent/cli.js: --prompt / --heal / --report modes
- npm scripts: agent, heal, report, test:registry, test:ci
```
