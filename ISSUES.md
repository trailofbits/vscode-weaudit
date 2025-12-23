# GitHub Issues for Testing Plan

6 issues, one per phase/component. Run each `gh issue create` command below.

---

## Issue 1: Test Infrastructure Setup

```bash
gh issue create \
  --repo trailofbits/vscode-weaudit \
  --title "Testing: Set up test infrastructure and mocks" \
  --assignee fegge \
  --body '## Overview
Set up the foundational test infrastructure before writing individual tests.

## Tasks
- [ ] Add devDependencies: `jsdom`, `nyc`, `@vscode/test-electron`
- [ ] Create directory structure:
  ```
  test/
  ├── unit/
  ├── extension/
  ├── webview/
  ├── mocks/
  └── fixtures/
  ```
- [ ] Create `test/mocks/vscode.ts` with factories:
  - `createMockWorkspaceFolder(path)`
  - `createMockTextEditor(uri, selection?)`
  - `createMockExtensionContext()`
- [ ] Create `test/fixtures/` with sample `.weaudit` files (valid, corrupt, empty, legacy)
- [ ] Add npm scripts to `package.json`:
  ```json
  "test": "npm run test:unit && npm run test:ext",
  "test:unit": "mocha -r ts-node/register test/unit/**/*.test.ts",
  "test:ext": "vscode-test",
  "coverage": "nyc npm run test:unit"
  ```
- [ ] Configure nyc coverage thresholds (80% types.ts, 60% overall)

## Acceptance Criteria
- `npm run test:unit` executes successfully
- Mock factories importable in tests
- Fixtures available for subsequent test issues

## Reference
See TESTING.md'
```

---

## Issue 2: Phase 1 - Data Integrity Tests (P0)

```bash
gh issue create \
  --repo trailofbits/vscode-weaudit \
  --title "Testing: Phase 1 - Data integrity (types.ts + persistence)" \
  --assignee fegge \
  --body '## Overview
P0 priority tests for data validation, type guards, and file persistence. If these fail, data is lost.

## Tests: Validators (20 tests)

| Test | Type |
|------|------|
| `validateSerializedData` accepts valid payload | + |
| `validateSerializedData` accepts minimal payload | + |
| `validateSerializedData` accepts legacy data (no partiallyAuditedFiles) | + |
| `validateSerializedData` rejects missing treeEntries | - |
| `validateSerializedData` rejects missing auditedFiles | - |
| `validateSerializedData` rejects missing resolvedEntries | - |
| `validateSerializedData` rejects invalid entryType | - |
| `validateSerializedData` rejects entry missing label/author/details/locations | - |
| `validateSerializedData` rejects location missing path/startLine/endLine/label | - |
| `validateSerializedData` rejects auditedFile missing path/author | - |
| `validateSerializedData` rejects partiallyAuditedFile missing coordinates | - |
| `validateSerializedData` rejects entryDetails missing severity/difficulty/type | - |

## Tests: Type Guards (11 tests)

| Test | Type |
|------|------|
| `isEntry` true for FullEntry, false for LocationEntry/PathOrganizer | +/- |
| `isLocationEntry` true for FullLocationEntry, false for FullEntry | +/- |
| `isPathOrganizerEntry` true/false cases | +/- |
| `isOldEntry` legacy vs new format | +/- |
| `isConfigurationEntry` / `isWorkspaceRootEntry` | +/- |

## Tests: Equality & Merging (18 tests)

| Test | Type |
|------|------|
| `entryEquals` identical entries | + |
| `entryEquals` different label/author/type/locations | - |
| `getEntryIndexFromArray` found and not found | +/- |
| `mergeTwoEntryArrays` deduplication and empty arrays | + |
| `mergeTwoAuditedFileArrays` deduplication | + |
| `mergeTwoPartiallyAuditedFileArrays` deduplication | + |
| `configEntryEquals` all cases | +/- |

## Tests: Factory Functions (9 tests)

| Test | Type |
|------|------|
| `createDefaultSerializedData` structure | + |
| `createDefaultEntryDetails` structure | + |
| `createPathOrganizer` / `createLocationEntry` | + |
| `treeViewModeLabel` enum conversion | + |

## Tests: File Persistence (12 tests)

| Test | Type |
|------|------|
| Load .weaudit parses valid JSON | + |
| Load .weaudit handles missing/corrupt/empty file | - |
| Load .weaudit rejects invalid schema | - |
| Save .weaudit creates .vscode if missing | + |
| Save .weaudit writes valid JSON | + |
| Save .weaudit preserves other users data | + |
| Day log load/save/missing/corrupt | +/- |

## Files
- `test/unit/validators.test.ts`
- `test/unit/types.test.ts` (extend existing)
- `test/unit/persistence.test.ts`

## Total: 70 tests'
```

