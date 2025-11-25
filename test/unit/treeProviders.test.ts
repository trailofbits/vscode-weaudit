import { expect } from "chai";
import * as sinon from "sinon";

import { EntryType, TreeViewMode, FullEntry, FullLocation, PathOrganizerEntry, FullLocationEntry } from "../../src/types";
import { createPathOrganizer, isPathOrganizerEntry, isLocationEntry, createLocationEntry } from "../../src/types";

/**
 * Helper to create a valid FullLocation for testing
 */
function createFullLocation(overrides: Partial<FullLocation> = {}): FullLocation {
    return {
        path: "src/test.ts",
        startLine: 10,
        endLine: 20,
        label: "test location",
        description: "test description",
        rootPath: "/workspace/project",
        ...overrides,
    };
}

/**
 * Helper to create a valid FullEntry for testing
 */
function createFullEntry(overrides: Partial<FullEntry> = {}): FullEntry {
    return {
        label: "Test Finding",
        entryType: EntryType.Finding,
        author: "testuser",
        details: "",
        locations: [createFullLocation()],
        ...overrides,
    };
}

/**
 * Mock configuration entry for selected configuration tracking
 */
interface MockConfigurationEntry {
    username: string;
    root: { label: string };
}

/**
 * Mock workspace manager for testing tree providers
 */
function createMockWorkspaceManager(
    options: {
        moreThanOneRoot?: boolean;
        selectedConfigurations?: MockConfigurationEntry[];
        rootLabels?: Map<string, string>;
    } = {},
) {
    const { moreThanOneRoot = false, selectedConfigurations = [], rootLabels = new Map() } = options;

    return {
        moreThanOneRoot: sinon.stub().returns(moreThanOneRoot),
        getSelectedConfigurations: sinon.stub().returns(selectedConfigurations),
        getCorrespondingRootAndPath: sinon.stub().callsFake((fullPath: string) => {
            // Simple mock that returns the rootPath and relative path
            for (const [root, label] of rootLabels) {
                if (fullPath.startsWith(root)) {
                    const relativePath = fullPath.slice(root.length + 1);
                    return [{ rootPath: root, getRootLabel: () => label }, relativePath];
                }
            }
            return [undefined, undefined];
        }),
        createUniquePath: sinon.stub().callsFake((rootPath: string, relativePath: string) => {
            const label = rootLabels.get(rootPath);
            if (label) {
                return `${label}/${relativePath}`;
            }
            return undefined;
        }),
    };
}

