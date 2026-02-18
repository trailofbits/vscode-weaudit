import * as assert from "node:assert";

import {
    EntryType,
    FindingDifficulty,
    FindingSeverity,
    FindingType,
    SerializedData,
    createDefaultSerializedData,
    validateSerializedData,
} from "../../src/types";

/**
 * Helper to create a valid entry for testing
 */
function createValidEntry() {
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
        locations: [
            {
                path: "src/test.ts",
                startLine: 10,
                endLine: 20,
                label: "test location",
                description: "",
            },
        ],
    };
}

/**
 * Helper to create a valid serialized data object
 */
function createValidSerializedData(): SerializedData {
    return {
        clientRemote: "https://github.com/client/repo",
        gitRemote: "https://github.com/auditor/repo",
        gitSha: "abc123",
        treeEntries: [createValidEntry()],
        auditedFiles: [{ path: "src/reviewed.ts", author: "testuser" }],
        partiallyAuditedFiles: [{ path: "src/partial.ts", author: "testuser", startLine: 0, endLine: 50 }],
        resolvedEntries: [],
    };
}

describe("validateSerializedData", () => {
    describe("positive cases", () => {
        it("accepts a fully populated valid payload", () => {
            const data = createValidSerializedData();
            assert.strictEqual(validateSerializedData(data), true);
        });

        it("accepts minimal payload with empty arrays", () => {
            const data = createDefaultSerializedData();
            assert.strictEqual(validateSerializedData(data), true);
        });

        it("accepts legacy data without partiallyAuditedFiles field", () => {
            const data: any = {
                clientRemote: "",
                gitRemote: "",
                gitSha: "",
                treeEntries: [],
                auditedFiles: [],
                resolvedEntries: [],
                // Note: partiallyAuditedFiles is intentionally omitted
            };
            assert.strictEqual(validateSerializedData(data), true);
        });

        it("accepts payload with empty string remotes", () => {
            const data = createDefaultSerializedData();
            data.clientRemote = "";
            data.gitRemote = "";
            data.gitSha = "";
            assert.strictEqual(validateSerializedData(data), true);
        });

        it("accepts entry with EntryType.Note", () => {
            const data = createDefaultSerializedData();
            const noteEntry = createValidEntry();
            noteEntry.entryType = EntryType.Note;
            data.treeEntries = [noteEntry];
            assert.strictEqual(validateSerializedData(data), true);
        });

        it("accepts entry with multiple locations", () => {
            const data = createDefaultSerializedData();
            const entry = createValidEntry();
            entry.locations.push({
                path: "src/another.ts",
                startLine: 5,
                endLine: 10,
                label: "second location",
                description: "with description",
            });
            data.treeEntries = [entry];
            assert.strictEqual(validateSerializedData(data), true);
        });

        it("accepts entries in resolvedEntries array", () => {
            const data = createDefaultSerializedData();
            data.resolvedEntries = [createValidEntry()];
            assert.strictEqual(validateSerializedData(data), true);
        });
    });

    describe("missing top-level arrays", () => {
        it("rejects missing treeEntries", () => {
            const data: any = {
                clientRemote: "",
                gitRemote: "",
                gitSha: "",
                treeEntries: undefined,
                auditedFiles: [],
                resolvedEntries: [],
            };
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("defaults missing auditedFiles to an empty array", () => {
            const data: any = {
                clientRemote: "",
                gitRemote: "",
                gitSha: "",
                treeEntries: [],
                auditedFiles: undefined,
                resolvedEntries: [],
            };
            assert.strictEqual(validateSerializedData(data), true);
            assert.deepStrictEqual(data.auditedFiles, []);
        });

        it("defaults missing resolvedEntries to an empty array", () => {
            const data: any = {
                clientRemote: "",
                gitRemote: "",
                gitSha: "",
                treeEntries: [],
                auditedFiles: [],
                resolvedEntries: undefined,
            };
            assert.strictEqual(validateSerializedData(data), true);
            assert.deepStrictEqual(data.resolvedEntries, []);
        });
    });

    describe("invalid entry fields", () => {
        it("rejects invalid entryType (number outside enum)", () => {
            const data = createDefaultSerializedData();
            const entry: any = createValidEntry();
            entry.entryType = 99;
            data.treeEntries = [entry];
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("rejects invalid entryType (negative number)", () => {
            const data = createDefaultSerializedData();
            const entry: any = createValidEntry();
            entry.entryType = -1;
            data.treeEntries = [entry];
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("rejects entry missing label", () => {
            const data = createDefaultSerializedData();
            const entry: any = createValidEntry();
            delete entry.label;
            data.treeEntries = [entry];
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("rejects entry with undefined label", () => {
            const data = createDefaultSerializedData();
            const entry: any = createValidEntry();
            entry.label = undefined;
            data.treeEntries = [entry];
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("rejects entry missing author", () => {
            const data = createDefaultSerializedData();
            const entry: any = createValidEntry();
            delete entry.author;
            data.treeEntries = [entry];
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("rejects entry with undefined author", () => {
            const data = createDefaultSerializedData();
            const entry: any = createValidEntry();
            entry.author = undefined;
            data.treeEntries = [entry];
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("rejects entry missing details", () => {
            const data = createDefaultSerializedData();
            const entry: any = createValidEntry();
            delete entry.details;
            data.treeEntries = [entry];
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("rejects entry with undefined details", () => {
            const data = createDefaultSerializedData();
            const entry: any = createValidEntry();
            entry.details = undefined;
            data.treeEntries = [entry];
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("rejects entry missing locations", () => {
            const data = createDefaultSerializedData();
            const entry: any = createValidEntry();
            delete entry.locations;
            data.treeEntries = [entry];
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("rejects entry with undefined locations", () => {
            const data = createDefaultSerializedData();
            const entry: any = createValidEntry();
            entry.locations = undefined;
            data.treeEntries = [entry];
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("rejects entry missing entryType", () => {
            const data = createDefaultSerializedData();
            const entry: any = createValidEntry();
            delete entry.entryType;
            data.treeEntries = [entry];
            assert.strictEqual(validateSerializedData(data), false);
        });
    });

    describe("invalid location fields", () => {
        it("rejects location missing path", () => {
            const data = createDefaultSerializedData();
            const entry: any = createValidEntry();
            delete entry.locations[0].path;
            data.treeEntries = [entry];
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("rejects location with undefined path", () => {
            const data = createDefaultSerializedData();
            const entry: any = createValidEntry();
            entry.locations[0].path = undefined;
            data.treeEntries = [entry];
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("rejects location missing startLine", () => {
            const data = createDefaultSerializedData();
            const entry: any = createValidEntry();
            delete entry.locations[0].startLine;
            data.treeEntries = [entry];
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("rejects location with undefined startLine", () => {
            const data = createDefaultSerializedData();
            const entry: any = createValidEntry();
            entry.locations[0].startLine = undefined;
            data.treeEntries = [entry];
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("rejects location missing endLine", () => {
            const data = createDefaultSerializedData();
            const entry: any = createValidEntry();
            delete entry.locations[0].endLine;
            data.treeEntries = [entry];
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("rejects location with undefined endLine", () => {
            const data = createDefaultSerializedData();
            const entry: any = createValidEntry();
            entry.locations[0].endLine = undefined;
            data.treeEntries = [entry];
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("rejects location missing label", () => {
            const data = createDefaultSerializedData();
            const entry: any = createValidEntry();
            delete entry.locations[0].label;
            data.treeEntries = [entry];
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("rejects location with undefined label", () => {
            const data = createDefaultSerializedData();
            const entry: any = createValidEntry();
            entry.locations[0].label = undefined;
            data.treeEntries = [entry];
            assert.strictEqual(validateSerializedData(data), false);
        });
    });

    describe("invalid auditedFile fields", () => {
        it("rejects auditedFile missing path", () => {
            const data = createDefaultSerializedData();
            data.auditedFiles = [{ author: "testuser" } as any];
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("rejects auditedFile with undefined path", () => {
            const data = createDefaultSerializedData();
            data.auditedFiles = [{ path: undefined, author: "testuser" } as any];
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("rejects auditedFile missing author", () => {
            const data = createDefaultSerializedData();
            data.auditedFiles = [{ path: "src/test.ts" } as any];
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("rejects auditedFile with undefined author", () => {
            const data = createDefaultSerializedData();
            data.auditedFiles = [{ path: "src/test.ts", author: undefined } as any];
            assert.strictEqual(validateSerializedData(data), false);
        });
    });

    describe("invalid partiallyAuditedFile fields", () => {
        // validatepartiallyAuditedFile uses AND logic: all of
        // path, author, startLine, and endLine must be defined.

        it("rejects partiallyAuditedFile missing path", () => {
            const data = createDefaultSerializedData();
            data.partiallyAuditedFiles = [{ author: "testuser", startLine: 0, endLine: 10 } as any];
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("rejects partiallyAuditedFile missing author", () => {
            const data = createDefaultSerializedData();
            data.partiallyAuditedFiles = [{ path: "src/test.ts", startLine: 0, endLine: 10 } as any];
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("rejects partiallyAuditedFile with all fields undefined", () => {
            const data = createDefaultSerializedData();
            data.partiallyAuditedFiles = [{ path: undefined, author: undefined, startLine: undefined, endLine: undefined } as any];
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("rejects partiallyAuditedFile with only startLine defined", () => {
            const data = createDefaultSerializedData();
            data.partiallyAuditedFiles = [{ startLine: 5 } as any];
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("rejects partiallyAuditedFile with only endLine defined", () => {
            const data = createDefaultSerializedData();
            data.partiallyAuditedFiles = [{ endLine: 10 } as any];
            assert.strictEqual(validateSerializedData(data), false);
        });
    });

    describe("invalid entryDetails fields", () => {
        it("rejects entryDetails missing severity", () => {
            const data = createDefaultSerializedData();
            const entry: any = createValidEntry();
            delete entry.details.severity;
            data.treeEntries = [entry];
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("rejects entryDetails with undefined severity", () => {
            const data = createDefaultSerializedData();
            const entry: any = createValidEntry();
            entry.details.severity = undefined;
            data.treeEntries = [entry];
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("rejects entryDetails missing difficulty", () => {
            const data = createDefaultSerializedData();
            const entry: any = createValidEntry();
            delete entry.details.difficulty;
            data.treeEntries = [entry];
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("rejects entryDetails with undefined difficulty", () => {
            const data = createDefaultSerializedData();
            const entry: any = createValidEntry();
            entry.details.difficulty = undefined;
            data.treeEntries = [entry];
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("rejects entryDetails missing type", () => {
            const data = createDefaultSerializedData();
            const entry: any = createValidEntry();
            delete entry.details.type;
            data.treeEntries = [entry];
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("rejects entryDetails with undefined type", () => {
            const data = createDefaultSerializedData();
            const entry: any = createValidEntry();
            entry.details.type = undefined;
            data.treeEntries = [entry];
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("rejects entryDetails missing description", () => {
            const data = createDefaultSerializedData();
            const entry: any = createValidEntry();
            delete entry.details.description;
            data.treeEntries = [entry];
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("rejects entryDetails missing exploit", () => {
            const data = createDefaultSerializedData();
            const entry: any = createValidEntry();
            delete entry.details.exploit;
            data.treeEntries = [entry];
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("rejects entryDetails missing recommendation", () => {
            const data = createDefaultSerializedData();
            const entry: any = createValidEntry();
            delete entry.details.recommendation;
            data.treeEntries = [entry];
            assert.strictEqual(validateSerializedData(data), false);
        });
    });

    describe("validation in resolvedEntries", () => {
        it("rejects invalid entry in resolvedEntries", () => {
            const data = createDefaultSerializedData();
            const invalidEntry: any = createValidEntry();
            delete invalidEntry.label;
            data.resolvedEntries = [invalidEntry];
            assert.strictEqual(validateSerializedData(data), false);
        });

        it("rejects invalid entryType in resolvedEntries", () => {
            const data = createDefaultSerializedData();
            const invalidEntry: any = createValidEntry();
            invalidEntry.entryType = 999;
            data.resolvedEntries = [invalidEntry];
            assert.strictEqual(validateSerializedData(data), false);
        });
    });
});