---

## Issue 3: Phase 2 - Entry Lifecycle Tests (P1)

```bash
gh issue create \
  --repo trailofbits/vscode-weaudit \
  --title "Testing: Phase 2 - Entry lifecycle (CRUD + auditing)" \
  --assignee fegge \
  --body '## Overview
P1 priority tests for entry CRUD operations, location management, and file auditing.

## Tests: Entry CRUD (17 tests)

| Test | Type |
|------|------|
| `createOrEditEntry` creates new finding | + |
| `createOrEditEntry` creates new note | + |
| `createOrEditEntry` edits existing entry | + |
| `createOrEditEntry` prompts for input | + |
| `createOrEditEntry` cancels on empty/escape | - |
| `deleteFinding` removes entry | + |
| `deleteFinding` removes all locations | + |
| `deleteFinding` handles not found | - |
| `resolveFinding` moves to resolved | + |
| `resolveFinding` preserves data | + |
| `restoreFinding` moves back to active | + |
| `restoreFinding` handles not found | - |
| `restoreAllResolvedFindings` restores all | + |
| `restoreAllResolvedFindings` filters by author | + |
| `deleteAllResolvedFindings` clears list | + |
| `deleteAllResolvedFindings` filters by author | + |

## Tests: Location Management (10 tests)

| Test | Type |
|------|------|
| `addRegionToAnEntry` adds location | + |
| `addRegionToAnEntry` uses current selection | + |
| `deleteLocation` removes location | + |
| `deleteLocation` deletes entry when last | + |
| `getActiveSelectionLocation` single/multi-line | + |
| `getActiveSelectionLocation` empty/end-of-file | + |
| `getIntersectingTreeEntryIndex` finds overlap | + |
| `getIntersectingTreeEntryIndex` returns -1 | - |

## Tests: File Auditing (13 tests)

| Test | Type |
|------|------|
| `toggleAudited` marks/unmarks file | + |
| `toggleAudited` clears partial audits | + |
| `toggleAudited` updates day log | + |
| `toggleAudited` sibling folder promotion | + |
| `addPartiallyAudited` adds region | + |
| `addPartiallyAudited` uses selection | + |
| `addPartiallyAudited` skips if fully audited | - |
| `mergePartialAudits` overlapping regions | + |
| `mergePartialAudits` adjacent regions | + |
| `mergePartialAudits` disjoint regions | + |
| `mergePartialAudits` single/empty | + |

## Files
- `test/unit/entryCrud.test.ts`
- `test/unit/locations.test.ts`
- `test/unit/auditing.test.ts`

## Total: 40 tests'
```

---

## Issue 4: Phase 3 - Workspace & Navigation Tests (P1)

```bash
gh issue create \
  --repo trailofbits/vscode-weaudit \
  --title "Testing: Phase 3 - Multi-root workspace and permalinks" \
  --assignee fegge \
  --body '## Overview
P1 priority tests for multi-root workspace management, permalink generation, and navigation.

## Tests: Multi-Root Management (10 tests)

| Test | Type |
|------|------|
| `createUniqueLabels` basename for single root | + |
| `createUniqueLabels` disambiguates duplicates | + |
| `recurseUniqueLabels` deeply nested duplicates | + |
| `getCorrespondingRootAndPath` finds correct root | + |
| `getCorrespondingRootAndPath` handles nested roots | + |
| `getCorrespondingRootAndPath` caches results | + |
| `getCorrespondingRootAndPath` file outside roots | - |
| `getAllCorrespondingRootsAndPaths` all matching | + |
| `isInThisWorkspaceRoot` true case | + |
| `isInThisWorkspaceRoot` false case | - |

## Tests: Permalinks (11 tests)

| Test | Type |
|------|------|
| `getRemoteAndPermalink` GitHub URL | + |
| `getRemoteAndPermalink` GitLab URL | + |
| `getRemoteAndPermalink` Bitbucket URL | + |
| `getRemoteAndPermalink` single line (#L10) | + |
| `getRemoteAndPermalink` line range (#L10-L20) | + |
| `getRemoteAndPermalink` strips .git suffix | + |
| `getRemoteAndPermalink` handles SSH remote | + |
| `getRemoteAndPermalink` empty for missing remote | - |
| `getClientPermalink` uses client remote | + |
| `copyEntryPermalinks` configured separator | + |
| `copyEntryPermalinks` multi-location | + |

## Tests: Navigation (5 tests)

| Test | Type |
|------|------|
| `navigateToNextPartiallyAuditedRegion` next | + |
| `navigateToNextPartiallyAuditedRegion` wraps | + |
| `navigateToNextPartiallyAuditedRegion` single | + |
| `navigateToNextPartiallyAuditedRegion` none | - |
| `navigateToNextPartiallyAuditedRegion` multi-file | + |

## Files
- `test/unit/multiRoot.test.ts`
- `test/unit/permalinks.test.ts`
- `test/unit/navigation.test.ts`

## Total: 26 tests'
```

