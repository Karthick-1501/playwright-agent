# PROJECT_CONTEXT.md
# Why decisions were made. Feed this alongside MASTER_MEMORY on complex prompts.

---

## Architecture Decisions

- ActionEngine dropped: Playwright native auto-waiting makes it redundant
- PG dropped: Flat JSON registry sufficient for SauceDemo scale
- PGAdmin dropped: Adminer or built-in UI route replaces it
- Registry is .agent/registry.json, not a DB
- Staging area (pending_patches.json) prevents config write collisions
- Index uses atomic delta merge with STAGING → live promotion
- Circuit breaker: QUARANTINE state after 2 failed heal attempts
- Scout runs once per page, stored, only sends unknown elements to API

---

## Development Environment

### Dual-IDE Workflow
Two AI-assisted IDEs share the SAME project folder simultaneously:

| IDE | AI Models | Role |
|---|---|---|
| **VS Code** | GitHub Copilot (Sonnet, Opus 4.6) | Writing code — inline completions, agent mode edits, multi-file generation |
| **Antigravity** | Claude (Sonnet, Opus 4.6) | Architecture, reviews, debugging, running commands, documentation |

### File Organization

```
d:\Github\My Agent\Playwright\
├── md files\              ← Agent design docs (master_memory, project_context)
├── AG generated\          ← Files created by Antigravity (roadmaps, plans, analysis)
├── vs generated\          ← Files created by VS Code Copilot (notes, drafts)
├── .github\
│   └── copilot-instructions.md  ← Auto-loaded context for Copilot
├── src\
│   ├── elements\          ← Locator definitions per page
│   ├── pages\             ← Page Objects (methods live here)
│   └── tests\             ← Test specs (describe/test blocks only)
├── .agent\
│   ├── registry.json      ← Selector health tracking
│   ├── method_index.json  ← Existing method registry
│   └── pending_patches.json ← Config staging area
├── execution.config.js    ← Environment/URL config
├── testdata.config.js     ← Test data (no hardcoded strings in tests)
└── playwright.config.js   ← Playwright runner config
```

### Tool Rules
- Antigravity creates files ONLY in `AG generated/` (except source code in `src/`)
- VS Code Copilot creates files ONLY in `vs generated/` (except source code in `src/`)
- Both tools write source code directly to `src/`, `.agent/`, and config files
- Memory files (`md files/`) are edited by either tool when context needs updating

---

## API Strategy (Runtime Agent)

- Runtime code generation uses Claude Sonnet API (cost-efficient, ~$0.01-0.03/call)
- MASTER_MEMORY.md is the system prompt — constrains output for smaller models
- Scout uses zero API calls (pure Playwright DOM extraction)
- Registry lookups are local JSON reads (zero cost)