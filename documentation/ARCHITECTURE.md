# System Architecture

The Playwright AI Agent framework operates on a strict separation of concerns between deterministic execution and non-deterministic code generation. 

## Architectural Philosophy

The core principle is that the AI agent (Claude) acts solely as a pure code translator. It receives pre-validated, resolved context and returns a structured JSON envelope containing code patches. It never executes code, never validates its own inputs, and never interacts directly with the browser or the file system.

All deterministic logic, file I/O, security gating, and state resolution are handled by the Orchestrator.

## Component Breakdown

### 1. Scout (DOM Discovery)
Scout is a zero-cost utility that extracts interactive elements from a target web page via the Chrome DevTools Protocol (CDP). It operates prior to any test generation.

*   **Mechanism**: Uses a dual-pass merge combining the CDP accessibility tree (roles, labels) with a DOM overlay (attributes like data-test, id, placeholder).
*   **Purpose**: Creates a highly compressed JSON summary of interactive elements, reducing the token payload sent to the language model by up to 95 percent compared to raw HTML.
*   **Result**: Produces an artifact in `.agent/scout/{PageName}_summary.json`.

### 2. Orchestrator
The Orchestrator acts as the gatekeeper between the user prompt and the AI model. It enforces seven sequential gates:

1.  **Input Presence**: Validates required runtime files exist.
2.  **Stale Index**: Checks if the method index is out of sync.
3.  **Registry State Resolution**: Retrieves the health state of elements to determine if they need healing or can be reused.
4.  **Scout Element Filtering**: Uses heuristics to filter the massive DOM summary down to only elements relevant to the user prompt.
5.  **Pending Patch Deduplication**: Prevents the agent from proposing duplicate test data configurations.
6.  **Tier 3 Permission**: Validates if the user allowed lower-tier locators.
7.  **Post-call Envelope Validation**: Validates the JSON payload returned by the agent for schema adherence and file path security.

### 3. Self-Healing Registry
Tracks the success and failure rate of every Playwright interaction at runtime.

*   **State Machine**: Elements transition between HEALTHY (>= 85 percent), DEGRADED (50 to 84 percent), BROKEN (< 50 percent), and QUARANTINE (requires manual review).
*   **Storage**: Maintained locally in `.agent/registry.json`.
*   **Persistence**: Uses a debounced write queue and lockfile-based atomic merges to safely record analytics across parallel Playwright worker processes without data loss.

### 4. BasePage Action Engine
The base layer for all Page Objects. Test files and Page Objects never execute Playwright actions (like `fill` or `click`) directly. They route all interactions through BasePage methods.

*   **Responsibility**: Wraps native Playwright interactions with registry telemetry.
*   **Error Classification**: Intercepts errors and classifies them. Network timeouts or assertion failures are ignored. Strict mode violations or locator timeouts correctly degrade the selector's health score.

## Four-Layer Code Structure

The generated codebase adheres strictly to the following layered pattern. Logic must never cross layer boundaries.

1.  **Elements** (`src/elements/`): Contains purely locator builder functions returning Playwright Locators. No actions or assertions.
2.  **BasePage** (`src/pages/BasePage.js`): The telemetry and action execution engine.
3.  **Page Objects** (`src/pages/`): Contains all business logic and scenario methods. Inherits from BasePage. Calls BasePage actions, passing element definitions.
4.  **Tests** (`src/tests/`): Contains only Playwright `describe` and `test` blocks. Consumes Page Objects and dynamic test data. No logic, no loops, no hardcoded strings.

## Data Flow

1.  User issues a command via the CLI.
2.  Orchestrator loads Scout data, TestData configuration, and Registry context.
3.  Orchestrator executes Gates 1 through 6.
4.  Orchestrator submits the filtered context to the Anthropic API.
5.  Model returns a JSON envelope containing code modifications.
6.  Orchestrator executes Gate 7 to validate the envelope.
7.  Orchestrator applies file system writes, updates internal index files, and patches elements files if healing occurred.
