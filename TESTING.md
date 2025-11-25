# Testing Plan

## Framework & Tools

| Tool | Purpose |
|------|---------|
| `mocha` + `chai` | Unit test runner and assertions |
| `sinon` | Stubs and mocks |
| `@vscode/test-electron` | Extension-host tests with real VS Code APIs |
| `jsdom` | Webview DOM simulation |
| `nyc` | Coverage reporting (target: 80% for `types.ts`, 60% overall) |

## Test Layout

```
test/
├── unit/           # Pure logic, no VS Code host (fast)
├── extension/      # Extension-host tests via @vscode/test-electron
├── webview/        # DOM tests with jsdom
├── mocks/          # Shared mock factories
└── fixtures/       # Sample workspaces and .weaudit files
```

---

## Phase 1: Data Integrity (P0)

### types.ts - Validators

| Test | Type | Description |
|------|------|-------------|
| `validateSerializedData` accepts valid payload | + | Full payload with all fields |
| `validateSerializedData` accepts minimal payload | + | Empty arrays, empty strings |
| `validateSerializedData` accepts legacy data without `partiallyAuditedFiles` | + | Backwards compatibility |
| `validateSerializedData` rejects missing `treeEntries` | - | `undefined` or missing key |
| `validateSerializedData` rejects missing `auditedFiles` | - | `undefined` or missing key |
| `validateSerializedData` rejects missing `resolvedEntries` | - | `undefined` or missing key |
| `validateSerializedData` rejects invalid `entryType` | - | Number outside enum range |
| `validateSerializedData` rejects entry missing `label` | - | `undefined` label |
| `validateSerializedData` rejects entry missing `author` | - | `undefined` author |
| `validateSerializedData` rejects entry missing `details` | - | `undefined` details |
| `validateSerializedData` rejects entry missing `locations` | - | `undefined` locations |
| `validateSerializedData` rejects location missing `path` | - | `undefined` path |
| `validateSerializedData` rejects location missing `startLine` | - | `undefined` startLine |
| `validateSerializedData` rejects location missing `endLine` | - | `undefined` endLine |
| `validateSerializedData` rejects location missing `label` | - | `undefined` label |
| `validateSerializedData` rejects `auditedFile` missing `path` | - | `undefined` path |
| `validateSerializedData` rejects `auditedFile` missing `author` | - | `undefined` author |
| `validateSerializedData` rejects `partiallyAuditedFile` missing coordinates | - | Missing `startLine`/`endLine` |
| `validateSerializedData` rejects `entryDetails` missing `severity` | - | `undefined` severity |
| `validateSerializedData` rejects `entryDetails` missing `difficulty` | - | `undefined` difficulty |
| `validateSerializedData` rejects `entryDetails` missing `type` | - | `undefined` type |

### types.ts - Type Guards

| Test | Type | Description |
|------|------|-------------|
| `isEntry` returns true for `FullEntry` | + | Has `entryType` field |
| `isEntry` returns false for `LocationEntry` | - | Missing `entryType` |
| `isEntry` returns false for `PathOrganizerEntry` | - | Missing `entryType` |
| `isLocationEntry` returns true for `FullLocationEntry` | + | Has `parentEntry` field |
| `isLocationEntry` returns false for `FullEntry` | - | Missing `parentEntry` |
| `isPathOrganizerEntry` returns true for path organizer | + | Has `pathLabel` field |
| `isPathOrganizerEntry` returns false for entry | - | Missing `pathLabel` |
| `isOldEntry` returns true for entry without `rootPath` | + | Legacy format |
| `isOldEntry` returns false for entry with `rootPath` | - | New format |
| `isConfigurationEntry` returns true for config | + | Has `username` field |
| `isWorkspaceRootEntry` returns true for root | + | Has `label` field |

### types.ts - Equality & Merging

