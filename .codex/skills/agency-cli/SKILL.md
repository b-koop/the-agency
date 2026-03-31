---
name: agency-cli
description: Load this skill when you need the exact agency agent for a task; it tells Codex how to hire, browse, and resolve the right prompt fast.
---

# Agency CLI

Use this skill to work with the local `the-agency` CLI and choose the right prompt from an agency repository.

## Quick Start

Build the CLI before using it if `dist/` is missing or stale.

```powershell
pnpm build
```

Hire a repo or local prompt directory to make it active.

```powershell
node dist/index.js hire <git-repo-or-local-folder>
```

List the root options for the active agency.

```powershell
node dist/index.js
```

Traverse into a subdepartment.

```powershell
node dist/index.js <selector>
node dist/index.js <selector> <selector>
```

Request only selected metadata fields when the body is not needed.

```powershell
node dist/index.js --fields name,description,color <selector>
```

## Workflow

1. Ensure the CLI is built.
2. Hire the target repo or local folder if no agency is active.
3. Start with a root listing instead of guessing deep paths.
4. Follow the returned `subdepartments` or `prompts` one level at a time.
5. Resolve a single prompt only after the listing makes the choice clear.
6. Use `--fields` for ranking or routing decisions; fetch full prompt content only when needed.

## Routing Guidance

Prefer explicit intent over vague wording.

- Route visual polish, design systems, reusable components, layout consistency, hierarchy, spacing, and pixel-perfect UI requests to the UI-focused prompt.
- Route user interviews, usability testing, evidence gathering, behavior analysis, friction diagnosis, and validation requests to the UX research prompt.
- For vague requests such as "improve onboarding" or "make this easier to use," default to the research-oriented prompt first unless the request clearly asks for visual or component implementation.

## Command Patterns

Use these patterns directly.

```powershell
node dist/index.js hire fixtures/agency-agents-mirror
node dist/index.js
node dist/index.js design
node dist/index.js design ui-designer
node dist/index.js --fields name,description design
```

## Practical Rules

- Prefer listings before resolution when the repository structure is unfamiliar.
- Trust exact matches from a listing over freehand guesses.
- Treat dot-prefixed files and folders as intentionally hidden noise.
- Treat top-level `README` and `CONTRIBUTING` markdown files as non-prompts.
- If a selector is ambiguous, use the returned candidates and retry with a more exact selector.
