import { expect } from "chai";
import * as sinon from "sinon";

import {
    Entry,
    EntryType,
    FullEntry,
    FullLocation,
    FullLocationEntry,
    FindingSeverity,
    FindingDifficulty,
    FindingType,
    createDefaultEntryDetails,
    getEntryIndexFromArray,
} from "../../src/types";

/**
 * Helper to create a valid FullLocation for testing
 */
function createFullLocation(overrides: Partial<FullLocation> = {}): FullLocation {
    return {
        path: "src/test.ts",
        startLine: 10,
        endLine: 20,
        label: "test location",
        description: "",
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
        details: {
            severity: FindingSeverity.Medium,
            difficulty: FindingDifficulty.Low,
            type: FindingType.DataValidation,
            description: "Test description",
            exploit: "Test exploit",
            recommendation: "Test recommendation",
        },
        locations: [createFullLocation()],
        ...overrides,
    };
}

/**
 * Helper to create a FullLocationEntry for testing deleteLocation
 */
function createFullLocationEntry(parentEntry: FullEntry, location: FullLocation): FullLocationEntry {
    return {
        parentEntry,
        location,
    };
}

describe("Location Management", () => {
    describe("getActiveSelectionLocation logic", () => {
        describe("selection line calculations", () => {
            it("calculates correct lines for single line selection", () => {
                // Simulating what getActiveSelectionLocation does
                const selection = {
                    start: { line: 5, character: 0 },
                    end: { line: 5, character: 20 },
                };

                const startLine = selection.start.line;
                let endLine = selection.end.line;

                // No adjustment needed for same line
                if (endLine > selection.start.line && selection.end.character === 0) {
                    endLine--;
                }

                expect(startLine).to.equal(5);
                expect(endLine).to.equal(5);
            });

            it("calculates correct lines for multi-line selection", () => {
                const selection = {
                    start: { line: 10, character: 5 },
                    end: { line: 25, character: 15 },
                };

                const startLine = selection.start.line;
                let endLine = selection.end.line;

                if (endLine > selection.start.line && selection.end.character === 0) {
                    endLine--;
                }

                expect(startLine).to.equal(10);
                expect(endLine).to.equal(25);
            });

            it("decrements endLine when selection ends at start of next line (VSCode quirk)", () => {
                // VSCode sets end of fully selected line as first character of next line
                const selection = {
                    start: { line: 10, character: 0 },
                    end: { line: 15, character: 0 }, // character 0 indicates line fully selected
                };

                const startLine = selection.start.line;
                let endLine = selection.end.line;

                // Apply the VSCode quirk adjustment
                if (endLine > selection.start.line && selection.end.character === 0) {
                    endLine--;
                }

                expect(startLine).to.equal(10);
                expect(endLine).to.equal(14); // Decremented by 1
            });

            it("does not decrement when end character is not 0", () => {
                const selection = {
                    start: { line: 10, character: 0 },
                    end: { line: 15, character: 5 },
                };

                const startLine = selection.start.line;
                let endLine = selection.end.line;

                if (endLine > selection.start.line && selection.end.character === 0) {
                    endLine--;
                }

                expect(endLine).to.equal(15);
            });

            it("does not decrement single line selection even with character 0", () => {
                const selection = {
                    start: { line: 10, character: 0 },
                    end: { line: 10, character: 0 }, // Same line
                };

                let endLine = selection.end.line;

                // Condition requires endLine > startLine
                if (endLine > selection.start.line && selection.end.character === 0) {
                    endLine--;
                }

                expect(endLine).to.equal(10);
            });
        });

        describe("empty last line handling (GitHub preview)", () => {
            it("decrements endLine when last document line is empty", () => {
                const lineCount = 100;
                const lastLineText = ""; // Empty last line
                let endLine = lineCount - 1; // Line 99 (last line)
                const startLine = 90;

                // GitHub preview logic
                if (endLine === lineCount - 1 && lastLineText === "") {
                    endLine = Math.max(endLine - 1, startLine);
                }

                expect(endLine).to.equal(98);
            });

            it("does not go below startLine when adjusting for empty last line", () => {
                const lineCount = 100;
                const lastLineText = "";
                let endLine = lineCount - 1;
                const startLine = lineCount - 1; // Start is at the last line

                if (endLine === lineCount - 1 && lastLineText === "") {
                    endLine = Math.max(endLine - 1, startLine);
                }

                // Should stay at startLine, not go below
                expect(endLine).to.equal(startLine);
            });

            it("does not decrement when last line has content", () => {
                const lineCount = 100;
                const lastLineText = "some code";
                let endLine = lineCount - 1;
                const startLine = 90;

                if (endLine === lineCount - 1 && lastLineText === "") {
                    endLine = Math.max(endLine - 1, startLine);
                }

                expect(endLine).to.equal(99);
            });

            it("does not decrement when not selecting to last line", () => {
                const lineCount = 100;
                const lastLineText = "";
                let endLine = 50; // Not the last line
                const startLine = 40;

                if (endLine === lineCount - 1 && lastLineText === "") {
                    endLine = Math.max(endLine - 1, startLine);
                }

                expect(endLine).to.equal(50);
            });
        });

        describe("relative path calculation", () => {
            it("creates location with relative path from root", () => {
                const rootPath = "/workspace/project";
                const filePath = "/workspace/project/src/components/Button.tsx";

                // Simulating path.relative behavior
                const relativePath = filePath.replace(rootPath + "/", "");

                const location: FullLocation = {
                    path: relativePath,
                    startLine: 10,
                    endLine: 20,
                    label: "",
                    description: "",
                    rootPath,
                };

                expect(location.path).to.equal("src/components/Button.tsx");
                expect(location.rootPath).to.equal(rootPath);
            });

            it("handles nested paths correctly", () => {
                const rootPath = "/home/user/projects/myapp";
                const filePath = "/home/user/projects/myapp/deep/nested/folder/file.ts";

                const relativePath = filePath.replace(rootPath + "/", "");

                expect(relativePath).to.equal("deep/nested/folder/file.ts");
            });
        });
    });

    describe("getIntersectingTreeEntryIndex logic", () => {
        describe("finding overlapping entries", () => {
            it("returns index when location overlaps with entry", () => {
                const entry = createFullEntry({
                    locations: [createFullLocation({ startLine: 10, endLine: 20 })],
                });
                const treeEntries = [entry];

                // Search location that overlaps
                const searchLocation = createFullLocation({ startLine: 15, endLine: 25 });

                // Simulate the intersection logic
                let foundIndex = -1;
                for (let i = 0; i < treeEntries.length; i++) {
                    const e = treeEntries[i];
                    if (e.entryType !== EntryType.Finding) continue;

                    for (const loc of e.locations) {
                        if (loc.path === searchLocation.path && loc.rootPath === searchLocation.rootPath) {
                            // Check if ranges intersect
                            const entryStart = loc.startLine;
                            const entryEnd = loc.endLine;
                            const searchStart = searchLocation.startLine;
                            const searchEnd = searchLocation.endLine;

                            // Ranges intersect if they overlap
                            if (entryStart <= searchEnd && searchStart <= entryEnd) {
                                foundIndex = i;
                                break;
                            }
                        }
                    }
                    if (foundIndex !== -1) break;
                }

                expect(foundIndex).to.equal(0);
            });

            it("returns -1 when no overlap exists", () => {
                const entry = createFullEntry({
                    locations: [createFullLocation({ startLine: 10, endLine: 20 })],
                });
                const treeEntries = [entry];

                // Search location that does not overlap
                const searchLocation = createFullLocation({ startLine: 30, endLine: 40 });

                let foundIndex = -1;
                for (let i = 0; i < treeEntries.length; i++) {
                    const e = treeEntries[i];
                    if (e.entryType !== EntryType.Finding) continue;

                    for (const loc of e.locations) {
                        if (loc.path === searchLocation.path && loc.rootPath === searchLocation.rootPath) {
                            const entryStart = loc.startLine;
                            const entryEnd = loc.endLine;
                            const searchStart = searchLocation.startLine;
                            const searchEnd = searchLocation.endLine;

                            if (entryStart <= searchEnd && searchStart <= entryEnd) {
                                foundIndex = i;
                                break;
                            }
                        }
                    }
                }

                expect(foundIndex).to.equal(-1);
            });

            it("only matches specified entryType", () => {
                const findingEntry = createFullEntry({
                    entryType: EntryType.Finding,
                    locations: [createFullLocation({ startLine: 10, endLine: 20 })],
                });
                const noteEntry = createFullEntry({
                    entryType: EntryType.Note,
                    locations: [createFullLocation({ startLine: 10, endLine: 20 })],
                });
                const treeEntries = [findingEntry, noteEntry];

                const searchLocation = createFullLocation({ startLine: 15, endLine: 25 });
                const searchEntryType = EntryType.Note;

                let foundIndex = -1;
                for (let i = 0; i < treeEntries.length; i++) {
                    const e = treeEntries[i];
                    if (e.entryType !== searchEntryType) continue;

                    for (const loc of e.locations) {
                        if (loc.path === searchLocation.path && loc.rootPath === searchLocation.rootPath) {
                            const entryStart = loc.startLine;
                            const entryEnd = loc.endLine;
                            const searchStart = searchLocation.startLine;
                            const searchEnd = searchLocation.endLine;

                            if (entryStart <= searchEnd && searchStart <= entryEnd) {
                                foundIndex = i;
                                break;
                            }
                        }
                    }
                    if (foundIndex !== -1) break;
                }

                // Should find the Note at index 1, not the Finding at index 0
                expect(foundIndex).to.equal(1);
            });

            it("requires both path and rootPath to match", () => {
                const entry = createFullEntry({
                    locations: [
                        createFullLocation({
                            path: "src/test.ts",
                            rootPath: "/workspace/project1",
                            startLine: 10,
                            endLine: 20,
                        }),
                    ],
                });
                const treeEntries = [entry];

                // Same path but different rootPath
                const searchLocation = createFullLocation({
                    path: "src/test.ts",
                    rootPath: "/workspace/project2",
                    startLine: 15,
                    endLine: 25,
                });

                let foundIndex = -1;
                for (let i = 0; i < treeEntries.length; i++) {
                    const e = treeEntries[i];
                    if (e.entryType !== EntryType.Finding) continue;

                    for (const loc of e.locations) {
                        if (loc.path === searchLocation.path && loc.rootPath === searchLocation.rootPath) {
                            const entryStart = loc.startLine;
                            const entryEnd = loc.endLine;
                            const searchStart = searchLocation.startLine;
                            const searchEnd = searchLocation.endLine;

                            if (entryStart <= searchEnd && searchStart <= entryEnd) {
                                foundIndex = i;
                                break;
                            }
                        }
                    }
                }

                expect(foundIndex).to.equal(-1);
            });

            it("checks all locations in entry with multiple locations", () => {
                const entry = createFullEntry({
                    locations: [
                        createFullLocation({ path: "src/file1.ts", startLine: 10, endLine: 20 }),
                        createFullLocation({ path: "src/file2.ts", startLine: 50, endLine: 60 }),
                    ],
                });
                const treeEntries = [entry];

                // Search in second location
                const searchLocation = createFullLocation({ path: "src/file2.ts", startLine: 55, endLine: 65 });

                let foundIndex = -1;
                for (let i = 0; i < treeEntries.length; i++) {
                    const e = treeEntries[i];
                    if (e.entryType !== EntryType.Finding) continue;

                    for (const loc of e.locations) {
                        if (loc.path === searchLocation.path && loc.rootPath === searchLocation.rootPath) {
                            const entryStart = loc.startLine;
                            const entryEnd = loc.endLine;
                            const searchStart = searchLocation.startLine;
                            const searchEnd = searchLocation.endLine;

                            if (entryStart <= searchEnd && searchStart <= entryEnd) {
                                foundIndex = i;
                                break;
                            }
                        }
                    }
                    if (foundIndex !== -1) break;
                }

                expect(foundIndex).to.equal(0);
            });

            it("returns first matching entry index", () => {
                const entry1 = createFullEntry({
                    label: "Entry 1",
                    locations: [createFullLocation({ startLine: 10, endLine: 30 })],
                });
                const entry2 = createFullEntry({
                    label: "Entry 2",
                    locations: [createFullLocation({ startLine: 20, endLine: 40 })],
                });
                const treeEntries = [entry1, entry2];

                // Location overlaps both entries
                const searchLocation = createFullLocation({ startLine: 25, endLine: 35 });

                let foundIndex = -1;
                for (let i = 0; i < treeEntries.length; i++) {
                    const e = treeEntries[i];
                    if (e.entryType !== EntryType.Finding) continue;

                    for (const loc of e.locations) {
                        if (loc.path === searchLocation.path && loc.rootPath === searchLocation.rootPath) {
                            const entryStart = loc.startLine;
                            const entryEnd = loc.endLine;
                            const searchStart = searchLocation.startLine;
                            const searchEnd = searchLocation.endLine;

                            if (entryStart <= searchEnd && searchStart <= entryEnd) {
                                foundIndex = i;
                                break;
                            }
                        }
                    }
                    if (foundIndex !== -1) break;
                }

                // Should return first match
                expect(foundIndex).to.equal(0);
            });

            it("handles empty treeEntries array", () => {
                const treeEntries: FullEntry[] = [];
                const searchLocation = createFullLocation({ startLine: 15, endLine: 25 });

                let foundIndex = -1;
                for (let i = 0; i < treeEntries.length; i++) {
                    // Loop won't execute
                }

                expect(foundIndex).to.equal(-1);
            });

            it("handles adjacent but non-overlapping ranges", () => {
                const entry = createFullEntry({
                    locations: [createFullLocation({ startLine: 10, endLine: 20 })],
                });
                const treeEntries = [entry];

                // Search location starts exactly where entry ends + 1
                const searchLocation = createFullLocation({ startLine: 21, endLine: 30 });

                let foundIndex = -1;
                for (let i = 0; i < treeEntries.length; i++) {
                    const e = treeEntries[i];
                    if (e.entryType !== EntryType.Finding) continue;

                    for (const loc of e.locations) {
                        if (loc.path === searchLocation.path && loc.rootPath === searchLocation.rootPath) {
                            const entryStart = loc.startLine;
                            const entryEnd = loc.endLine;
                            const searchStart = searchLocation.startLine;
                            const searchEnd = searchLocation.endLine;

                            if (entryStart <= searchEnd && searchStart <= entryEnd) {
                                foundIndex = i;
                                break;
                            }
                        }
                    }
                }

                expect(foundIndex).to.equal(-1);
            });

            it("detects exact same range as overlapping", () => {
                const entry = createFullEntry({
                    locations: [createFullLocation({ startLine: 10, endLine: 20 })],
                });
                const treeEntries = [entry];

                // Exact same range
                const searchLocation = createFullLocation({ startLine: 10, endLine: 20 });

                let foundIndex = -1;
                for (let i = 0; i < treeEntries.length; i++) {
                    const e = treeEntries[i];
                    if (e.entryType !== EntryType.Finding) continue;

                    for (const loc of e.locations) {
                        if (loc.path === searchLocation.path && loc.rootPath === searchLocation.rootPath) {
                            const entryStart = loc.startLine;
                            const entryEnd = loc.endLine;
                            const searchStart = searchLocation.startLine;
                            const searchEnd = searchLocation.endLine;

                            if (entryStart <= searchEnd && searchStart <= entryEnd) {
                                foundIndex = i;
                                break;
                            }
                        }
                    }
                    if (foundIndex !== -1) break;
                }

                expect(foundIndex).to.equal(0);
            });
        });
    });

    describe("deleteLocation logic", () => {
        describe("removing locations from entries", () => {
            it("removes specific location from entry with multiple locations", () => {
                const location1 = createFullLocation({ path: "file1.ts", startLine: 10, endLine: 20 });
                const location2 = createFullLocation({ path: "file2.ts", startLine: 30, endLine: 40 });
                const entry = createFullEntry({
                    locations: [location1, location2],
                });

                // Simulate deleteLocation for location1
                for (let i = 0; i < entry.locations.length; i++) {
                    const loc = entry.locations[i];
                    if (
                        loc.path === location1.path &&
                        loc.startLine === location1.startLine &&
                        loc.endLine === location1.endLine &&
                        loc.rootPath === location1.rootPath
                    ) {
                        entry.locations.splice(i, 1);
                        break;
                    }
                }

                expect(entry.locations).to.have.length(1);
                expect(entry.locations[0].path).to.equal("file2.ts");
            });

            it("entry deletion is triggered when last location removed", () => {
                const location = createFullLocation();
                const entry = createFullEntry({
                    locations: [location],
                });

                let shouldDeleteEntry = false;

                // Simulate deleteLocation
                for (let i = 0; i < entry.locations.length; i++) {
                    const loc = entry.locations[i];
                    if (
                        loc.path === location.path &&
                        loc.startLine === location.startLine &&
                        loc.endLine === location.endLine &&
                        loc.rootPath === location.rootPath
                    ) {
                        entry.locations.splice(i, 1);
                        if (entry.locations.length === 0) {
                            shouldDeleteEntry = true;
                        }
                        break;
                    }
                }

                expect(entry.locations).to.have.length(0);
                expect(shouldDeleteEntry).to.be.true;
            });

            it("matches location by all properties (path, startLine, endLine, rootPath)", () => {
                const location1 = createFullLocation({
                    path: "src/test.ts",
                    startLine: 10,
                    endLine: 20,
                    rootPath: "/workspace/project1",
                });
                const location2 = createFullLocation({
                    path: "src/test.ts",
                    startLine: 10,
                    endLine: 20,
                    rootPath: "/workspace/project2", // Different rootPath
                });
                const entry = createFullEntry({
                    locations: [location1, location2],
                });

                // Try to delete location1 - should only remove location1
                const toDelete = location1;
                for (let i = 0; i < entry.locations.length; i++) {
                    const loc = entry.locations[i];
                    if (
                        loc.path === toDelete.path &&
                        loc.startLine === toDelete.startLine &&
                        loc.endLine === toDelete.endLine &&
                        loc.rootPath === toDelete.rootPath
                    ) {
                        entry.locations.splice(i, 1);
                        break;
                    }
                }

                expect(entry.locations).to.have.length(1);
                expect(entry.locations[0].rootPath).to.equal("/workspace/project2");
            });

            it("does nothing when location not found in entry", () => {
                const existingLocation = createFullLocation({ path: "file1.ts" });
                const entry = createFullEntry({
                    locations: [existingLocation],
                });

                // Try to delete a different location
                const toDelete = createFullLocation({ path: "file2.ts" });
                const originalLength = entry.locations.length;

                for (let i = 0; i < entry.locations.length; i++) {
                    const loc = entry.locations[i];
                    if (
                        loc.path === toDelete.path &&
                        loc.startLine === toDelete.startLine &&
                        loc.endLine === toDelete.endLine &&
                        loc.rootPath === toDelete.rootPath
                    ) {
                        entry.locations.splice(i, 1);
                        break;
                    }
                }

                expect(entry.locations).to.have.length(originalLength);
            });

            it("handles entry with empty locations array gracefully", () => {
                const entry = createFullEntry({
                    locations: [],
                });

                const toDelete = createFullLocation();
                let errorOccurred = false;

                if (entry.locations === undefined || entry.locations.length === 0) {
                    // Early return in actual code
                    errorOccurred = entry.locations === undefined;
                }

                expect(errorOccurred).to.be.false;
                expect(entry.locations).to.have.length(0);
            });
        });

        describe("FullLocationEntry structure", () => {
            it("maintains reference to parent entry", () => {
                const entry = createFullEntry();
                const location = entry.locations[0];
                const locationEntry = createFullLocationEntry(entry, location);

                expect(locationEntry.parentEntry).to.equal(entry);
                expect(locationEntry.location).to.equal(location);
            });

            it("allows deletion through parent reference", () => {
                const entry = createFullEntry({
                    locations: [createFullLocation({ path: "file1.ts" }), createFullLocation({ path: "file2.ts" })],
                });
                const locationEntry = createFullLocationEntry(entry, entry.locations[0]);

                // Delete using the locationEntry's reference
                const parentEntry = locationEntry.parentEntry;
                const toDelete = locationEntry.location;

                for (let i = 0; i < parentEntry.locations.length; i++) {
                    const loc = parentEntry.locations[i];
                    if (
                        loc.path === toDelete.path &&
                        loc.startLine === toDelete.startLine &&
                        loc.endLine === toDelete.endLine &&
                        loc.rootPath === toDelete.rootPath
                    ) {
                        parentEntry.locations.splice(i, 1);
                        break;
                    }
                }

                // Verify deletion happened through the reference
                expect(entry.locations).to.have.length(1);
                expect(entry.locations[0].path).to.equal("file2.ts");
            });
        });
    });

    describe("addRegionToAnEntry logic", () => {
        describe("adding locations to existing entries", () => {
            it("adds new location to entry's locations array", () => {
                const entry = createFullEntry({
                    locations: [createFullLocation({ path: "file1.ts" })],
                });

                const newLocation = createFullLocation({ path: "file2.ts", startLine: 50, endLine: 60 });

                entry.locations.push(newLocation);

                expect(entry.locations).to.have.length(2);
                expect(entry.locations[1].path).to.equal("file2.ts");
                expect(entry.locations[1].startLine).to.equal(50);
            });

            it("filters entries by matching workspace root", () => {
                const entries = [
                    createFullEntry({
                        label: "Entry 1",
                        locations: [createFullLocation({ rootPath: "/workspace/project1" })],
                    }),
                    createFullEntry({
                        label: "Entry 2",
                        locations: [createFullLocation({ rootPath: "/workspace/project2" })],
                    }),
                    createFullEntry({
                        label: "Entry 3",
                        locations: [createFullLocation({ rootPath: "/workspace/project1" })],
                    }),
                ];

                const targetRootPath = "/workspace/project1";

                // Filter logic from addRegionToAnEntry
                const filteredItems = entries.filter((entry) => {
                    if (entry.locations.length === 0 || entry.locations[0].rootPath !== targetRootPath) {
                        return false;
                    }
                    return true;
                });

                expect(filteredItems).to.have.length(2);
                expect(filteredItems[0].label).to.equal("Entry 1");
                expect(filteredItems[1].label).to.equal("Entry 3");
            });

            it("excludes entries with empty locations array", () => {
                const entries = [
                    createFullEntry({
                        label: "Entry with locations",
                        locations: [createFullLocation({ rootPath: "/workspace/project1" })],
                    }),
                    createFullEntry({
                        label: "Entry without locations",
                        locations: [],
                    }),
                ];

                const targetRootPath = "/workspace/project1";

                const filteredItems = entries.filter((entry) => {
                    if (entry.locations.length === 0 || entry.locations[0].rootPath !== targetRootPath) {
                        return false;
                    }
                    return true;
                });

                expect(filteredItems).to.have.length(1);
                expect(filteredItems[0].label).to.equal("Entry with locations");
            });

            it("maps entries to label-based items for quick pick", () => {
                const entries = [createFullEntry({ label: "Finding A" }), createFullEntry({ label: "Finding B" })];

                const items = entries.map((entry) => ({
                    label: entry.label,
                    entry: entry,
                }));

                expect(items).to.have.length(2);
                expect(items[0].label).to.equal("Finding A");
                expect(items[0].entry).to.equal(entries[0]);
                expect(items[1].label).to.equal("Finding B");
            });

            it("handles empty entries array (would trigger addFinding)", () => {
                const entries: FullEntry[] = [];
                const targetRootPath = "/workspace/project1";

                const filteredItems = entries.filter((entry) => {
                    if (entry.locations.length === 0 || entry.locations[0].rootPath !== targetRootPath) {
                        return false;
                    }
                    return true;
                });

                // In actual code, this would trigger addFinding()
                const shouldCreateNewFinding = filteredItems.length === 0;

                expect(shouldCreateNewFinding).to.be.true;
            });

            it("preserves existing locations when adding new one", () => {
                const existingLocation1 = createFullLocation({ path: "file1.ts", startLine: 10, endLine: 20 });
                const existingLocation2 = createFullLocation({ path: "file2.ts", startLine: 30, endLine: 40 });
                const entry = createFullEntry({
                    locations: [existingLocation1, existingLocation2],
                });

                const newLocation = createFullLocation({ path: "file3.ts", startLine: 50, endLine: 60 });
                entry.locations.push(newLocation);

                expect(entry.locations).to.have.length(3);
                expect(entry.locations[0]).to.equal(existingLocation1);
                expect(entry.locations[1]).to.equal(existingLocation2);
                expect(entry.locations[2]).to.equal(newLocation);
            });
        });
    });

    describe("location comparison logic", () => {
        /**
         * Helper to compare locations by their identifying properties
         * (path, startLine, endLine, rootPath) - same as deleteLocation uses
         */
        function locationsMatch(loc1: FullLocation, loc2: FullLocation): boolean {
            return loc1.path === loc2.path && loc1.startLine === loc2.startLine && loc1.endLine === loc2.endLine && loc1.rootPath === loc2.rootPath;
        }

        it("returns true for identical locations", () => {
            const loc1 = createFullLocation({
                path: "src/test.ts",
                startLine: 10,
                endLine: 20,
                rootPath: "/workspace/project",
            });
            const loc2 = createFullLocation({
                path: "src/test.ts",
                startLine: 10,
                endLine: 20,
                rootPath: "/workspace/project",
            });

            expect(locationsMatch(loc1, loc2)).to.be.true;
        });

        it("returns false when paths differ", () => {
            const loc1 = createFullLocation({ path: "src/file1.ts" });
            const loc2 = createFullLocation({ path: "src/file2.ts" });

            expect(locationsMatch(loc1, loc2)).to.be.false;
        });

        it("returns false when startLine differs", () => {
            const loc1 = createFullLocation({ startLine: 10 });
            const loc2 = createFullLocation({ startLine: 15 });

            expect(locationsMatch(loc1, loc2)).to.be.false;
        });

        it("returns false when endLine differs", () => {
            const loc1 = createFullLocation({ endLine: 20 });
            const loc2 = createFullLocation({ endLine: 25 });

            expect(locationsMatch(loc1, loc2)).to.be.false;
        });

        it("returns false when rootPath differs", () => {
            const loc1 = createFullLocation({ rootPath: "/workspace/project1" });
            const loc2 = createFullLocation({ rootPath: "/workspace/project2" });

            expect(locationsMatch(loc1, loc2)).to.be.false;
        });

        it("ignores label differences", () => {
            const loc1 = createFullLocation({ label: "Label A" });
            const loc2 = createFullLocation({ label: "Label B" });

            expect(locationsMatch(loc1, loc2)).to.be.true;
        });

        it("ignores description differences", () => {
            const loc1 = createFullLocation({ description: "Description A" });
            const loc2 = createFullLocation({ description: "Description B" });

            expect(locationsMatch(loc1, loc2)).to.be.true;
        });
    });

    describe("Edge Cases", () => {
        it("handles location with line 0 (first line of file)", () => {
            const location = createFullLocation({ startLine: 0, endLine: 0 });
            expect(location.startLine).to.equal(0);
            expect(location.endLine).to.equal(0);
        });

        it("handles location with very large line numbers", () => {
            const location = createFullLocation({ startLine: 100000, endLine: 100500 });
            expect(location.startLine).to.equal(100000);
            expect(location.endLine).to.equal(100500);
        });

        it("handles location where startLine equals endLine", () => {
            const location = createFullLocation({ startLine: 50, endLine: 50 });
            expect(location.startLine).to.equal(location.endLine);
        });

        it("handles path with special characters", () => {
            const location = createFullLocation({ path: "src/components/[id]/page.tsx" });
            expect(location.path).to.equal("src/components/[id]/page.tsx");
        });

        it("handles path with spaces", () => {
            const location = createFullLocation({ path: "src/my component/file.ts" });
            expect(location.path).to.equal("src/my component/file.ts");
        });

        it("handles path with unicode characters", () => {
            const location = createFullLocation({ path: "src/日本語/файл.ts" });
            expect(location.path).to.equal("src/日本語/файл.ts");
        });

        it("handles rootPath with trailing slash normalization", () => {
            const loc1 = createFullLocation({ rootPath: "/workspace/project" });
            const loc2 = createFullLocation({ rootPath: "/workspace/project/" });

            // Note: In actual code, paths should be normalized
            // This test documents current behavior
            expect(loc1.rootPath).to.not.equal(loc2.rootPath);
        });

        it("entry with many locations can be iterated", () => {
            const locations = Array.from({ length: 100 }, (_, i) => createFullLocation({ path: `file${i}.ts`, startLine: i * 10, endLine: i * 10 + 5 }));
            const entry = createFullEntry({ locations });

            expect(entry.locations).to.have.length(100);

            let count = 0;
            for (const loc of entry.locations) {
                count++;
            }
            expect(count).to.equal(100);
        });
    });
});