| Test | Type | Description |
|------|------|-------------|
| `entryEquals` returns true for identical entries | + | Same label, type, author, locations |
| `entryEquals` returns false for different labels | - | Different `label` |
| `entryEquals` returns false for different authors | - | Different `author` |
| `entryEquals` returns false for different types | - | Finding vs Note |
| `entryEquals` returns false for different location counts | - | 1 vs 2 locations |
| `entryEquals` returns false for different location paths | - | Different `path` |
| `entryEquals` returns false for different line ranges | - | Different `startLine`/`endLine` |
| `getEntryIndexFromArray` finds existing entry | + | Returns correct index |
| `getEntryIndexFromArray` returns -1 for missing entry | - | Entry not in array |
| `mergeTwoEntryArrays` combines unique entries | + | No duplicates in result |
| `mergeTwoEntryArrays` removes duplicates | + | Duplicate entry appears once |
| `mergeTwoEntryArrays` handles empty arrays | + | Empty + non-empty |
| `mergeTwoAuditedFileArrays` removes duplicates | + | Same path+author once |
| `mergeTwoAuditedFileArrays` keeps different authors | + | Same path, different authors |
| `mergeTwoPartiallyAuditedFileArrays` removes exact duplicates | + | Same coordinates |
| `mergeTwoPartiallyAuditedFileArrays` keeps different ranges | + | Different line ranges |
| `configEntryEquals` matches identical configs | + | Same path, username, root |
| `configEntryEquals` rejects different paths | - | Different `path` |
| `configEntryEquals` rejects different usernames | - | Different `username` |
| `configEntryEquals` rejects different roots | - | Different `root.label` |

### types.ts - Factory Functions

| Test | Type | Description |
|------|------|-------------|
| `createDefaultSerializedData` returns empty arrays | + | All arrays empty |
| `createDefaultSerializedData` returns empty strings | + | All strings empty |
| `createDefaultEntryDetails` returns undefined enums | + | Severity, difficulty, type |
| `createDefaultEntryDetails` returns empty description | + | Empty string |
| `createDefaultEntryDetails` returns recommendation template | + | Contains "Short term" |
| `createPathOrganizer` creates valid path label | + | Returns `{pathLabel}` |
| `createLocationEntry` ties location to parent | + | Returns linked structure |
| `treeViewModeLabel` returns "list" for List mode | + | Enum to string |
| `treeViewModeLabel` returns "byFile" for GroupByFile mode | + | Enum to string |

### codeMarker.ts - File Persistence

| Test | Type | Description |
|------|------|-------------|
| Load `.weaudit` file parses valid JSON | + | Returns `SerializedData` |
| Load `.weaudit` file handles missing file | - | Returns default data |
| Load `.weaudit` file handles corrupt JSON | - | Returns default data, logs warning |
| Load `.weaudit` file handles empty file | - | Returns default data |
| Load `.weaudit` file rejects invalid schema | - | Validation fails, returns default |
| Save `.weaudit` file creates `.vscode` directory | + | Directory created if missing |
| Save `.weaudit` file writes valid JSON | + | Parseable output |
| Save `.weaudit` file preserves other users' data | + | Merge with existing content |
| Day log loads from `.weauditdaylog` | + | Returns `Map<string, string[]>` |
| Day log handles missing file | - | Returns empty map |
| Day log handles corrupt JSON | - | Returns empty map |
| Day log persists changes | + | Written to disk |

---

## Phase 2: Entry Lifecycle (P1)

### Entry CRUD

| Test | Type | Description |
|------|------|-------------|
| `createOrEditEntry` creates new finding | + | EntryType.Finding, new label |
| `createOrEditEntry` creates new note | + | EntryType.Note, new label |
| `createOrEditEntry` edits existing entry label | + | Updates label in place |
| `createOrEditEntry` prompts for input | + | Shows input box |
| `createOrEditEntry` cancels on empty input | - | Returns without change |
| `createOrEditEntry` cancels on escape | - | Returns without change |
| `deleteFinding` removes entry from tree | + | Entry no longer in list |
| `deleteFinding` removes all locations | + | Multi-location entry fully removed |
| `deleteFinding` handles entry not found | - | No error, no change |
| `resolveFinding` moves entry to resolved list | + | In resolved, not in active |
| `resolveFinding` preserves entry data | + | All fields intact |
| `restoreFinding` moves entry back to active | + | In active, not in resolved |
| `restoreFinding` handles entry not found | - | No error, no change |
| `restoreAllResolvedFindings` restores all entries | + | Resolved list empty |
| `restoreAllResolvedFindings` filters by author | + | Only user's entries restored |
| `deleteAllResolvedFindings` clears resolved list | + | List empty |
| `deleteAllResolvedFindings` filters by author | + | Only user's entries deleted |

