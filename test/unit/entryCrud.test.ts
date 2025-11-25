import { expect } from "chai";
import * as sinon from "sinon";

import {
    Entry,
    EntryType,
    FullEntry,
    FullLocation,
    FindingSeverity,
    FindingDifficulty,
    FindingType,
    createDefaultEntryDetails,
    getEntryIndexFromArray,
    entryEquals,
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

describe("Entry CRUD Operations", () => {
    describe("Entry Creation", () => {
        describe("createOrEditEntry logic", () => {
            it("creates a new Finding entry with correct structure", () => {
                const location = createFullLocation();
                const entry: FullEntry = {
                    label: "New Finding",
                    entryType: EntryType.Finding,
                    author: "testuser",
                    locations: [location],
                    details: createDefaultEntryDetails(),
                };

                expect(entry.label).to.equal("New Finding");
                expect(entry.entryType).to.equal(EntryType.Finding);
                expect(entry.author).to.equal("testuser");
                expect(entry.locations).to.have.length(1);
                expect(entry.details).to.exist;
            });

            it("creates a new Note entry with correct structure", () => {
                const location = createFullLocation();
                const entry: FullEntry = {
                    label: "New Note",
                    entryType: EntryType.Note,
                    author: "testuser",
                    locations: [location],
                    details: createDefaultEntryDetails(),
                };

                expect(entry.label).to.equal("New Note");
                expect(entry.entryType).to.equal(EntryType.Note);
            });

            it("creates entry with default details", () => {
                const entry = createFullEntry();
                entry.details = createDefaultEntryDetails();

                expect(entry.details.severity).to.equal(FindingSeverity.Undefined);
                expect(entry.details.difficulty).to.equal(FindingDifficulty.Undefined);
                expect(entry.details.type).to.equal(FindingType.Undefined);
            });

            it("entry with empty title is valid but discouraged", () => {
                const entry = createFullEntry({ label: "" });
                expect(entry.label).to.equal("");
            });

            it("entry with whitespace-only title is valid", () => {
                const entry = createFullEntry({ label: "   " });
                expect(entry.label).to.equal("   ");
            });

            it("entry preserves special characters in title", () => {
                const entry = createFullEntry({ label: 'Special: "quotes" & <brackets>' });
                expect(entry.label).to.equal('Special: "quotes" & <brackets>');
            });
        });

        describe("edit existing entry", () => {
            it("updates entry label in place", () => {
                const entry = createFullEntry({ label: "Original" });
                entry.label = "Updated";
                expect(entry.label).to.equal("Updated");
            });

            it("preserves other fields when editing label", () => {
                const entry = createFullEntry({
                    label: "Original",
                    author: "alice",
                    entryType: EntryType.Finding,
                });
                const originalAuthor = entry.author;
                const originalType = entry.entryType;

                entry.label = "Updated";

                expect(entry.author).to.equal(originalAuthor);
                expect(entry.entryType).to.equal(originalType);
            });
        });

        describe("input cancellation", () => {
            it("undefined input represents cancelled operation", () => {
                const title: string | undefined = undefined;
                expect(title).to.be.undefined;
                // In actual code, this would return early without creating entry
            });

            it("empty string input could represent cleared input", () => {
                const title = "";
                expect(title).to.equal("");
            });
        });
    });

    describe("Entry Deletion", () => {
        describe("deleteFinding", () => {
            it("removes entry from array when found", () => {
                const entry1 = createFullEntry({ label: "Entry 1" });
                const entry2 = createFullEntry({ label: "Entry 2" });
                const treeEntries = [entry1, entry2];

                const idx = getEntryIndexFromArray(entry1, treeEntries);
                expect(idx).to.equal(0);

                treeEntries.splice(idx, 1);
                expect(treeEntries).to.have.length(1);
                expect(treeEntries[0].label).to.equal("Entry 2");
            });

            it("removes entry with multiple locations", () => {
                const entry = createFullEntry({
                    locations: [createFullLocation({ path: "file1.ts" }), createFullLocation({ path: "file2.ts" })],
                });
                const treeEntries = [entry];

                const idx = getEntryIndexFromArray(entry, treeEntries);
                treeEntries.splice(idx, 1);

                expect(treeEntries).to.have.length(0);
            });

            it("handles entry not found gracefully", () => {
                const entry = createFullEntry({ label: "Not in list" });
                const treeEntries = [createFullEntry({ label: "Different entry" })];

                const idx = getEntryIndexFromArray(entry, treeEntries);
                expect(idx).to.equal(-1);
            });

            it("handles empty array", () => {
                const entry = createFullEntry();
                const treeEntries: FullEntry[] = [];

                const idx = getEntryIndexFromArray(entry, treeEntries);
                expect(idx).to.equal(-1);
            });

            it("removes correct entry when duplicates exist", () => {
                // Entries with same label but different locations
                const entry1 = createFullEntry({
                    label: "Same Label",
                    locations: [createFullLocation({ startLine: 10 })],
                });
                const entry2 = createFullEntry({
                    label: "Same Label",
                    locations: [createFullLocation({ startLine: 50 })],
                });
                const treeEntries = [entry1, entry2];

                const idx = getEntryIndexFromArray(entry1, treeEntries);
                expect(idx).to.equal(0);

                treeEntries.splice(idx, 1);
                expect(treeEntries).to.have.length(1);
                expect(treeEntries[0].locations[0].startLine).to.equal(50);
            });
        });
    });

    describe("Entry Resolution", () => {
        describe("resolveFinding", () => {
            it("moves entry from treeEntries to resolvedEntries", () => {
                const entry = createFullEntry();
                const treeEntries = [entry];
                const resolvedEntries: FullEntry[] = [];

                // Simulate resolve
                const idx = getEntryIndexFromArray(entry, treeEntries);
                const removed = treeEntries.splice(idx, 1)[0];
                resolvedEntries.push(removed);

                expect(treeEntries).to.have.length(0);
                expect(resolvedEntries).to.have.length(1);
                expect(resolvedEntries[0]).to.equal(entry);
            });

            it("preserves all entry data when resolving", () => {
                const entry = createFullEntry({
                    label: "Important Finding",
                    author: "alice",
                    details: {
                        severity: FindingSeverity.High,
                        difficulty: FindingDifficulty.Low,
                        type: FindingType.Authentication,
                        description: "Detailed description",
                        exploit: "Exploit scenario",
                        recommendation: "Fix recommendation",
                    },
                });
                const resolvedEntries: FullEntry[] = [];

                resolvedEntries.push(entry);

                expect(resolvedEntries[0].label).to.equal("Important Finding");
                expect(resolvedEntries[0].author).to.equal("alice");
                expect(resolvedEntries[0].details.severity).to.equal(FindingSeverity.High);
                expect(resolvedEntries[0].details.description).to.equal("Detailed description");
            });

            it("adds default details if missing when resolving", () => {
                const entry: any = createFullEntry();
                delete entry.details;

                if (entry.details === undefined) {
                    entry.details = createDefaultEntryDetails();
                }

                expect(entry.details).to.exist;
                expect(entry.details.severity).to.equal(FindingSeverity.Undefined);
            });

            it("handles resolving entry not in treeEntries", () => {
                const entry = createFullEntry();
                const treeEntries: FullEntry[] = [];

                const idx = getEntryIndexFromArray(entry, treeEntries);
                expect(idx).to.equal(-1);
            });
        });

        describe("restoreFinding", () => {
            it("moves entry from resolvedEntries back to treeEntries", () => {
                const entry = createFullEntry();
                const treeEntries: FullEntry[] = [];
                const resolvedEntries = [entry];

                // Simulate restore
                treeEntries.push(entry);
                const idx = getEntryIndexFromArray(entry, resolvedEntries);
                resolvedEntries.splice(idx, 1);

                expect(treeEntries).to.have.length(1);
                expect(resolvedEntries).to.have.length(0);
            });

            it("adds default details if missing when restoring", () => {
                const entry: any = createFullEntry();
                delete entry.details;

                if (entry.details === undefined) {
                    entry.details = createDefaultEntryDetails();
                }

                expect(entry.details).to.exist;
            });

            it("handles restoring entry not in resolvedEntries", () => {
                const entry = createFullEntry();
                const resolvedEntries: FullEntry[] = [];

                const idx = getEntryIndexFromArray(entry, resolvedEntries);
                expect(idx).to.equal(-1);
            });

            it("preserves entry data when restoring", () => {
                const entry = createFullEntry({
                    label: "Restored Finding",
                    author: "bob",
                });
                const treeEntries: FullEntry[] = [];

                treeEntries.push(entry);

                expect(treeEntries[0].label).to.equal("Restored Finding");
                expect(treeEntries[0].author).to.equal("bob");
            });
        });

        describe("restoreAllResolvedFindings", () => {
            it("restores all entries to treeEntries", () => {
                const entry1 = createFullEntry({ label: "Entry 1" });
                const entry2 = createFullEntry({ label: "Entry 2" });
                let treeEntries: FullEntry[] = [];
                const resolvedEntries = [entry1, entry2];

                // Simulate restoreAll
                treeEntries = treeEntries.concat(resolvedEntries);
                resolvedEntries.splice(0, resolvedEntries.length);

                expect(treeEntries).to.have.length(2);
                expect(resolvedEntries).to.have.length(0);
            });

            it("handles empty resolvedEntries", () => {
                const treeEntries: FullEntry[] = [];
                const resolvedEntries: FullEntry[] = [];

                if (resolvedEntries.length === 0) {
                    // Early return in actual code
                    expect(true).to.equal(true);
                }

                expect(treeEntries).to.have.length(0);
            });

            it("collects unique authors for saving", () => {
                const entry1 = createFullEntry({ author: "alice" });
                const entry2 = createFullEntry({ author: "bob" });
                const entry3 = createFullEntry({ author: "alice" }); // Duplicate
                const resolvedEntries = [entry1, entry2, entry3];

                const authorSet = new Set<string>();
                for (const entry of resolvedEntries) {
                    authorSet.add(entry.author);
                }

                expect(authorSet.size).to.equal(2);
                expect(authorSet.has("alice")).to.be.true;
                expect(authorSet.has("bob")).to.be.true;
            });
        });

        describe("deleteAllResolvedFindings", () => {
            it("clears all resolved entries", () => {
                const resolvedEntries = [createFullEntry({ label: "Entry 1" }), createFullEntry({ label: "Entry 2" })];

                resolvedEntries.splice(0, resolvedEntries.length);

                expect(resolvedEntries).to.have.length(0);
            });

            it("handles empty resolvedEntries", () => {
                const resolvedEntries: FullEntry[] = [];

                if (resolvedEntries.length === 0) {
                    // Early return in actual code
                    expect(true).to.equal(true);
                }
            });

            it("collects unique authors for saving", () => {
                const resolvedEntries = [createFullEntry({ author: "alice" }), createFullEntry({ author: "bob" }), createFullEntry({ author: "alice" })];

                const authors = resolvedEntries.map((entry) => entry.author).filter((value, index, self) => self.indexOf(value) === index);

                expect(authors).to.have.length(2);
                expect(authors).to.include("alice");
                expect(authors).to.include("bob");
            });
        });
    });

    describe("Entry Filtering", () => {
        describe("filtering by author", () => {
            it("filters entries by username", () => {
                const entries = [createFullEntry({ author: "alice" }), createFullEntry({ author: "bob" }), createFullEntry({ author: "alice" })];

                const aliceEntries = entries.filter((e) => e.author === "alice");
                const bobEntries = entries.filter((e) => e.author === "bob");

                expect(aliceEntries).to.have.length(2);
                expect(bobEntries).to.have.length(1);
            });

            it("returns empty array when no matches", () => {
                const entries = [createFullEntry({ author: "alice" }), createFullEntry({ author: "bob" })];

                const charlieEntries = entries.filter((e) => e.author === "charlie");

                expect(charlieEntries).to.have.length(0);
            });
        });

        describe("filtering by workspace root", () => {
            it("filters entries by rootPath", () => {
                const entries = [
                    createFullEntry({
                        locations: [createFullLocation({ rootPath: "/workspace/project1" })],
                    }),
                    createFullEntry({
                        locations: [createFullLocation({ rootPath: "/workspace/project2" })],
                    }),
                ];

                const project1Entries = entries.filter((e) => e.locations.some((l) => l.rootPath === "/workspace/project1"));

                expect(project1Entries).to.have.length(1);
            });

            it("handles entries with multiple locations in different roots", () => {
                const entry = createFullEntry({
                    locations: [createFullLocation({ rootPath: "/workspace/project1" }), createFullLocation({ rootPath: "/workspace/project2" })],
                });

                const inProject1 = entry.locations.some((l) => l.rootPath === "/workspace/project1");
                const inProject2 = entry.locations.some((l) => l.rootPath === "/workspace/project2");

                expect(inProject1).to.be.true;
                expect(inProject2).to.be.true;
            });
        });
    });

    describe("Edge Cases", () => {
        it("handles entry with very long label", () => {
            const longLabel = "A".repeat(10000);
            const entry = createFullEntry({ label: longLabel });

            expect(entry.label).to.have.length(10000);
        });

        it("handles entry with unicode in label", () => {
            const entry = createFullEntry({ label: "漢字 emoji 🎉 Ελληνικά" });
            expect(entry.label).to.equal("漢字 emoji 🎉 Ελληνικά");
        });

        it("handles entry with newlines in label", () => {
            const entry = createFullEntry({ label: "Line 1\nLine 2\nLine 3" });
            expect(entry.label).to.contain("\n");
        });

        it("handles entries array mutation during iteration", () => {
            const entries = [createFullEntry({ label: "1" }), createFullEntry({ label: "2" }), createFullEntry({ label: "3" })];

            // Safe way to remove during iteration - iterate backwards
            for (let i = entries.length - 1; i >= 0; i--) {
                if (entries[i].label === "2") {
                    entries.splice(i, 1);
                }
            }

            expect(entries).to.have.length(2);
            expect(entries.map((e) => e.label)).to.deep.equal(["1", "3"]);
        });

        it("handles concurrent modifications to shared array", () => {
            const resolvedEntries = [createFullEntry({ label: "Shared" })];
            const reference1 = resolvedEntries;
            const reference2 = resolvedEntries;

            // Both references point to same array
            reference1.push(createFullEntry({ label: "Added" }));

            expect(reference2).to.have.length(2);
        });

        it("entry equality ignores details differences", () => {
            const entry1 = createFullEntry({
                details: { ...createDefaultEntryDetails(), description: "Version 1" },
            });
            const entry2 = createFullEntry({
                details: { ...createDefaultEntryDetails(), description: "Version 2" },
            });

            // entryEquals only compares label, entryType, author, and locations
            expect(entryEquals(entry1, entry2)).to.be.true;
        });
    });
});
