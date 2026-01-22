import * as assert from "node:assert";
import { EntryType, FindingDifficulty, FindingSeverity, FindingType, type FullEntry, createDefaultEntryDetails } from "../types";
import {
    getUniqueAuthors,
    addToResolvedEntries,
    removeEntryFromArray,
    restoreEntryFromResolved,
    restoreAllEntries,
    deleteAllResolvedEntries,
} from "../utilities/entryUtils";

describe("entryUtils", () => {
    function createTestEntry(overrides: Partial<FullEntry> = {}): FullEntry {
        return {
            label: "Test Entry",
            entryType: EntryType.Finding,
            author: "testuser",
            details: createDefaultEntryDetails(),
            locations: [{ path: "src/test.ts", startLine: 1, endLine: 10, label: "Location", description: "", rootPath: "/workspace" }],
            ...overrides,
        };
    }

    describe("removeEntryFromArray", () => {
        it("should remove entry from array", () => {
            const entry = createTestEntry({ label: "Target" });
            const entries = [createTestEntry({ label: "First" }), entry, createTestEntry({ label: "Third" })];
            const result = removeEntryFromArray(entry, entries);
            assert.strictEqual(result.success, true);
        });
    });

    describe("addToResolvedEntries", () => {
        it("should add entry to resolved entries", () => {
            const entry = createTestEntry();
            const resolved: FullEntry[] = [];
            addToResolvedEntries(entry, resolved);
            assert.strictEqual(resolved.length, 1);
        });
    });

    describe("restoreEntryFromResolved", () => {
        it("should move entry from resolved to tree entries", () => {
            const entry = createTestEntry({ label: "Resolved Entry" });
            const treeEntries: FullEntry[] = [];
            const resolvedEntries = [entry];
            const result = restoreEntryFromResolved(entry, treeEntries, resolvedEntries);
            assert.strictEqual(result.success, true);
        });
    });

    describe("getUniqueAuthors", () => {
        it("should return unique authors from entries", () => {
            const entries = [createTestEntry({ author: "alice" }), createTestEntry({ author: "bob" })];
            const authors = getUniqueAuthors(entries);
            assert.strictEqual(authors.length, 2);
        });
    });

    describe("restoreAllEntries", () => {
        it("should move all resolved entries to tree entries", () => {
            const treeEntries: FullEntry[] = [];
            const resolvedEntries = [createTestEntry({ author: "alice" })];
            const authors = restoreAllEntries(treeEntries, resolvedEntries);
            assert.strictEqual(treeEntries.length, 1);
            assert.ok(authors.includes("alice"));
        });
    });

    describe("deleteAllResolvedEntries", () => {
        it("should clear all resolved entries", () => {
            const resolvedEntries = [createTestEntry({ author: "alice" })];
            const authors = deleteAllResolvedEntries(resolvedEntries);
            assert.strictEqual(resolvedEntries.length, 0);
        });
    });
});