### Location Management

| Test | Type | Description |
|------|------|-------------|
| `addRegionToAnEntry` adds location to existing entry | + | Location count increases |
| `addRegionToAnEntry` uses current selection | + | Correct line range |
| `deleteLocation` removes location from entry | + | Location count decreases |
| `deleteLocation` deletes entry when last location removed | + | Entry removed entirely |
| `getActiveSelectionLocation` handles single line | + | startLine == endLine |
| `getActiveSelectionLocation` handles multi-line | + | Correct range |
| `getActiveSelectionLocation` handles empty selection | + | Zero-length range |
| `getActiveSelectionLocation` handles end-of-file | + | No off-by-one error |
| `getIntersectingTreeEntryIndex` finds overlapping entry | + | Returns correct index |
| `getIntersectingTreeEntryIndex` returns -1 when none | - | No overlap |

### File Auditing

| Test | Type | Description |
|------|------|-------------|
| `toggleAudited` marks file as audited | + | Added to audited list |
| `toggleAudited` unmarks audited file | + | Removed from audited list |
| `toggleAudited` clears partial audits when marking full | + | Partial list cleared for file |
| `toggleAudited` updates day log | + | Today's date entry updated |
| `toggleAudited` handles sibling folder promotion | + | Parent marked → children removed |
| `addPartiallyAudited` adds region | + | Region in partial list |
| `addPartiallyAudited` uses current selection | + | Correct line range |
| `addPartiallyAudited` skips if file fully audited | - | No change to partial list |
| `mergePartialAudits` combines overlapping regions | + | Adjacent regions merged |
| `mergePartialAudits` combines adjacent regions | + | Touching regions merged |
| `mergePartialAudits` leaves disjoint regions separate | + | Gap preserved |
| `mergePartialAudits` handles single region | + | No change |
| `mergePartialAudits` handles empty list | + | No error |

---

## Phase 3: Workspace & Navigation (P1)

### Multi-Root Management

| Test | Type | Description |
|------|------|-------------|
| `createUniqueLabels` uses basename for single root | + | Simple label |
| `createUniqueLabels` disambiguates duplicate basenames | + | Adds parent directory |
| `recurseUniqueLabels` handles deeply nested duplicates | + | Continues until unique |
| `getCorrespondingRootAndPath` finds correct root | + | Returns [WARoot, relativePath] |
| `getCorrespondingRootAndPath` handles nested roots | + | Most specific root selected |
| `getCorrespondingRootAndPath` caches results | + | Second call uses cache |
| `getCorrespondingRootAndPath` handles file outside all roots | - | Returns undefined |
| `getAllCorrespondingRootsAndPaths` returns all matching roots | + | For nested roots |
| `isInThisWorkspaceRoot` returns true for file in root | + | Returns [true, relativePath] |
| `isInThisWorkspaceRoot` returns false for file outside | - | Returns [false, ""] |

### Permalinks

| Test | Type | Description |
|------|------|-------------|
| `getRemoteAndPermalink` generates GitHub URL | + | github.com format |
| `getRemoteAndPermalink` generates GitLab URL | + | gitlab.com format |
| `getRemoteAndPermalink` generates Bitbucket URL | + | bitbucket.org format |
| `getRemoteAndPermalink` handles single line | + | `#L10` format |
| `getRemoteAndPermalink` handles line range | + | `#L10-L20` format |
| `getRemoteAndPermalink` strips `.git` suffix | + | Clean URL |
| `getRemoteAndPermalink` handles SSH remote | + | Converts to HTTPS |
| `getRemoteAndPermalink` returns empty for missing remote | - | Empty string |
| `getClientPermalink` uses client remote | + | Different from audit remote |
| `copyEntryPermalinks` uses configured separator | + | Newline or custom |
| `copyEntryPermalinks` includes all locations | + | Multi-location entry |

### Navigation