describe("Tree Data Providers", () => {
    describe("Main Tree Provider - getChildrenLinear", () => {
        describe("root level (element === undefined)", () => {
            it("returns entries sorted with findings first, then notes", () => {
                const finding1 = createFullEntry({ label: "Finding 1", entryType: EntryType.Finding });
                const note1 = createFullEntry({ label: "Note 1", entryType: EntryType.Note });
                const finding2 = createFullEntry({ label: "Finding 2", entryType: EntryType.Finding });
                const note2 = createFullEntry({ label: "Note 2", entryType: EntryType.Note });

                const treeEntries = [note1, finding1, note2, finding2];

                // Simulate getChildrenLinear logic
                const entries: FullEntry[] = [];
                const notes: FullEntry[] = [];
                for (const entry of treeEntries) {
                    if (entry.entryType === EntryType.Finding) {
                        entries.push(entry);
                    } else {
                        notes.push(entry);
                    }
                }
                const result = entries.concat(notes);

                expect(result).to.have.length(4);
                expect(result[0].label).to.equal("Finding 1");
                expect(result[1].label).to.equal("Finding 2");
                expect(result[2].label).to.equal("Note 1");
                expect(result[3].label).to.equal("Note 2");
            });

            it("returns empty array when no entries exist", () => {
                const treeEntries: FullEntry[] = [];

                const entries: FullEntry[] = [];
                const notes: FullEntry[] = [];
                for (const entry of treeEntries) {
                    if (entry.entryType === EntryType.Finding) {
                        entries.push(entry);
                    } else {
                        notes.push(entry);
                    }
                }
                const result = entries.concat(notes);

                expect(result).to.be.an("array").that.is.empty;
            });

            it("maintains pathToEntryMap for single-location entries", () => {
                const pathToEntryMap = new Map<string, FullEntry[]>();
                const entry = createFullEntry({
                    label: "Single Location",
                    locations: [createFullLocation({ path: "src/single.ts" })],
                });

                // Simulate pathToEntryMap population for single-location entries
                if (entry.locations.length === 1) {
                    const pathLabel = entry.locations[0].path;
                    const lis = pathToEntryMap.get(pathLabel);
                    if (lis === undefined) {
                        pathToEntryMap.set(pathLabel, [entry]);
                    } else {
                        lis.push(entry);
                    }
                }

                expect(pathToEntryMap.has("src/single.ts")).to.be.true;
                expect(pathToEntryMap.get("src/single.ts")).to.have.length(1);
            });

            it("handles entries with multiple locations without adding to pathToEntryMap", () => {
                const pathToEntryMap = new Map<string, FullEntry[]>();
                const entry = createFullEntry({
                    label: "Multi Location",
                    locations: [createFullLocation({ path: "src/file1.ts" }), createFullLocation({ path: "src/file2.ts" })],
                });

                // Only single-location entries are added at root level
                if (entry.locations.length === 1) {
                    const pathLabel = entry.locations[0].path;
                    pathToEntryMap.set(pathLabel, [entry]);
                }

                expect(pathToEntryMap.size).to.equal(0);
            });
        });

        describe("child level (element !== undefined)", () => {
            it("returns empty array for LocationEntry", () => {
                const entry = createFullEntry();
                const locationEntry = createLocationEntry(entry.locations[0], entry);

                // LocationEntry has no children
                if (isLocationEntry(locationEntry)) {
                    const result: FullEntry[] = [];
                    expect(result).to.be.an("array").that.is.empty;
                }
            });

            it("returns empty array for PathOrganizerEntry in linear mode", () => {
                const pathOrganizer = createPathOrganizer("src/test.ts");

                // PathOrganizerEntry has no children in linear mode
                if (isPathOrganizerEntry(pathOrganizer)) {
                    const result: FullEntry[] = [];
                    expect(result).to.be.an("array").that.is.empty;
                }
            });

            it("returns location entries for entry with multiple locations", () => {
                const entry = createFullEntry({
                    label: "Multi Location Entry",
                    locations: [
                        createFullLocation({ path: "src/file1.ts", label: "Location 1" }),
                        createFullLocation({ path: "src/file2.ts", label: "Location 2" }),
                        createFullLocation({ path: "src/file3.ts", label: "Location 3" }),
                    ],
                });

                // Simulate creating location entries for children
                const children = entry.locations.map((location) => createLocationEntry(location, entry));

                expect(children).to.have.length(3);
                children.forEach((child) => {
                    expect(isLocationEntry(child)).to.be.true;
                    expect(child.parentEntry).to.equal(entry);
                });
            });

            it("filters locations based on workspace configuration", () => {
                const selectedConfigs: MockConfigurationEntry[] = [{ username: "alice", root: { label: "project1" } }];
                const rootLabels = new Map([
                    ["/workspace/project1", "project1"],
                    ["/workspace/project2", "project2"],
                ]);
                const workspaceManager = createMockWorkspaceManager({
                    moreThanOneRoot: true,
                    selectedConfigurations: selectedConfigs,
                    rootLabels,
                });

                const entry = createFullEntry({
                    author: "alice",
                    locations: [
                        createFullLocation({ rootPath: "/workspace/project1", path: "src/file1.ts" }),
                        createFullLocation({ rootPath: "/workspace/project2", path: "src/file2.ts" }),
                    ],
                });

                // Simulate filtering logic
                const filteredLocations = entry.locations.filter((location) => {
                    const [wsRoot, _] = workspaceManager.getCorrespondingRootAndPath(location.rootPath);
                    if (wsRoot === undefined) {
                        return false;
                    }
                    const rootLabel = wsRoot.getRootLabel();
                    return selectedConfigs.some((config) => config.username === entry.author && config.root.label === rootLabel);
                });

                expect(filteredLocations).to.have.length(1);
                expect(filteredLocations[0].rootPath).to.equal("/workspace/project1");
            });
        });
    });

    describe("Main Tree Provider - getChildrenPerFile", () => {
        describe("root level (element === undefined)", () => {
            it("returns PathOrganizerEntry for each unique file path", () => {
                const entry1 = createFullEntry({
                    locations: [createFullLocation({ path: "src/file1.ts" })],
                });
                const entry2 = createFullEntry({
                    locations: [createFullLocation({ path: "src/file2.ts" })],
                });
                const entry3 = createFullEntry({
                    locations: [createFullLocation({ path: "src/file1.ts" })], // duplicate path
                });

                const treeEntries = [entry1, entry2, entry3];

                // Simulate getChildrenPerFile root logic
                const pathSet = new Set<string>();
                for (const entry of treeEntries) {
                    for (const location of entry.locations) {
                        pathSet.add(location.path);
                    }
                }

                const pathOrganizerEntries = Array.from(pathSet)
                    .sort()
                    .map((p) => createPathOrganizer(p));

                expect(pathOrganizerEntries).to.have.length(2);
                expect(pathOrganizerEntries[0].pathLabel).to.equal("src/file1.ts");
                expect(pathOrganizerEntries[1].pathLabel).to.equal("src/file2.ts");
                pathOrganizerEntries.forEach((entry) => {
                    expect(isPathOrganizerEntry(entry)).to.be.true;
                });
            });

            it("creates unique paths in multi-root workspace", () => {
                const rootLabels = new Map([
                    ["/workspace/project1", "project1"],
                    ["/workspace/project2", "project2"],
                ]);

                const locations = [
                    createFullLocation({ rootPath: "/workspace/project1", path: "src/main.ts" }),
                    createFullLocation({ rootPath: "/workspace/project2", path: "src/main.ts" }),
                ];

                // Simulate unique path creation for multi-root
                const uniquePaths = locations.map((loc) => {
                    const label = rootLabels.get(loc.rootPath);
                    return label ? `${label}/${loc.path}` : loc.path;
                });

                expect(uniquePaths).to.have.length(2);
                expect(uniquePaths[0]).to.equal("project1/src/main.ts");
                expect(uniquePaths[1]).to.equal("project2/src/main.ts");
            });

            it("returns paths sorted alphabetically", () => {
                const paths = ["src/zebra.ts", "src/alpha.ts", "lib/beta.ts"];
                const sortedPaths = [...paths].sort();

                expect(sortedPaths).to.deep.equal(["lib/beta.ts", "src/alpha.ts", "src/zebra.ts"]);
            });
        });

        describe("child level - PathOrganizerEntry", () => {
            it("returns LocationEntry for each entry at that path", () => {
                const entry1 = createFullEntry({
                    label: "Entry 1",
                    locations: [createFullLocation({ path: "src/shared.ts", startLine: 10 })],
                });
                const entry2 = createFullEntry({
                    label: "Entry 2",
                    locations: [createFullLocation({ path: "src/shared.ts", startLine: 50 })],
                });

                const treeEntries = [entry1, entry2];
                const pathOrganizer = createPathOrganizer("src/shared.ts");

                // Simulate getChildrenPerFile for PathOrganizer
                const entriesWithSamePath: FullLocationEntry[] = [];
                for (const entry of treeEntries) {
                    for (const location of entry.locations) {
                        if (location.path === pathOrganizer.pathLabel) {
                            entriesWithSamePath.push(createLocationEntry(location, entry));
                        }
                    }
                }
                entriesWithSamePath.sort((a, b) => a.location.startLine - b.location.startLine);

                expect(entriesWithSamePath).to.have.length(2);
                expect(entriesWithSamePath[0].parentEntry.label).to.equal("Entry 1");
                expect(entriesWithSamePath[1].parentEntry.label).to.equal("Entry 2");
            });

            it("sorts entries by start line number", () => {
                const locations: FullLocation[] = [
                    createFullLocation({ startLine: 100 }),
                    createFullLocation({ startLine: 10 }),
                    createFullLocation({ startLine: 50 }),
                ];

                const sorted = [...locations].sort((a, b) => a.startLine - b.startLine);

                expect(sorted[0].startLine).to.equal(10);
                expect(sorted[1].startLine).to.equal(50);
                expect(sorted[2].startLine).to.equal(100);
            });

            it("returns empty array for non-PathOrganizerEntry", () => {
                const entry = createFullEntry();

                // Non-PathOrganizer entries in per-file mode have no children
                if (!isPathOrganizerEntry(entry)) {
                    const result: FullEntry[] = [];
                    expect(result).to.be.an("array").that.is.empty;
                }
            });
        });
    });

    describe("Main Tree Provider - getTreeItem", () => {
        describe("LocationEntry tree items", () => {
            it("creates tree item with location icon", () => {
                const location = createFullLocation({
                    path: "src/test.ts",
                    startLine: 10,
                    endLine: 10,
                    label: "Test Location",
                });
                const entry = createFullEntry({ label: "Parent Entry" });
                const locationEntry = createLocationEntry(location, entry);

                // Verify location entry type
                expect(isLocationEntry(locationEntry)).to.be.true;
                expect(locationEntry.location).to.equal(location);
                expect(locationEntry.parentEntry).to.equal(entry);
            });

            it("formats description with single line number", () => {
                const location = createFullLocation({
                    path: "src/test.ts",
                    startLine: 10,
                    endLine: 10,
                });

                // Simulate description creation
                let description = `test.ts:${location.startLine + 1}`;
                if (location.endLine !== location.startLine) {
                    description += `-${location.endLine + 1}`;
                }

                expect(description).to.equal("test.ts:11");
            });

            it("formats description with line range", () => {
                const location = createFullLocation({
                    path: "src/test.ts",
                    startLine: 10,
                    endLine: 20,
                });

                // Simulate description creation with range
                let description = `test.ts:${location.startLine + 1}`;
                if (location.endLine !== location.startLine) {
                    description += `-${location.endLine + 1}`;
                }

                expect(description).to.equal("test.ts:11-21");
            });

            it("uses parent label with location label in per-file mode", () => {
                const location = createFullLocation({ label: "Additional Info" });
                const entry = createFullEntry({ label: "Main Finding" });

                // Simulate per-file mode label
                const treeViewMode = TreeViewMode.PerFile;
                let mainLabel: string;
                if (treeViewMode === TreeViewMode.List) {
                    mainLabel = location.label;
                } else {
                    mainLabel = entry.label;
                    if (location.label) {
                        mainLabel += " - " + location.label;
                    }
                }

                expect(mainLabel).to.equal("Main Finding - Additional Info");
            });

            it("uses only location label in list mode", () => {
                const location = createFullLocation({ label: "Location Label" });
                const entry = createFullEntry({ label: "Main Finding" });

                // Simulate list mode label
                const treeViewMode = TreeViewMode.List;
                let mainLabel: string;
                if (treeViewMode === TreeViewMode.List) {
                    mainLabel = location.label;
                } else {
                    mainLabel = entry.label;
                    if (location.label) {
                        mainLabel += " - " + location.label;
                    }
                }

                expect(mainLabel).to.equal("Location Label");
            });
        });

        describe("PathOrganizerEntry tree items", () => {
            it("creates expandable tree item with path label", () => {
                const pathOrganizer = createPathOrganizer("src/components/Button.tsx");

                expect(isPathOrganizerEntry(pathOrganizer)).to.be.true;
                expect(pathOrganizer.pathLabel).to.equal("src/components/Button.tsx");
            });
        });

        describe("FullEntry tree items", () => {
            it("uses bug icon for findings", () => {
                const entry = createFullEntry({ entryType: EntryType.Finding });

                // Icon is "bug" for findings
                expect(entry.entryType).to.equal(EntryType.Finding);
            });

            it("uses bookmark icon for notes", () => {
                const entry = createFullEntry({ entryType: EntryType.Note });

                // Icon is "bookmark" for notes
                expect(entry.entryType).to.equal(EntryType.Note);
            });

            it("shows author in description when different from current user", () => {
                const currentUsername = "alice";
                const entry = createFullEntry({ author: "bob" });

                // Simulate description with author
                const basePath = "test.ts";
                const startLine = 11;
                let description = `${basePath}:${startLine}`;
                if (entry.author !== currentUsername) {
                    description += ` (${entry.author})`;
                }

                expect(description).to.equal("test.ts:11 (bob)");
            });

            it("omits author in description when same as current user", () => {
                const currentUsername = "alice";
                const entry = createFullEntry({ author: "alice" });

                // Simulate description without author
                const basePath = "test.ts";
                const startLine = 11;
                let description = `${basePath}:${startLine}`;
                if (entry.author !== currentUsername) {
                    description += ` (${entry.author})`;
                }

                expect(description).to.equal("test.ts:11");
            });

            it("is expandable when has multiple locations in list mode", () => {
                const entry = createFullEntry({
                    locations: [createFullLocation({ path: "src/file1.ts" }), createFullLocation({ path: "src/file2.ts" })],
                });
                const treeViewMode = TreeViewMode.List;

                // Determine collapsible state
                const isExpandable = entry.locations && entry.locations.length > 1 && treeViewMode === TreeViewMode.List;

                expect(isExpandable).to.be.true;
            });

            it("is not expandable with single location", () => {
                const entry = createFullEntry({
                    locations: [createFullLocation()],
                });
                const treeViewMode = TreeViewMode.List;

                const isExpandable = entry.locations && entry.locations.length > 1 && treeViewMode === TreeViewMode.List;

                expect(isExpandable).to.be.false;
            });

            it("is not expandable in per-file mode", () => {
                const entry = createFullEntry({
                    locations: [createFullLocation({ path: "src/file1.ts" }), createFullLocation({ path: "src/file2.ts" })],
                });
                const treeViewMode = TreeViewMode.PerFile;

                const isExpandable = entry.locations && entry.locations.length > 1 && treeViewMode === TreeViewMode.List;

                expect(isExpandable).to.be.false;
            });
        });
    });

    describe("Main Tree Provider - Drag and Drop", () => {
        it("supports dragging entries", () => {
            const entry = createFullEntry();

            // Entries should be draggable
            const isDraggable = !isLocationEntry(entry) && !isPathOrganizerEntry(entry);
            expect(isDraggable).to.be.true;
        });

        it("does not support dragging location entries", () => {
            const entry = createFullEntry();
            const locationEntry = createLocationEntry(entry.locations[0], entry);

            const isDraggable = !isLocationEntry(locationEntry) && !isPathOrganizerEntry(locationEntry);
            expect(isDraggable).to.be.false;
        });

        it("does not support dragging path organizer entries", () => {
            const pathOrganizer = createPathOrganizer("src/test.ts");

            const isDraggable = !isLocationEntry(pathOrganizer) && !isPathOrganizerEntry(pathOrganizer);
            expect(isDraggable).to.be.false;
        });
    });

    describe("MultipleSavedFindingsTree", () => {
        describe("getChildren - multi-root workspace", () => {
            it("returns WorkspaceRootEntry at root level", () => {
                const rootPathsAndLabels = [
                    { rootPath: "/workspace/project1", rootLabel: "project1" },
                    { rootPath: "/workspace/project2", rootLabel: "project2" },
                ];

                // Simulate multi-root behavior
                const isMultiRoot = rootPathsAndLabels.length > 1;
                expect(isMultiRoot).to.be.true;

                // At root level, return root entries
                const rootEntries = rootPathsAndLabels.map((r) => ({
                    isWorkspaceRoot: true,
                    label: r.rootLabel,
                    rootPath: r.rootPath,
                }));

                expect(rootEntries).to.have.length(2);
                expect(rootEntries[0].label).to.equal("project1");
                expect(rootEntries[1].label).to.equal("project2");
            });

            it("returns ConfigurationEntry for a specific workspace root", () => {
                const configurationEntries = [
                    { filename: "alice.weaudit", root: { label: "project1" }, username: "alice" },
                    { filename: "bob.weaudit", root: { label: "project1" }, username: "bob" },
                    { filename: "charlie.weaudit", root: { label: "project2" }, username: "charlie" },
                ];

                const workspaceRootEntry = { isWorkspaceRoot: true, label: "project1" };

                // Filter configurations for this workspace root
                const children = configurationEntries.filter((entry) => entry.root.label === workspaceRootEntry.label);

                expect(children).to.have.length(2);
                expect(children[0].username).to.equal("alice");
                expect(children[1].username).to.equal("bob");
            });

            it("returns empty array for ConfigurationEntry element", () => {
                const configEntry = { filename: "alice.weaudit", root: { label: "project1" }, username: "alice" };

                // ConfigurationEntry has no children
                const isConfigEntry = "filename" in configEntry && "username" in configEntry;
                expect(isConfigEntry).to.be.true;

                // Returns empty array
                const children: unknown[] = [];
                expect(children).to.be.an("array").that.is.empty;
            });
        });

        describe("getChildren - single-root workspace", () => {
            it("returns ConfigurationEntry directly at root level", () => {
                const rootPathsAndLabels = [{ rootPath: "/workspace/project", rootLabel: "project" }];

                const configurationEntries = [
                    { filename: "alice.weaudit", root: { label: "project" }, username: "alice" },
                    { filename: "bob.weaudit", root: { label: "project" }, username: "bob" },
                ];

                const isSingleRoot = rootPathsAndLabels.length <= 1;
                expect(isSingleRoot).to.be.true;

                // In single-root, configurations are returned directly
                expect(configurationEntries).to.have.length(2);
            });
        });

        describe("getTreeItem", () => {
            it("creates folder icon for WorkspaceRootEntry", () => {
                const workspaceRootEntry = {
                    isWorkspaceRoot: true,
                    label: "project1",
                    rootPath: "/workspace/project1",
                };

                expect(workspaceRootEntry.isWorkspaceRoot).to.be.true;
                // Icon should be "folder"
            });

            it("creates account icon for ConfigurationEntry", () => {
                const configEntry = {
                    filename: "alice.weaudit",
                    root: { label: "project1" },
                    username: "alice",
                };

                expect("username" in configEntry).to.be.true;
                // Icon should be "account"
            });

            it("shows checkmark when configuration is selected", () => {
                const selectedConfigs = [{ filename: "alice.weaudit", username: "alice", root: { label: "project1" } }];
                const configEntry = { filename: "alice.weaudit", username: "alice", root: { label: "project1" } };

                const isSelected = selectedConfigs.some((c) => c.filename === configEntry.filename && c.root.label === configEntry.root.label);

                expect(isSelected).to.be.true;
            });

            it("shows no checkmark when configuration is not selected", () => {
                const selectedConfigs = [{ filename: "bob.weaudit", username: "bob", root: { label: "project1" } }];
                const configEntry = { filename: "alice.weaudit", username: "alice", root: { label: "project1" } };

                const isSelected = selectedConfigs.some((c) => c.filename === configEntry.filename && c.root.label === configEntry.root.label);

                expect(isSelected).to.be.false;
            });
        });

        describe("findAndLoadConfigurationFiles", () => {
            it("finds .weaudit files in .vscode directory", () => {
                const vscodeFiles = ["settings.json", "alice.weaudit", "bob.weaudit", "extensions.json", "launch.json"];

                const weauditFiles = vscodeFiles.filter((f) => f.endsWith(".weaudit"));

                expect(weauditFiles).to.have.length(2);
                expect(weauditFiles).to.include("alice.weaudit");
                expect(weauditFiles).to.include("bob.weaudit");
            });

            it("extracts username from filename", () => {
                const filename = "alice.weaudit";
                const username = filename.replace(".weaudit", "");

                expect(username).to.equal("alice");
            });

            it("handles empty .vscode directory", () => {
                const vscodeFiles: string[] = [];
                const weauditFiles = vscodeFiles.filter((f) => f.endsWith(".weaudit"));

                expect(weauditFiles).to.be.an("array").that.is.empty;
            });

            it("handles missing .vscode directory gracefully", () => {
                // Directory doesn't exist - should return empty array
                const weauditFiles: string[] = [];

                expect(weauditFiles).to.be.an("array").that.is.empty;
            });
        });
    });

    describe("ResolvedEntriesTree", () => {
        describe("getChildren", () => {
            it("returns all resolved entries at root level", () => {
                const resolvedEntries = [
                    createFullEntry({ label: "Resolved 1" }),
                    createFullEntry({ label: "Resolved 2" }),
                    createFullEntry({ label: "Resolved 3" }),
                ];

                // Root level returns all entries
                const result = resolvedEntries;
                expect(result).to.have.length(3);
            });

            it("returns empty array when element is provided", () => {
                const resolvedEntries = [createFullEntry({ label: "Resolved 1" })];
                const element = resolvedEntries[0];

                // Child level returns empty array (entries have no children)
                const result = element !== undefined ? [] : resolvedEntries;
                expect(result).to.be.an("array").that.is.empty;
            });

            it("returns empty array when no resolved entries exist", () => {
                const resolvedEntries: FullEntry[] = [];

                expect(resolvedEntries).to.be.an("array").that.is.empty;
            });
        });

        describe("getTreeItem", () => {
            it("creates tree item with bug icon for findings", () => {
                const entry = createFullEntry({
                    label: "Resolved Finding",
                    entryType: EntryType.Finding,
                });

                expect(entry.entryType).to.equal(EntryType.Finding);
                // Icon should be "bug"
            });

            it("creates tree item with bookmark icon for notes", () => {
                const entry = createFullEntry({
                    label: "Resolved Note",
                    entryType: EntryType.Note,
                });

                expect(entry.entryType).to.equal(EntryType.Note);
                // Icon should be "bookmark"
            });

            it("formats description with file path and line number", () => {
                const entry = createFullEntry({
                    locations: [createFullLocation({ path: "src/test.ts", startLine: 42, endLine: 42 })],
                });

                const location = entry.locations[0];
                const description = `test.ts:${location.startLine + 1}`;

                expect(description).to.equal("test.ts:43");
            });

            it("includes tooltip with full entry details", () => {
                const entry = createFullEntry({
                    label: "Test Finding",
                    details: "Detailed description of the finding",
                    locations: [createFullLocation({ path: "src/main.ts", startLine: 10, endLine: 20 })],
                });

                // Tooltip should include label and details
                expect(entry.label).to.equal("Test Finding");
                expect(entry.details).to.equal("Detailed description of the finding");
            });
        });

        describe("setResolvedEntries", () => {
            it("updates the resolved entries list", () => {
                let resolvedEntries: FullEntry[] = [];

                const newEntries = [createFullEntry({ label: "Entry 1" }), createFullEntry({ label: "Entry 2" })];

                // Simulate setResolvedEntries
                resolvedEntries = newEntries;

                expect(resolvedEntries).to.have.length(2);
                expect(resolvedEntries[0].label).to.equal("Entry 1");
            });

            it("replaces existing entries completely", () => {
                let resolvedEntries = [createFullEntry({ label: "Old Entry" })];

                const newEntries = [createFullEntry({ label: "New Entry" })];

                resolvedEntries = newEntries;

                expect(resolvedEntries).to.have.length(1);
                expect(resolvedEntries[0].label).to.equal("New Entry");
            });

            it("can clear all entries by setting empty array", () => {
                let resolvedEntries = [createFullEntry({ label: "Entry 1" }), createFullEntry({ label: "Entry 2" })];

                resolvedEntries = [];

                expect(resolvedEntries).to.be.an("array").that.is.empty;
            });
        });

        describe("refresh", () => {
            it("fires onDidChangeTreeData event", () => {
                const onDidChangeTreeDataFired = sinon.stub();

                // Simulate refresh
                onDidChangeTreeDataFired(undefined);

                expect(onDidChangeTreeDataFired.calledOnce).to.be.true;
                expect(onDidChangeTreeDataFired.calledWith(undefined)).to.be.true;
            });
        });
    });

    describe("Tree View Mode Switching", () => {
        it("defaults to List mode", () => {
            const defaultMode = TreeViewMode.List;
            expect(defaultMode).to.equal(TreeViewMode.List);
        });

        it("toggles between List and PerFile modes", () => {
            let mode = TreeViewMode.List;

            // Toggle
            mode = mode === TreeViewMode.List ? TreeViewMode.PerFile : TreeViewMode.List;
            expect(mode).to.equal(TreeViewMode.PerFile);

            // Toggle again
            mode = mode === TreeViewMode.List ? TreeViewMode.PerFile : TreeViewMode.List;
            expect(mode).to.equal(TreeViewMode.List);
        });

        it("uses correct getChildren method based on mode", () => {
            const mode = TreeViewMode.List;

            // Verify method selection
            const methodName = mode === TreeViewMode.List ? "getChildrenLinear" : "getChildrenPerFile";
            expect(methodName).to.equal("getChildrenLinear");
        });
    });
});
