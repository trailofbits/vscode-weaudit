import * as assert from "node:assert";
import {
    type AuditedFile,
    type ConfigurationEntry,
    type Entry,
    EntryType,
    FindingDifficulty,
    FindingSeverity,
    FindingType,
    type FullEntry,
    type FullLocationEntry,
    type PathOrganizerEntry,
    type PartiallyAuditedFile,
    type SerializedData,
    TreeViewMode,
    type WorkspaceRootEntry,
    configEntryEquals,
    createDefaultEntryDetails,
    createDefaultSerializedData,
    entryEquals,
    isConfigurationEntry,
    isEntry,
    isLocationEntry,
    isPathOrganizerEntry,
    isWorkspaceRootEntry,
    mergeTwoAuditedFileArrays,
    mergeTwoEntryArrays,
    mergeTwoPartiallyAuditedFileArrays,
    treeViewModeLabel,
    validateSerializedData,
} from "../types";

describe("types.ts", () => {
    describe("createDefaultSerializedData", () => {
        it("should create empty serialized data with all required fields", () => {
            const data = createDefaultSerializedData();

            assert.strictEqual(data.clientRemote, "");
            assert.strictEqual(data.gitRemote, "");
            assert.strictEqual(data.gitSha, "");
            assert.deepStrictEqual(data.treeEntries, []);
            assert.deepStrictEqual(data.auditedFiles, []);
            assert.deepStrictEqual(data.partiallyAuditedFiles, []);
            assert.deepStrictEqual(data.resolvedEntries, []);
        });
    });

    describe("createDefaultEntryDetails", () => {
        it("should create default entry details with undefined enums and empty strings", () => {
            const details = createDefaultEntryDetails();

            assert.strictEqual(details.severity, FindingSeverity.Undefined);
            assert.strictEqual(details.difficulty, FindingDifficulty.Undefined);
            assert.strictEqual(details.type, FindingType.Undefined);
            assert.strictEqual(details.description, "");
            assert.strictEqual(details.exploit, "");
            assert.strictEqual(details.recommendation, "Short term, \nLong term, \n");
        });
    });

    describe("treeViewModeLabel", () => {
        it("should return 'list' for List mode", () => {
            assert.strictEqual(treeViewModeLabel(TreeViewMode.List), "list");
        });

        it("should return 'byFile' for GroupByFile mode", () => {
            assert.strictEqual(treeViewModeLabel(TreeViewMode.GroupByFile), "byFile");
        });
    });

    describe("validateSerializedData", () => {
        function createValidEntry(): Entry {
            return {
                label: "Test Finding",
                entryType: EntryType.Finding,
                author: "testuser",
                details: {
                    severity: FindingSeverity.High,
                    difficulty: FindingDifficulty.Low,
                    type: FindingType.DataValidation,
                    description: "Test description",
                    exploit: "Test exploit",
                    recommendation: "Test recommendation",
                },
                locations: [
                    {
                        path: "src/test.ts",
                        startLine: 1,
                        endLine: 10,
                        label: "Location 1",
                        description: "",
                    },
                ],
            };
        }

        function createValidSerializedData(): SerializedData {
            return {
                clientRemote: "https://github.com/client/repo",
                gitRemote: "https://github.com/audit/repo",
                gitSha: "abc123",
                treeEntries: [createValidEntry()],
                auditedFiles: [{ path: "src/test.ts", author: "testuser" }],
                partiallyAuditedFiles: [{ path: "src/partial.ts", author: "testuser", startLine: 1, endLine: 50 }],
                resolvedEntries: [],
            };
        }

        it("should return true for valid serialized data", () => {
            const data = createValidSerializedData();
            assert.strictEqual(validateSerializedData(data), true);
        });

        it("should return true for empty but valid serialized data", () => {
            const data = createDefaultSerializedData();
            assert.strictEqual(validateSerializedData(data), true);
        });

        it("should return false when treeEntries is undefined", () => {
            const data = createValidSerializedData();
            (data as unknown as { treeEntries: undefined }).treeEntries = undefined;
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("should return false when auditedFiles is undefined", () => {
            const data = createValidSerializedData();
            (data as unknown as { auditedFiles: undefined }).auditedFiles = undefined;
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("should return false when resolvedEntries is undefined", () => {
            const data = createValidSerializedData();
            (data as unknown as { resolvedEntries: undefined }).resolvedEntries = undefined;
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("should return false for entry with invalid entryType", () => {
            const data = createValidSerializedData();
            (data.treeEntries[0] as unknown as { entryType: number }).entryType = 999;
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("should return false for entry missing label", () => {
            const data = createValidSerializedData();
            (data.treeEntries[0] as unknown as { label: undefined }).label = undefined;
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("should return false for entry missing locations", () => {
            const data = createValidSerializedData();
            (data.treeEntries[0] as unknown as { locations: undefined }).locations = undefined;
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("should return false for entry with invalid location (missing path)", () => {
            const data = createValidSerializedData();
            (data.treeEntries[0].locations[0] as unknown as { path: undefined }).path = undefined;
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("should return false for entry with invalid details (missing severity)", () => {
            const data = createValidSerializedData();
            (data.treeEntries[0].details as unknown as { severity: undefined }).severity = undefined;
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("should return false for audited file missing path", () => {
            const data = createValidSerializedData();
            (data.auditedFiles[0] as unknown as { path: undefined }).path = undefined;
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("should handle data without partiallyAuditedFiles (backwards compatibility)", () => {
            const data = createValidSerializedData();
            delete data.partiallyAuditedFiles;
            assert.strictEqual(validateSerializedData(data), true);
        });

        it("should validate Note entry type", () => {
            const data = createValidSerializedData();
            data.treeEntries[0].entryType = EntryType.Note;
            assert.strictEqual(validateSerializedData(data), true);
        });

        // BUG TEST: This test exposes a logic error in validatepartiallyAuditedFile
        // The function uses `||` instead of `&&`, so validation passes if ANY field is defined
        // instead of requiring ALL required fields (path, author, startLine, endLine)
        it("should reject partially audited file missing startLine", () => {
            const data = createDefaultSerializedData();
            // Create a partially audited file missing startLine - should be invalid
            data.partiallyAuditedFiles = [{ path: "test.ts", author: "user", endLine: 10 } as unknown as PartiallyAuditedFile];

            // This test FAILS - validateSerializedData returns true due to the || bug
            assert.strictEqual(validateSerializedData(data), false);
        });

        // BUG TEST: Similar test for missing endLine
        it("should reject partially audited file missing endLine", () => {
            const data = createDefaultSerializedData();
            data.partiallyAuditedFiles = [{ path: "test.ts", author: "user", startLine: 1 } as unknown as PartiallyAuditedFile];

            // This test FAILS - validateSerializedData returns true due to the || bug
            assert.strictEqual(validateSerializedData(data), false);
        });

        // BUG TEST: Test with path and author only (no line numbers at all)
        it("should reject partially audited file missing both line numbers", () => {
            const data = createDefaultSerializedData();
            data.partiallyAuditedFiles = [{ path: "test.ts", author: "user" } as unknown as PartiallyAuditedFile];

            // This test FAILS - validateSerializedData returns true due to the || bug
            // (validateAuditedFile passes because path and author exist)
            assert.strictEqual(validateSerializedData(data), false);
        });
    });

    describe("entryEquals", () => {
        function createEntry(overrides: Partial<Entry> = {}): Entry {
            return {
                label: "Test Finding",
                entryType: EntryType.Finding,
                author: "testuser",
                details: createDefaultEntryDetails(),
                locations: [
                    {
                        path: "src/test.ts",
                        startLine: 1,
                        endLine: 10,
                        label: "Location 1",
                        description: "",
                    },
                ],
                ...overrides,
            };
        }

        it("should return true for identical entries", () => {
            const a = createEntry();
            const b = createEntry();
            assert.strictEqual(entryEquals(a, b), true);
        });

        it("should return false for different labels", () => {
            const a = createEntry({ label: "Finding A" });
            const b = createEntry({ label: "Finding B" });
            assert.strictEqual(entryEquals(a, b), false);
        });

        it("should return false for different entry types", () => {
            const a = createEntry({ entryType: EntryType.Finding });
            const b = createEntry({ entryType: EntryType.Note });
            assert.strictEqual(entryEquals(a, b), false);
        });

        it("should return false for different authors", () => {
            const a = createEntry({ author: "user1" });
            const b = createEntry({ author: "user2" });
            assert.strictEqual(entryEquals(a, b), false);
        });

        it("should return false for different number of locations", () => {
            const a = createEntry();
            const b = createEntry({
                locations: [
                    { path: "src/test.ts", startLine: 1, endLine: 10, label: "Location 1", description: "" },
                    { path: "src/test2.ts", startLine: 1, endLine: 5, label: "Location 2", description: "" },
                ],
            });
            assert.strictEqual(entryEquals(a, b), false);
        });

        it("should return false for different location paths", () => {
            const a = createEntry({
                locations: [{ path: "src/a.ts", startLine: 1, endLine: 10, label: "L", description: "" }],
            });
            const b = createEntry({
                locations: [{ path: "src/b.ts", startLine: 1, endLine: 10, label: "L", description: "" }],
            });
            assert.strictEqual(entryEquals(a, b), false);
        });

        it("should return false for different location startLines", () => {
            const a = createEntry({
                locations: [{ path: "src/test.ts", startLine: 1, endLine: 10, label: "L", description: "" }],
            });
            const b = createEntry({
                locations: [{ path: "src/test.ts", startLine: 5, endLine: 10, label: "L", description: "" }],
            });
            assert.strictEqual(entryEquals(a, b), false);
        });

        it("should return false for different location endLines", () => {
            const a = createEntry({
                locations: [{ path: "src/test.ts", startLine: 1, endLine: 10, label: "L", description: "" }],
            });
            const b = createEntry({
                locations: [{ path: "src/test.ts", startLine: 1, endLine: 20, label: "L", description: "" }],
            });
            assert.strictEqual(entryEquals(a, b), false);
        });

        it("should ignore differences in location labels", () => {
            const a = createEntry({
                locations: [{ path: "src/test.ts", startLine: 1, endLine: 10, label: "Label A", description: "" }],
            });
            const b = createEntry({
                locations: [{ path: "src/test.ts", startLine: 1, endLine: 10, label: "Label B", description: "" }],
            });
            assert.strictEqual(entryEquals(a, b), true);
        });

        it("should ignore differences in entry details", () => {
            const a = createEntry({
                details: {
                    ...createDefaultEntryDetails(),
                    severity: FindingSeverity.High,
                },
            });
            const b = createEntry({
                details: {
                    ...createDefaultEntryDetails(),
                    severity: FindingSeverity.Low,
                },
            });
            assert.strictEqual(entryEquals(a, b), true);
        });
    });

    describe("mergeTwoEntryArrays", () => {
        function createEntry(label: string, path = "src/test.ts"): Entry {
            return {
                label,
                entryType: EntryType.Finding,
                author: "testuser",
                details: createDefaultEntryDetails(),
                locations: [{ path, startLine: 1, endLine: 10, label: "L", description: "" }],
            };
        }

        it("should merge two empty arrays", () => {
            const result = mergeTwoEntryArrays([], []);
            assert.deepStrictEqual(result, []);
        });

        it("should return first array when second is empty", () => {
            const a = [createEntry("A")];
            const result = mergeTwoEntryArrays(a, []);
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].label, "A");
        });

        it("should return second array entries when first is empty", () => {
            const b = [createEntry("B")];
            const result = mergeTwoEntryArrays([], b);
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].label, "B");
        });

        it("should merge non-overlapping arrays", () => {
            const a = [createEntry("A", "src/a.ts")];
            const b = [createEntry("B", "src/b.ts")];
            const result = mergeTwoEntryArrays(a, b);
            assert.strictEqual(result.length, 2);
        });

        it("should not duplicate identical entries", () => {
            const a = [createEntry("A")];
            const b = [createEntry("A")];
            const result = mergeTwoEntryArrays(a, b);
            assert.strictEqual(result.length, 1);
        });

        it("should preserve order with first array entries first", () => {
            const a = [createEntry("A", "src/a.ts")];
            const b = [createEntry("B", "src/b.ts")];
            const result = mergeTwoEntryArrays(a, b);
            assert.strictEqual(result[0].label, "A");
            assert.strictEqual(result[1].label, "B");
        });

        // BUG TEST: This test exposes the mutation bug in mergeTwoEntryArrays
        // The function assigns `const result: Entry[] = a` which creates a reference, not a copy
        // Then `result.push(b[i])` mutates the original array 'a'
        it("should not mutate the first array argument", () => {
            const a = [createEntry("A", "src/a.ts")];
            const b = [createEntry("B", "src/b.ts")];
            const originalLength = a.length;

            mergeTwoEntryArrays(a, b);

            // This test FAILS - a.length will be 2 instead of 1
            assert.strictEqual(a.length, originalLength, "First array should not be mutated");
        });
    });

    describe("mergeTwoAuditedFileArrays", () => {
        it("should merge two empty arrays", () => {
            const result = mergeTwoAuditedFileArrays([], []);
            assert.deepStrictEqual(result, []);
        });

        it("should merge non-overlapping arrays", () => {
            const a: AuditedFile[] = [{ path: "src/a.ts", author: "user1" }];
            const b: AuditedFile[] = [{ path: "src/b.ts", author: "user2" }];
            const result = mergeTwoAuditedFileArrays(a, b);
            assert.strictEqual(result.length, 2);
        });

        it("should not duplicate identical audited files", () => {
            const a: AuditedFile[] = [{ path: "src/a.ts", author: "user1" }];
            const b: AuditedFile[] = [{ path: "src/a.ts", author: "user1" }];
            const result = mergeTwoAuditedFileArrays(a, b);
            assert.strictEqual(result.length, 1);
        });

        it("should treat same path different author as different files", () => {
            const a: AuditedFile[] = [{ path: "src/a.ts", author: "user1" }];
            const b: AuditedFile[] = [{ path: "src/a.ts", author: "user2" }];
            const result = mergeTwoAuditedFileArrays(a, b);
            assert.strictEqual(result.length, 2);
        });

        // BUG TEST: This test exposes the mutation bug in mergeTwoAuditedFileArrays
        it("should not mutate the first array argument", () => {
            const a: AuditedFile[] = [{ path: "src/a.ts", author: "user1" }];
            const b: AuditedFile[] = [{ path: "src/b.ts", author: "user2" }];
            const originalLength = a.length;

            mergeTwoAuditedFileArrays(a, b);

            // This test FAILS - a.length will be 2 instead of 1
            assert.strictEqual(a.length, originalLength, "First array should not be mutated");
        });
    });

    describe("mergeTwoPartiallyAuditedFileArrays", () => {
        it("should merge two empty arrays", () => {
            const result = mergeTwoPartiallyAuditedFileArrays([], []);
            assert.deepStrictEqual(result, []);
        });

        it("should merge non-overlapping arrays", () => {
            const a: PartiallyAuditedFile[] = [{ path: "src/a.ts", author: "user1", startLine: 1, endLine: 10 }];
            const b: PartiallyAuditedFile[] = [{ path: "src/b.ts", author: "user2", startLine: 1, endLine: 10 }];
            const result = mergeTwoPartiallyAuditedFileArrays(a, b);
            assert.strictEqual(result.length, 2);
        });

        it("should not duplicate identical partially audited files", () => {
            const a: PartiallyAuditedFile[] = [{ path: "src/a.ts", author: "user1", startLine: 1, endLine: 10 }];
            const b: PartiallyAuditedFile[] = [{ path: "src/a.ts", author: "user2", startLine: 1, endLine: 10 }];
            const result = mergeTwoPartiallyAuditedFileArrays(a, b);
            assert.strictEqual(result.length, 1);
        });

        it("should treat same path different lines as different regions", () => {
            const a: PartiallyAuditedFile[] = [{ path: "src/a.ts", author: "user1", startLine: 1, endLine: 10 }];
            const b: PartiallyAuditedFile[] = [{ path: "src/a.ts", author: "user1", startLine: 20, endLine: 30 }];
            const result = mergeTwoPartiallyAuditedFileArrays(a, b);
            assert.strictEqual(result.length, 2);
        });

        // BUG TEST: This test exposes the mutation bug in mergeTwoPartiallyAuditedFileArrays
        it("should not mutate the first array argument", () => {
            const a: PartiallyAuditedFile[] = [{ path: "src/a.ts", author: "user1", startLine: 1, endLine: 10 }];
            const b: PartiallyAuditedFile[] = [{ path: "src/b.ts", author: "user2", startLine: 1, endLine: 10 }];
            const originalLength = a.length;

            mergeTwoPartiallyAuditedFileArrays(a, b);

            // This test FAILS - a.length will be 2 instead of 1
            assert.strictEqual(a.length, originalLength, "First array should not be mutated");
        });
    });

    describe("type predicates", () => {
        describe("isEntry", () => {
            it("should return true for FullEntry", () => {
                const entry: FullEntry = {
                    label: "Test",
                    entryType: EntryType.Finding,
                    author: "user",
                    details: createDefaultEntryDetails(),
                    locations: [{ path: "test.ts", startLine: 1, endLine: 5, label: "L", description: "", rootPath: "/root" }],
                };
                assert.strictEqual(isEntry(entry), true);
            });

            it("should return false for PathOrganizerEntry", () => {
                const entry: PathOrganizerEntry = { pathLabel: "src/test.ts" };
                assert.strictEqual(isEntry(entry), false);
            });

            it("should return false for FullLocationEntry", () => {
                const parentEntry: FullEntry = {
                    label: "Test",
                    entryType: EntryType.Finding,
                    author: "user",
                    details: createDefaultEntryDetails(),
                    locations: [{ path: "test.ts", startLine: 1, endLine: 5, label: "L", description: "", rootPath: "/root" }],
                };
                const entry: FullLocationEntry = {
                    location: { path: "test.ts", startLine: 1, endLine: 5, label: "L", description: "", rootPath: "/root" },
                    parentEntry,
                };
                assert.strictEqual(isEntry(entry), false);
            });
        });

        describe("isLocationEntry", () => {
            it("should return true for FullLocationEntry", () => {
                const parentEntry: FullEntry = {
                    label: "Test",
                    entryType: EntryType.Finding,
                    author: "user",
                    details: createDefaultEntryDetails(),
                    locations: [{ path: "test.ts", startLine: 1, endLine: 5, label: "L", description: "", rootPath: "/root" }],
                };
                const entry: FullLocationEntry = {
                    location: { path: "test.ts", startLine: 1, endLine: 5, label: "L", description: "", rootPath: "/root" },
                    parentEntry,
                };
                assert.strictEqual(isLocationEntry(entry), true);
            });

            it("should return false for FullEntry", () => {
                const entry: FullEntry = {
                    label: "Test",
                    entryType: EntryType.Finding,
                    author: "user",
                    details: createDefaultEntryDetails(),
                    locations: [{ path: "test.ts", startLine: 1, endLine: 5, label: "L", description: "", rootPath: "/root" }],
                };
                assert.strictEqual(isLocationEntry(entry), false);
            });
        });

        describe("isPathOrganizerEntry", () => {
            it("should return true for PathOrganizerEntry", () => {
                const entry: PathOrganizerEntry = { pathLabel: "src/test.ts" };
                assert.strictEqual(isPathOrganizerEntry(entry), true);
            });

            it("should return false for FullEntry", () => {
                const entry: FullEntry = {
                    label: "Test",
                    entryType: EntryType.Finding,
                    author: "user",
                    details: createDefaultEntryDetails(),
                    locations: [{ path: "test.ts", startLine: 1, endLine: 5, label: "L", description: "", rootPath: "/root" }],
                };
                assert.strictEqual(isPathOrganizerEntry(entry), false);
            });
        });

        describe("isConfigurationEntry", () => {
            it("should return true for ConfigurationEntry", () => {
                const entry: ConfigurationEntry = {
                    path: "/path/to/file",
                    username: "testuser",
                    root: { label: "root" },
                };
                assert.strictEqual(isConfigurationEntry(entry), true);
            });

            it("should return false for WorkspaceRootEntry", () => {
                const entry: WorkspaceRootEntry = { label: "root" };
                assert.strictEqual(isConfigurationEntry(entry), false);
            });
        });

        describe("isWorkspaceRootEntry", () => {
            it("should return true for WorkspaceRootEntry", () => {
                const entry: WorkspaceRootEntry = { label: "root" };
                assert.strictEqual(isWorkspaceRootEntry(entry), true);
            });

            it("should return true for ConfigurationEntry (has label via root)", () => {
                const entry: ConfigurationEntry = {
                    path: "/path/to/file",
                    username: "testuser",
                    root: { label: "root" },
                };
                // Note: isWorkspaceRootEntry checks for 'label' which ConfigurationEntry doesn't have directly
                // This actually returns false because ConfigurationEntry doesn't have a 'label' property directly
                assert.strictEqual(isWorkspaceRootEntry(entry), false);
            });
        });
    });

    describe("configEntryEquals", () => {
        it("should return true for identical config entries", () => {
            const a: ConfigurationEntry = {
                path: "/path/to/file",
                username: "testuser",
                root: { label: "root1" },
            };
            const b: ConfigurationEntry = {
                path: "/path/to/file",
                username: "testuser",
                root: { label: "root1" },
            };
            assert.strictEqual(configEntryEquals(a, b), true);
        });

        it("should return false for different paths", () => {
            const a: ConfigurationEntry = {
                path: "/path/a",
                username: "testuser",
                root: { label: "root1" },
            };
            const b: ConfigurationEntry = {
                path: "/path/b",
                username: "testuser",
                root: { label: "root1" },
            };
            assert.strictEqual(configEntryEquals(a, b), false);
        });

        it("should return false for different usernames", () => {
            const a: ConfigurationEntry = {
                path: "/path/to/file",
                username: "user1",
                root: { label: "root1" },
            };
            const b: ConfigurationEntry = {
                path: "/path/to/file",
                username: "user2",
                root: { label: "root1" },
            };
            assert.strictEqual(configEntryEquals(a, b), false);
        });

        it("should return false for different root labels", () => {
            const a: ConfigurationEntry = {
                path: "/path/to/file",
                username: "testuser",
                root: { label: "root1" },
            };
            const b: ConfigurationEntry = {
                path: "/path/to/file",
                username: "testuser",
                root: { label: "root2" },
            };
            assert.strictEqual(configEntryEquals(a, b), false);
        });
    });
});