| Test | Type | Description |
|------|------|-------------|
| `navigateToNextPartiallyAuditedRegion` moves to next region | + | Opens correct line |
| `navigateToNextPartiallyAuditedRegion` wraps to first region | + | After last region |
| `navigateToNextPartiallyAuditedRegion` handles single region | + | Stays on same region |
| `navigateToNextPartiallyAuditedRegion` handles no regions | - | No navigation |
| `navigateToNextPartiallyAuditedRegion` handles multi-file | + | Crosses file boundaries |

---

## Phase 4: Tree Views & Webviews (P2)

### Tree Data Provider

| Test | Type | Description |
|------|------|-------------|
| `getChildrenLinear` returns all entries flat | + | No nesting |
| `getChildrenLinear` returns empty for no entries | + | Empty array |
| `getChildrenPerFile` groups by file path | + | PathOrganizer parents |
| `getChildrenPerFile` returns entries under path | + | Correct children |
| `getTreeItem` returns bug icon for finding | + | ThemeIcon("bug") |
| `getTreeItem` returns bookmark icon for note | + | ThemeIcon("bookmark") |
| `getTreeItem` sets correct command | + | openFileLines command |
| `getTreeItem` sets tooltip with author | + | Author name in tooltip |
| Drag-and-drop reorders entries | + | Order changes |
| Drag-and-drop moves location to different entry | + | Re-parenting works |
| Drag-and-drop rejects invalid drop target | - | No change |

### MultipleSavedFindingsTree

| Test | Type | Description |
|------|------|-------------|
| `getChildren` returns roots for multi-root | + | WorkspaceRootEntry list |
| `getChildren` returns configs for single root | + | ConfigurationEntry list |
| `getChildren` returns configs under root | + | Filtered by root label |
| `getTreeItem` shows username as label | + | Correct label |
| `getTreeItem` shows filename as description | + | `.weaudit` filename |
| `getTreeItem` shows eye icon for active config | + | Icon when selected |
| `findAndLoadConfigurationFiles` finds `.weaudit` files | + | All files discovered |
| `findAndLoadConfigurationFiles` handles missing `.vscode` | - | No error |

### ResolvedEntriesTree

| Test | Type | Description |
|------|------|-------------|
| `getChildren` returns resolved entries | + | All resolved entries |
| `getChildren` returns empty for no resolved | + | Empty array |
| `getTreeItem` uses correct icon by type | + | Bug vs bookmark |
| `setResolvedEntries` triggers refresh | + | Event emitted |

### Webview Message Handlers

| Test | Type | Description |
|------|------|-------------|
| `update-entry` updates field value | + | Field changed |
| `update-entry` persists when `isPersistent` true | + | Saved to file |
| `update-entry` skips persist when false | + | Not saved |
| `update-repository-config` updates all fields | + | Client, audit, hash |
| `choose-workspace-root` switches active root | + | Root changed |
| `webview-ready` sends initial data | + | Entry details sent |
| `set-workspace-roots` populates dropdown | + | Root labels sent |
| Invalid message type ignored | - | No error |

### DecorationManager

| Test | Type | Description |
|------|------|-------------|
| Constructor loads all decoration types | + | 5 types created |
| `reloadAllDecorationConfigurations` disposes old | + | No memory leak |
| `reloadAllDecorationConfigurations` loads new colors | + | Config values used |
| `hoverOnLabel` creates correct range | + | Range matches input |
| `labelAfterFirstLineTextDecoration` adds after text | + | renderOptions set |
| Decoration uses gutter icon | + | gutterIconPath set |

---

## VS Code API Mocking

Create mock factories in `test/mocks/vscode.ts`:

```typescript
export function createMockWorkspaceFolder(path: string): vscode.WorkspaceFolder;
export function createMockTextEditor(uri: string, selection?: Range): vscode.TextEditor;
export function createMockExtensionContext(): vscode.ExtensionContext;
```

For webview tests, mock `acquireVsCodeApi()`:

```typescript
globalThis.acquireVsCodeApi = () => ({
  postMessage: sinon.stub(),
  getState: () => ({}),
  setState: sinon.stub(),
});
```

## Test Conventions

- Stub non-deterministic values: `Date.now()`, `crypto.randomUUID()`
- Write temp files to `os.tmpdir()/weaudit-test-*`, clean up in `afterEach`
- Use explicit assertions over snapshots; reserve snapshots for markdown export only
- Extension-host tests: use `vscode.commands.executeCommand`, not private methods

