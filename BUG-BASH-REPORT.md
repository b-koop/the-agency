# Bug Bash Report: the-agency CLI

**Scope**: `src/*.ts`, `src/test/*.ts`
**Depth**: Standard
**Date**: 2026-04-15
**Inspectors**: Security ✓, Code Quality ✓, Naming ✓, Performance ✓

---

## Executive Summary

| Severity | Count |
|----------|-------|
| Critical | 2 |
| High | 12 |
| Medium | 11 |
| Low | 10 |
| Informational | 7 |
| **Total** | **42** |

**Coverage Gaps**: None — all inspectors completed successfully.

---

## Critical Findings

### SEC-001: Debug Telemetry with Hardcoded Session Identifiers

**Severity**: Critical
**Category**: Security — Data Leakage

#### Test Expectation
**As a** user of the CLI
**I expect** no data about my usage is transmitted without my consent
**So that** my activity remains private

**Test Name**: `cli_does_not_transmit_usage_data_without_consent`

#### Location
`src/promptCatalog.ts:79-91, 96-109, 229-244, 293-307`

```typescript
fetch("http://127.0.0.1:7622/ingest/66b982c3-50b0-47a6-a4bb-1a2b900ac9e4", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "c07495" },
  body: JSON.stringify({
    sessionId: "c07495",
    runId: process.env.AGENCY_DEBUG_RUN ?? "pre",
    // ...
  }),
}).catch(() => {});
```

#### Issue
**Summary**: Production code contains debug telemetry that transmits usage data to hardcoded endpoint.

**Detail**: Four separate `fetch()` calls send file counts, session IDs, timestamps, and operation data to a localhost endpoint. Hardcoded UUID and session ID present tracking risk.

**Evidence**: `grep -n "fetch.*7622" src/promptCatalog.ts` shows 4 occurrences.

#### Resolution Options

1. **Remove debug blocks** (Recommended)
   - Effort: Low | Risk: None | Breaking: No
   - Delete all `#region agent log` blocks
   - Trade-offs: None

2. **Feature flag with env var**
   - Effort: Low | Risk: None | Breaking: No
   - Only send if `AGENCY_DEBUG=1`
   - Trade-offs: Debug code remains in codebase

3. **Strip in build**
   - Effort: Medium | Risk: Low | Breaking: No
   - Configure build to remove regions
   - Trade-offs: Build complexity

---

### PERF-001: Reads All Files During Selector Matching

**Severity**: Critical
**Category**: Performance — I/O

#### Test Expectation
**As a** user running prompt lookup
**I expect** instant response times
**So that** my workflow isn't blocked

**Test Name**: `prompt_lookup_responds_instantly_even_in_large_repos`

#### Location
`src/promptCatalog.ts:393-401`

```typescript
for (const item of items) {
  updateMatch(item, scoreCandidate(normalize(item.name)), "fileName");

  if (item.kind === "file") {
    const prompt = await loadPrompt(item.fullPath, item.relativePath, item.fileName);
    // ...
  }
}
```

#### Issue
**Summary**: `matchSelector()` reads every markdown file even when filename already matches.

**Detail**: For 50 prompts, this means 50 file reads per selector, even if the first file is a perfect match (score 3). No early exit on exact match.

**Evidence**: `loadPrompt()` at line 397 calls `readFile()` unconditionally for all files.

#### Resolution Options

1. **Early exit on exact filename match** (Recommended)
   - Effort: Low | Risk: None | Breaking: No
   - If score=3, return immediately without reading more files
   - Trade-offs: None

2. **Lazy frontmatter loading**
   - Effort: Medium | Risk: Low | Breaking: No
   - Only read files if no filename match found
   - Trade-offs: Slightly more complex logic

3. **Cache frontmatter in manifest**
   - Effort: High | Risk: Medium | Breaking: No
   - Regenerate on file change
   - Trade-offs: Additional file to maintain

---

## High Priority Findings

### SEC-002: Path Traversal via Selector Input

**Severity**: High | **Category**: Security — Input Validation

**Test Name**: `selectors_cannot_access_files_outside_repo`