---

## Issue 5: Phase 4 - UI Components Tests (P2)

```bash
gh issue create \
  --repo trailofbits/vscode-weaudit \
  --title "Testing: Phase 4 - Tree views, webviews, and decorations" \
  --assignee fegge \
  --body '## Overview
P2 priority tests for tree data providers, webview message handlers, and decoration management.

## Tests: Main Tree Provider (11 tests)

| Test | Type |
|------|------|
| `getChildrenLinear` returns flat list | + |
| `getChildrenLinear` empty for no entries | + |
| `getChildrenPerFile` groups by path | + |
| `getChildrenPerFile` correct children | + |
| `getTreeItem` bug icon for finding | + |
| `getTreeItem` bookmark icon for note | + |
| `getTreeItem` correct command | + |
| `getTreeItem` tooltip with author | + |
| Drag-and-drop reorders entries | + |
| Drag-and-drop re-parents location | + |
| Drag-and-drop rejects invalid target | - |

## Tests: MultipleSavedFindingsTree (8 tests)

| Test | Type |
|------|------|
| `getChildren` roots for multi-root | + |
| `getChildren` configs for single root | + |
| `getChildren` configs under root | + |
| `getTreeItem` username as label | + |
| `getTreeItem` filename as description | + |
| `getTreeItem` eye icon for active | + |
| `findAndLoadConfigurationFiles` finds files | + |
| `findAndLoadConfigurationFiles` missing .vscode | - |

## Tests: ResolvedEntriesTree (4 tests)

| Test | Type |
|------|------|
| `getChildren` returns resolved entries | + |
| `getChildren` empty for none | + |
| `getTreeItem` correct icon by type | + |
| `setResolvedEntries` triggers refresh | + |

## Tests: Webview Message Handlers (8 tests)

| Test | Type |
|------|------|
| `update-entry` updates field value | + |
| `update-entry` persists when isPersistent | + |
| `update-entry` skips persist when false | + |
| `update-repository-config` updates all fields | + |
| `choose-workspace-root` switches root | + |
| `webview-ready` sends initial data | + |
| `set-workspace-roots` populates dropdown | + |
| Invalid message type ignored | - |

## Tests: DecorationManager (6 tests)

| Test | Type |
|------|------|
| Constructor loads 5 decoration types | + |
| `reloadAllDecorationConfigurations` disposes old | + |
| `reloadAllDecorationConfigurations` loads new colors | + |
| `hoverOnLabel` creates correct range | + |
| `labelAfterFirstLineTextDecoration` renderOptions | + |
| Decoration uses gutter icon path | + |

## Files
- `test/unit/treeProviders.test.ts`
- `test/webview/messageHandlers.test.ts`
- `test/unit/decorations.test.ts`

## Notes
- Webview tests use jsdom + mock `acquireVsCodeApi()`
- Tree tests need VS Code TreeItem mocks

## Total: 37 tests'
```

---

## Issue 6: CI Integration

```bash
gh issue create \
  --repo trailofbits/vscode-weaudit \
  --title "Testing: CI workflow for automated test runs" \
  --assignee fegge \
  --body '## Overview
Set up GitHub Actions to run tests on PRs and pushes.

## Tasks
- [ ] Create `.github/workflows/test.yml`
- [ ] Configure Xvfb for extension-host tests on Linux
- [ ] Set up VS Code version matrix (stable, insiders)
- [ ] Upload coverage reports to Codecov
- [ ] Add status badge to README

## Workflow Template

```yaml
name: Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        vscode-version: [stable, insiders]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: xvfb-run -a npm test
        env:
          DISPLAY: ":99"
      - run: npm run coverage
      - uses: codecov/codecov-action@v3
```

## Acceptance Criteria
- [ ] Tests run on every PR
- [ ] Coverage reports uploaded
- [ ] Badge visible in README
- [ ] Failed tests block merge'
```

---

## Summary

| Issue | Phase | Priority | Tests |
|-------|-------|----------|-------|
| 1 | Infrastructure | P0 | - |
| 2 | Data Integrity | P0 | 70 |
| 3 | Entry Lifecycle | P1 | 40 |
| 4 | Workspace & Navigation | P1 | 26 |
| 5 | UI Components | P2 | 37 |
| 6 | CI Integration | P2 | - |

**Total: 173 tests**

## Quick Create

```bash
# Run from repo root after copying each command above
# Or use GitHub web UI to create issues with the body content
```
