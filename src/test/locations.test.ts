import * as assert from "node:assert";
import { EntryType, type FullEntry, type FullLocation, createDefaultEntryDetails } from "../types";
import {
    filterEntriesByAuthor,
    filterEntriesByAuthorAndRootPath,
    filterEntriesByRootPath,
    findLocationIndex,
    locationMatches,
    removeLocationFromEntry,
} from "../utilities/locationUtils";

describe("locationUtils", () => {
    function createLocation(overrides: Partial<FullLocation> = {}): FullLocation {
        return {
            path: "src/test.ts",
            startLine: 1,
            endLine: 10,
            label: "Location",
            description: "",
            rootPath: "/workspace",
            ...overrides,
        };
    }

    function createEntry(overrides: Partial<FullEntry> = {}): FullEntry {
        return {
            label: "Test Entry",
            entryType: EntryType.Finding,
            author: "testuser",
            details: createDefaultEntryDetails(),
            locations: [createLocation()],
            ...overrides,
        };
    }

    describe("locationMatches", () => {
        it("should return true for identical locations", () => {
            const a = createLocation();
            const b = createLocation();

            assert.strictEqual(locationMatches(a, b), true);
        });

        it("should return false for different paths", () => {
            const a = createLocation({ path: "src/a.ts" });
            const b = createLocation({ path: "src/b.ts" });

            assert.strictEqual(locationMatches(a, b), false);
        });

        it("should return false for different startLines", () => {
            const a = createLocation({ startLine: 1 });
            const b = createLocation({ startLine: 5 });

            assert.strictEqual(locationMatches(a, b), false);
        });

        it("should return false for different endLines", () => {
            const a = createLocation({ endLine: 10 });
            const b = createLocation({ endLine: 20 });

            assert.strictEqual(locationMatches(a, b), false);
        });

        it("should return false for different rootPaths", () => {
            const a = createLocation({ rootPath: "/workspace1" });
            const b = createLocation({ rootPath: "/workspace2" });

            assert.strictEqual(locationMatches(a, b), false);
        });
    });

    describe("findLocationIndex", () => {
        it("should find location at correct index", () => {
            const target = createLocation({ path: "src/target.ts" });
            const locations = [createLocation({ path: "src/first.ts" }), target, createLocation({ path: "src/third.ts" })];

            const idx = findLocationIndex(locations, target);

            assert.strictEqual(idx, 1);
        });

        it("should return -1 when location not found", () => {
            const target = createLocation({ path: "src/notfound.ts" });
            const locations = [createLocation({ path: "src/first.ts" }), createLocation({ path: "src/second.ts" })];

            const idx = findLocationIndex(locations, target);

            assert.strictEqual(idx, -1);
        });
    });

    describe("removeLocationFromEntry", () => {
        it("should remove location and indicate entry should not be deleted", () => {
            const locations = [createLocation({ path: "src/first.ts" }), createLocation({ path: "src/second.ts" })];
            const target = createLocation({ path: "src/first.ts" });

            const result = removeLocationFromEntry(locations, target);

            assert.strictEqual(result.removed, true);
            assert.strictEqual(result.shouldDeleteEntry, false);
            assert.strictEqual(locations.length, 1);
        });

        it("should indicate entry should be deleted when last location removed", () => {
            const locations = [createLocation()];
            const target = createLocation();

            const result = removeLocationFromEntry(locations, target);

            assert.strictEqual(result.removed, true);
            assert.strictEqual(result.shouldDeleteEntry, true);
            assert.strictEqual(locations.length, 0);
        });

        it("should not remove when location not found", () => {
            const locations = [createLocation({ path: "src/existing.ts" })];
            const target = createLocation({ path: "src/notfound.ts" });

            const result = removeLocationFromEntry(locations, target);

            assert.strictEqual(result.removed, false);
            assert.strictEqual(result.shouldDeleteEntry, false);
            assert.strictEqual(locations.length, 1);
        });
    });

    describe("filterEntriesByRootPath", () => {
        it("should filter entries by root path", () => {
            const entries = [
                createEntry({ locations: [createLocation({ rootPath: "/root1" })] }),
                createEntry({ locations: [createLocation({ rootPath: "/root2" })] }),
                createEntry({ locations: [createLocation({ rootPath: "/root1" })] }),
            ];

            const filtered = filterEntriesByRootPath(entries, "/root1");

            assert.strictEqual(filtered.length, 2);
        });

        it("should return empty array when no matches", () => {
            const entries = [createEntry({ locations: [createLocation({ rootPath: "/root1" })] })];

            const filtered = filterEntriesByRootPath(entries, "/other");

            assert.strictEqual(filtered.length, 0);
        });
    });

    describe("filterEntriesByAuthor", () => {
        it("should filter entries by author", () => {
            const entries = [createEntry({ author: "alice" }), createEntry({ author: "bob" }), createEntry({ author: "alice" })];

            const filtered = filterEntriesByAuthor(entries, "alice");

            assert.strictEqual(filtered.length, 2);
        });
    });

    describe("filterEntriesByAuthorAndRootPath", () => {
        it("should filter by both author and root path", () => {
            const entries = [
                createEntry({ author: "alice", locations: [createLocation({ rootPath: "/root1" })] }),
                createEntry({ author: "alice", locations: [createLocation({ rootPath: "/root2" })] }),
                createEntry({ author: "bob", locations: [createLocation({ rootPath: "/root1" })] }),
            ];

            const filtered = filterEntriesByAuthorAndRootPath(entries, "alice", "/root1");

            assert.strictEqual(filtered.length, 1);
            assert.strictEqual(filtered[0].author, "alice");
        });

        it("should return empty when no matches for both criteria", () => {
            const entries = [createEntry({ author: "alice", locations: [createLocation({ rootPath: "/root1" })] })];

            const filtered = filterEntriesByAuthorAndRootPath(entries, "alice", "/root2");

            assert.strictEqual(filtered.length, 0);
        });
    });
});