**Location**: `src/promptCatalog.ts:179-191`

**Issue**: User-provided selectors could traverse outside repo root (e.g., `../../../etc`).

**Resolution**: Add path containment check: `path.resolve(fullPath).startsWith(path.resolve(repoRoot))`

---

### CQ-001: Node.js 22+ API Used Without Polyfill

**Severity**: High | **Category**: Code Quality — Compatibility

**Test Name**: `cli_runs_on_nodejs_18_lts`

**Location**: `src/promptCatalog.ts:128`

```typescript
return normalizedPath.split("/").some((segment) => path.matchesGlob(segment, normalizedPattern));
```

**Issue**: `path.matchesGlob` only exists in Node.js 22+. Crashes on LTS versions (18, 20).

**Resolution**: Add polyfill using `minimatch` or `picomatch`

---

### CQ-002: JSON Parse Errors Not Handled

**Severity**: High | **Category**: Code Quality — Error Handling

**Test Name**: `corrupted_store_file_shows_recovery_instructions`

**Location**: `src/store.ts:60-66`

**Issue**: `SyntaxError` from corrupted JSON propagates without context about which file or how to recover.

**Resolution**: Catch `SyntaxError` specifically, provide file path and recovery hint.

---

### PERF-002: Reads All Files for Directory Listing

**Severity**: High | **Category**: Performance — I/O

**Test Name**: `listing_completes_quickly_for_large_agencies`

**Location**: `src/promptCatalog.ts:285-289`

**Issue**: `buildListing()` reads every prompt file even when only filenames are needed.

**Resolution**: Skip file reads when `fields` only contains `fileName`/`path`.

---

### PERF-003: Store Reloaded on Every Operation

**Severity**: High | **Category**: Performance — I/O

**Test Name**: `store_operations_do_not_repeatedly_read_file`

**Location**: `src/store.ts:49-113`

**Issue**: Every store method calls `load()` which reads and parses JSON. No caching.

**Resolution**: Add in-memory cache, invalidate only on write.

---

### NAME-101 through NAME-109: Test Names Are Implementation-Focused

**Severity**: High | **Category**: Naming — Test Names

**Location**: `src/test/run.ts`

| Current Name | Suggested Name |
|--------------|----------------|
| `testParseFrontmatter` | `yaml_header_extracts_name_and_description` |
| `testLocalStore` | `registered_agency_persists_across_restart` |
| `testDefaultAgencyBootstrap` | `first_run_automatically_registers_default_agency` |
| `testPromptResolution` | `selector_path_returns_matching_prompt` |
| `testAmbiguity` | `unclear_selector_shows_all_possible_matches` |
| `testHelpers` | Split into: `git_url_converts_to_readable_key`, `local_directory_recognized_as_source` |

---

## Test Expectation Checklist

Copy this to your QA team:

### Security
- [ ] `cli_does_not_transmit_usage_data_without_consent`
- [ ] `selectors_cannot_access_files_outside_repo`
- [ ] `hire_command_warns_on_untrusted_repo_sources`
- [ ] `agency_home_validates_path_is_writable`

### Code Quality
- [ ] `cli_runs_on_nodejs_18_lts`
- [ ] `corrupted_store_file_shows_recovery_instructions`
- [ ] `missing_git_binary_shows_install_instructions`
- [ ] `local_directory_validates_existence_before_registration`

### Performance
- [ ] `prompt_lookup_responds_instantly_even_in_large_repos`
- [ ] `listing_completes_quickly_for_large_agencies`
- [ ] `store_operations_do_not_repeatedly_read_file`
- [ ] `gitignore_rules_load_once_per_operation`

### Naming (Test Names to Rewrite)
- [ ] `yaml_header_extracts_name_and_description`
- [ ] `registered_agency_persists_across_restart`
- [ ] `first_run_automatically_registers_default_agency`
- [ ] `selector_path_returns_matching_prompt`
- [ ] `unclear_selector_shows_all_possible_matches`

---

## Resolution Roadmap

### Immediate (Critical + High, Low Effort)