## CI Requirements

Extension-host tests require display server on Linux:

```yaml
- name: Run tests
  run: xvfb-run -a npm test
  env:
    DISPLAY: ':99'
```

Consider VS Code version matrix: `stable`, `insiders`.

## Phase 5: Extension Integration Tests (P2)

Extension-host tests run inside a real VS Code instance via `@vscode/test-electron`. These tests verify that the extension integrates correctly with VS Code APIs.

### Test Layout

```
test/extension/
├── suite/
│   ├── index.ts           # Mocha test runner configuration
│   ├── activation.test.ts # Extension activation tests
│   ├── commands.test.ts   # Command registration and execution
│   ├── treeViews.test.ts  # Tree view integration
│   ├── decorations.test.ts# Editor decorations
│   └── workspace.test.ts  # Workspace and file operations
└── fixtures/
    └── sample-workspace/  # Test workspace with sample files
```

### Extension Activation

| Test | Type | Description |
|------|------|-------------|
| Extension activates on workspace open | + | `onStartupFinished` trigger |
| Extension activates on view open | + | `onView:weAudit` trigger |
| Extension exports public API | + | `activate()` returns expected API |
| Extension registers all commands | + | All 30+ commands available |
| Extension creates tree views | + | All 5 views registered |
| Extension handles missing `.vscode` folder | + | Creates folder on first save |
| Extension handles corrupt `.weaudit` file | - | Graceful degradation, shows warning |

### Command Execution

| Test | Type | Description |
|------|------|-------------|
| `weAudit.addFinding` creates finding at selection | + | Entry added to tree |
| `weAudit.addFinding` prompts for label | + | Input box shown |
| `weAudit.addFinding` cancels on escape | - | No entry created |
| `weAudit.addNote` creates note at selection | + | Note entry added |
| `weAudit.editEntryLabel` updates existing label | + | Label changed in tree |
| `weAudit.deleteEntry` removes entry | + | Entry removed from tree |
| `weAudit.deleteEntry` handles multi-location entry | + | All locations removed |
| `weAudit.toggleAudited` marks file as reviewed | + | Decoration applied |
| `weAudit.toggleAudited` unmarks reviewed file | + | Decoration removed |
| `weAudit.addPartiallyAudited` marks region | + | Region decorated |
| `weAudit.resolveFinding` moves to resolved tree | + | Entry in resolved view |
| `weAudit.restoreFinding` moves back to active | + | Entry in main view |
| `weAudit.copyPermalink` copies to clipboard | + | Clipboard contains URL |
| `weAudit.copyClientPermalink` uses client remote | + | Different URL than audit |
| `weAudit.openGitHubIssue` opens external URL | + | URL contains finding data |
| `weAudit.exportFindings` creates markdown file | + | Valid markdown output |
| `weAudit.showDayLog` displays log in output | + | Output channel shown |
| `weAudit.navigateToNextPartiallyAuditedRegion` moves cursor | + | Selection changes |
| `weAudit.setTreeViewMode` toggles view mode | + | Tree refreshes |

### Tree View Integration

| Test | Type | Description |
|------|------|-------------|
| Findings tree view shows entries | + | Tree populated |
| Findings tree view updates on add | + | New entry appears |
| Findings tree view updates on delete | + | Entry disappears |
| Findings tree view click opens file | + | Editor opens at line |
| Findings tree view context menu appears | + | Menu items available |
| Resolved tree view shows resolved entries | + | Resolved entries visible |
| Saved findings tree shows `.weaudit` files | + | Config files listed |
| Saved findings tree toggles visibility | + | Eye icon toggles |
| Tree view drag-and-drop reorders | + | Order persists |
| Tree view refresh command works | + | Tree rebuilds |

### Editor Decorations

| Test | Type | Description |
|------|------|-------------|
| Finding decorations appear on marked lines | + | Background color visible |
| Note decorations appear on marked lines | + | Different color than findings |
| Audited file decoration covers all lines | + | Whole file decorated |
| Partial audit decoration covers region only | + | Only selected lines |
| Decorations update on file edit | + | Lines shift correctly |
| Decorations clear on entry delete | + | No lingering decoration |
| Gutter icons appear for findings | + | Icon in gutter |
| Hover shows finding label | + | Hover message displayed |
| Decoration colors respect configuration | + | Custom colors applied |
| Theme change updates decorations | + | Colors adapt |

