# Contributing Guidelines

This document outlines the standard operating procedures and code style requirements for contributing to the Playwright AI Agent framework.

## Setup and Installation

1.  Ensure Node.js is installed.
2.  Run `npm install` to install dependencies.
3.  Run `npx playwright install` to download browser binaries.
4.  Set your API key as an environment variable: `export ANTHROPIC_API_KEY=sk-ant-...` (Unix) or `set ANTHROPIC_API_KEY=sk-ant-...` (Windows).

## Development Workflow

The standard process for adding new test coverage involves four steps.

### 1. Scouting
Before generating tests for a new page, you must extract its DOM footprint.

`npm run scout -- --url https://example.com --page MyPageName`

### 2. Generation
Prompt the agent to generate specific test scenarios based on the Scout data.

`npm run agent -- --prompt "verify the login form rejects invalid credentials" --page MyPageName`

### 3. Review and Run
Review the generated files in `src/elements`, `src/pages`, and `src/tests`. If the agent staged test data, review `.agent/pending_patches.json` and move the data to `config/testdata.config.js`.

Execute the tests:
`npm test`

### 4. Healing
If tests fail due to UI changes or broken locators, run the healing routine to patch the codebase automatically.

`npm run heal`

## Coding Standards

The framework enforces strict structural rules. Pull requests violating these rules will be rejected.

*   **Module System**: Use CommonJS universally (`require` and `module.exports`). Do not use ES modules (`import` and `export`).
*   **Action Routing**: Page Object methods must never chain actions directly off locators. You must use `this.click(registryKey, locator)`, `this.fill(registryKey, locator, value)`, etc.
*   **Test Data**: Hardcoded strings inside `src/tests/` are strictly prohibited. All string values must be retrieved using `TestData.get('path.to.key')`.
*   **Locator Tiers**: Always utilize the highest semantic tier possible.
    *   Tier 1: Semantic roles and labels (Preferred).
    *   Tier 2: Explicit test attributes (`data-test_id`).
    *   Tier 3: Structural IDs (`#email`). Requires review.
    *   Tier 4: XPath, long class chains, or index-based selectors. Banned.

## Adding Tests

Unit tests are required for the agent logic, registry managers, and orchestrator boundaries. Playwright tests are used exclusively for the generated target application code.

To run the unit test suite:
`npm run test:registry`

The unit tests automatically run as a `posttest` hook after the Playwright end-to-end framework runs.