| Finding | Resolution | Effort |
|---------|------------|--------|
| SEC-001 | Remove debug telemetry blocks | Low |
| PERF-001 | Early exit on exact filename match | Low |
| CQ-001 | Add `minimatch` polyfill for `path.matchesGlob` | Low |
| CQ-002 | Catch JSON `SyntaxError` with helpful message | Low |
| SEC-002 | Add path containment check | Low |

### Next Sprint (High/Medium, Medium Effort)

| Finding | Resolution | Effort |
|---------|------------|--------|
| PERF-003 | Add in-memory store cache | Medium |
| PERF-002 | Skip file reads when only filenames needed | Low |
| NAME-101-109 | Rewrite test names to user behavior focus | Medium |
| CQ-003 | Wrap git calls with helpful ENOENT message | Low |

### Backlog

| Finding | Resolution | Effort |
|---------|------------|--------|
| SEC-003 | Add URL scheme validation for `hire` | Low |
| PERF-004 | Pass ignoreRules through call chain | Low |
| PERF-006 | Pre-compile gitignore patterns | Medium |
| NAME-001-010 | Improve variable clarity | Low |

---

## Medium Priority Findings (Condensed)

| ID | Category | Summary | Location | Resolution |
|----|----------|---------|----------|------------|
| SEC-003 | Security | Arbitrary git repo clone without validation | git.ts:79 | URL scheme validation |
| CQ-003 | Code Quality | Unhelpful error when git not installed | git.ts:35 | Detect ENOENT, show install hint |
| CQ-004 | Code Quality | Local directory not validated on registration | agencyBootstrap.ts:29 | Add existence check |
| CQ-005 | Code Quality | Debug telemetry in production | promptCatalog.ts | Remove or gate behind env var |
| PERF-004 | Performance | Duplicate .gitignore loads | promptCatalog.ts | Pass rules through call chain |
| PERF-005 | Performance | Debug fetch in hot paths | promptCatalog.ts | Gate behind env check |
| PERF-006 | Performance | Multiple glob evaluations per rule | promptCatalog.ts | Short-circuit cheap checks first |
| NAME-001 | Naming | `normalize` is too generic | promptCatalog.ts:26 | `normalizeForSelectorMatch` |
| NAME-002 | Naming | `data` is too generic | index.ts:83 | `agencyStore` |
| NAME-004 | Naming | `items` doesn't convey domain | promptCatalog.ts:182 | `catalogEntries` |
| NAME-005 | Naming | `tail` unclear meaning | git.ts:49 | `repoIdentifierSegments` |

---

## Low Priority & Informational

| ID | Summary | Location |
|----|---------|----------|
| SEC-004 | AGENCY_HOME not validated as writable | store.ts:17 |
| SEC-005 | JSON parsing without size limits | index.ts:28 |
| CQ-006 | Unused `os` import | store.ts:2 |
| CQ-007 | Scientific notation not parsed as numbers | index.ts:25 |
| CQ-008 | Concurrent store writes use same temp file | store.ts:69 |
| CQ-009 | Type assertion without guard | store.ts:61 |
| CQ-010 | gitignore errors silently swallowed | promptCatalog.ts:94 |
| PERF-007 | mkdir called on every load | store.ts:44 |
| PERF-008 | Unbounded parallel file reads | promptCatalog.ts:285 |
| NAME-003 | `left`, `right` in sort callback | index.ts:84 |
| NAME-006 | `last` doesn't indicate timestamp | git.ts:64 |
| NAME-007 | `parsed` too generic | store.ts:54 |
| NAME-008 | `exists` lacks subject | git.ts:77 |
| NAME-009 | `output` doesn't describe filtered record | promptCatalog.ts:39 |
| NAME-010 | `entries` generic for readdir | promptCatalog.ts:181 |

---

## Inspectors Run

| Inspector | Findings | Status |
|-----------|----------|--------|
| Security | 5 | ✓ Complete |
| Code Quality | 10 | ✓ Complete |
| Naming | 19 | ✓ Complete |
| Performance | 8 | ✓ Complete |

---

**Generated by**: Bug Bash Orchestrator
**Methodology**: Parallel inspector dispatch with structured finding schema