### Webview Panels

| Test | Type | Description |
|------|------|-------------|
| Finding details panel opens | + | Webview visible |
| Finding details panel shows entry data | + | Fields populated |
| Finding details panel updates on selection | + | Data changes |
| Finding details panel saves changes | + | Persisted to file |
| Git config panel opens | + | Webview visible |
| Git config panel shows repository URLs | + | Fields populated |
| Git config panel saves changes | + | Config updated |
| Webview survives editor close/reopen | + | State preserved |

### Workspace Operations

| Test | Type | Description |
|------|------|-------------|
| Single-root workspace loads findings | + | Tree populated |
| Multi-root workspace loads all roots | + | All roots visible |
| Adding workspace folder updates tree | + | New root appears |
| Removing workspace folder updates tree | + | Root removed |
| File rename updates entry locations | + | Paths corrected |
| File delete prompts for entry removal | + | User prompted |
| External `.weaudit` change reloads | + | File watcher triggers |
| Configuration change updates behavior | + | Settings respected |

### File Decorations (Explorer)

| Test | Type | Description |
|------|------|-------------|
| Audited files show badge in explorer | + | Badge visible |
| Partially audited files show different badge | + | Distinct indicator |
| Badge updates on audit toggle | + | Real-time update |
| Badge respects file filter | + | Hidden files excluded |

### Error Handling

| Test | Type | Description |
|------|------|-------------|
| Invalid selection shows error message | - | User-friendly error |
| Missing workspace shows warning | - | Prompts to open folder |
| Git remote not configured shows warning | - | Guidance message |
| Concurrent saves handled correctly | + | No data corruption |
| Large file handling doesn't freeze UI | + | Responsive during operation |

### Performance

| Test | Type | Description |
|------|------|-------------|
| Extension activates under 500ms | + | Startup time acceptable |
| Tree view renders 100 entries under 100ms | + | No visible lag |
| File decoration applies under 50ms | + | Immediate visual feedback |
| Large `.weaudit` file (1000 entries) loads | + | No timeout |

---

## Extension Test Setup

### Test Runner Configuration

Create `test/extension/suite/index.ts`:

```typescript
import * as path from "path";
import Mocha from "mocha";
import { glob } from "glob";

export async function run(): Promise<void> {
    const mocha = new Mocha({
        ui: "bdd",
        color: true,
        timeout: 60000,
    });

    const testsRoot = path.resolve(__dirname, "..");
    const files = await glob("**/**.test.js", { cwd: testsRoot });

    files.forEach((f) => mocha.addFile(path.resolve(testsRoot, f)));

    return new Promise((resolve, reject) => {
        mocha.run((failures) => {
            if (failures > 0) {
                reject(new Error(`${failures} tests failed.`));
            } else {
                resolve();
            }
        });
    });
}
```

### Sample Test File

Create `test/extension/suite/activation.test.ts`:

```typescript
import * as assert from "assert";
import * as vscode from "vscode";

suite("Extension Activation", () => {
    test("Extension should be present", () => {
        const extension = vscode.extensions.getExtension("trailofbits.weaudit");
        assert.ok(extension, "Extension not found");
    });

    test("Extension should activate", async () => {
        const extension = vscode.extensions.getExtension("trailofbits.weaudit");
        await extension?.activate();
        assert.strictEqual(extension?.isActive, true);
    });

    test("Commands should be registered", async () => {
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes("weAudit.addFinding"));
        assert.ok(commands.includes("weAudit.addNote"));
        assert.ok(commands.includes("weAudit.toggleAudited"));
    });
});
```

### Test Workspace Fixture

Create `test/extension/fixtures/sample-workspace/` with:
- `.vscode/settings.json`
- `src/sample.ts` (sample code file)
- `.vscode/testuser.weaudit` (pre-populated findings)

---

## Scripts

```json
{
  "test": "npm run test:unit && npm run test:ext",
  "test:unit": "mocha -r ts-node/register 'test/unit/**/*.test.ts'",
  "test:ext": "vscode-test",
  "coverage": "nyc npm run test:unit"
}
```
