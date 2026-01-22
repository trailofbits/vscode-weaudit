import * as assert from "node:assert";
import { EntryType, FindingDifficulty, FindingSeverity, FindingType, type SerializedData } from "../types";
import { parseDayLogJson, parseWeauditFile, serializeDayLog, serializeWeauditFile } from "../persistenceUtils";

describe("persistenceUtils", () => {
    describe("parseDayLogJson", () => {
        it("should parse valid day log JSON into Map", () => {
            const jsonString = JSON.stringify([
                ["2024-01-15", ["src/file1.ts", "src/file2.ts"]],
                ["2024-01-16", ["src/file3.ts"]],
            ]);

            const result = parseDayLogJson(jsonString);

            assert.ok(result !== null);
            assert.strictEqual(result.size, 2);
            assert.deepStrictEqual(result.get("2024-01-15"), ["src/file1.ts", "src/file2.ts"]);
            assert.deepStrictEqual(result.get("2024-01-16"), ["src/file3.ts"]);
        });

        it("should return null for invalid JSON", () => {
            const result = parseDayLogJson("not valid json {[}");

            assert.strictEqual(result, null);
        });

        it("should return null for empty string", () => {
            const result = parseDayLogJson("");

            assert.strictEqual(result, null);
        });

        it("should handle empty Map JSON", () => {
            const jsonString = JSON.stringify([]);

            const result = parseDayLogJson(jsonString);

            assert.ok(result !== null);
            assert.strictEqual(result.size, 0);
        });

        it("should return null for whitespace-only string", () => {
            const result = parseDayLogJson("   \n\t   ");

            assert.strictEqual(result, null);
        });
    });

    describe("serializeDayLog", () => {
        it("should serialize empty Map", () => {
            const dayLog = new Map<string, string[]>();

            const result = serializeDayLog(dayLog);

            assert.strictEqual(result, "[]");
        });

        it("should serialize Map with entries", () => {
            const dayLog = new Map<string, string[]>([
                ["2024-01-15", ["src/file1.ts", "src/file2.ts"]],
                ["2024-01-16", ["src/file3.ts"]],
            ]);

            const result = serializeDayLog(dayLog);
            const parsed = JSON.parse(result) as [string, string[]][];

            assert.strictEqual(parsed.length, 2);
            assert.deepStrictEqual(parsed[0], ["2024-01-15", ["src/file1.ts", "src/file2.ts"]]);
            assert.deepStrictEqual(parsed[1], ["2024-01-16", ["src/file3.ts"]]);
        });

        it("should produce JSON parseable back to same Map", () => {
            const originalDayLog = new Map<string, string[]>([
                ["2024-01-15", ["src/file1.ts"]],
                ["2024-01-16", ["src/file2.ts", "src/file3.ts"]],
            ]);

            const serialized = serializeDayLog(originalDayLog);
            const restored = parseDayLogJson(serialized);

            assert.ok(restored !== null);
            assert.strictEqual(restored.size, originalDayLog.size);
            assert.deepStrictEqual(restored.get("2024-01-15"), originalDayLog.get("2024-01-15"));
            assert.deepStrictEqual(restored.get("2024-01-16"), originalDayLog.get("2024-01-16"));
        });
    });

    describe("parseWeauditFile", () => {
        function createValidSerializedData(): SerializedData {
            return {
                clientRemote: "https://github.com/client/repo",
                gitRemote: "https://github.com/audit/repo",
                gitSha: "abc123def456",
                treeEntries: [
                    {
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
                    },
                ],
                auditedFiles: [{ path: "src/audited.ts", author: "testuser" }],
                partiallyAuditedFiles: [{ path: "src/partial.ts", author: "testuser", startLine: 1, endLine: 50 }],
                resolvedEntries: [],
            };
        }

        it("should parse valid .weaudit JSON", () => {
            const data = createValidSerializedData();
            const jsonString = JSON.stringify(data);

            const result = parseWeauditFile(jsonString);

            assert.ok(result !== null);
            assert.strictEqual(result.clientRemote, "https://github.com/client/repo");
            assert.strictEqual(result.treeEntries.length, 1);
            assert.strictEqual(result.treeEntries[0].label, "Test Finding");
        });

        it("should return null for invalid JSON", () => {
            const result = parseWeauditFile("not valid json {[}");

            assert.strictEqual(result, null);
        });

        it("should return null for empty string", () => {
            const result = parseWeauditFile("");

            assert.strictEqual(result, null);
        });

        it("should handle missing optional partiallyAuditedFiles", () => {
            const data: SerializedData = {
                clientRemote: "",
                gitRemote: "",
                gitSha: "",
                treeEntries: [],
                auditedFiles: [],
                resolvedEntries: [],
            };
            const jsonString = JSON.stringify(data);

            const result = parseWeauditFile(jsonString);

            assert.ok(result !== null);
            assert.strictEqual(result.partiallyAuditedFiles, undefined);
        });

        it("should return null for data failing validation (missing required fields)", () => {
            // Missing treeEntries
            const invalidData = {
                clientRemote: "",
                gitRemote: "",
                gitSha: "",
                auditedFiles: [],
                resolvedEntries: [],
            };
            const jsonString = JSON.stringify(invalidData);

            const result = parseWeauditFile(jsonString);

            assert.strictEqual(result, null);
        });
    });

    describe("serializeWeauditFile", () => {
        function createValidSerializedData(): SerializedData {
            return {
                clientRemote: "https://github.com/client/repo",
                gitRemote: "https://github.com/audit/repo",
                gitSha: "abc123",
                treeEntries: [],
                auditedFiles: [],
                partiallyAuditedFiles: [],
                resolvedEntries: [],
            };
        }

        it("should serialize valid SerializedData", () => {
            const data = createValidSerializedData();

            const result = serializeWeauditFile(data);

            assert.ok(result.includes('"clientRemote"'));
            assert.ok(result.includes('"gitRemote"'));
            assert.ok(result.includes('"treeEntries"'));
        });

        it("should include all required fields", () => {
            const data = createValidSerializedData();

            const result = serializeWeauditFile(data);
            const parsed = JSON.parse(result) as SerializedData;

            assert.ok("clientRemote" in parsed);
            assert.ok("gitRemote" in parsed);
            assert.ok("gitSha" in parsed);
            assert.ok("treeEntries" in parsed);
            assert.ok("auditedFiles" in parsed);
            assert.ok("partiallyAuditedFiles" in parsed);
            assert.ok("resolvedEntries" in parsed);
        });

        it("should produce JSON parseable back to same structure", () => {
            const originalData: SerializedData = {
                clientRemote: "https://github.com/client/repo",
                gitRemote: "https://github.com/audit/repo",
                gitSha: "abc123",
                treeEntries: [
                    {
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
                        locations: [{ path: "src/test.ts", startLine: 1, endLine: 10, label: "L", description: "" }],
                    },
                ],
                auditedFiles: [{ path: "src/test.ts", author: "testuser" }],
                partiallyAuditedFiles: [],
                resolvedEntries: [],
            };

            const serialized = serializeWeauditFile(originalData);
            const restored = parseWeauditFile(serialized);

            assert.ok(restored !== null);
            assert.strictEqual(restored.clientRemote, originalData.clientRemote);
            assert.strictEqual(restored.gitRemote, originalData.gitRemote);
            assert.strictEqual(restored.gitSha, originalData.gitSha);
            assert.strictEqual(restored.treeEntries.length, originalData.treeEntries.length);
            assert.strictEqual(restored.treeEntries[0].label, originalData.treeEntries[0].label);
        });
    });
});
