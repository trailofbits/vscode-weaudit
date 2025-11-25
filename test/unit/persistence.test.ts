import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as sinon from "sinon";

import {
    SerializedData,
    validateSerializedData,
    createDefaultSerializedData,
    EntryType,
    FindingSeverity,
    FindingDifficulty,
    FindingType,
} from "../../src/types";

/**
 * Helper to create a temporary directory for test files
 */
function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "weaudit-test-"));
}

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
 * Helper to create a valid SerializedData object
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

describe("File Persistence", () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = createTempDir();
    });

    afterEach(() => {
        // Clean up temp directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    describe("Loading .weaudit files", () => {
        it("parses valid JSON file successfully", () => {
            const data = createValidSerializedData();
            const filePath = path.join(tempDir, "test.weaudit");
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

            const content = fs.readFileSync(filePath, "utf-8");
            const parsed: SerializedData = JSON.parse(content);

            expect(validateSerializedData(parsed)).to.equal(true);
            expect(parsed.treeEntries).to.have.length(1);
            expect(parsed.treeEntries[0].label).to.equal("Test Finding");
        });

        it("handles missing file gracefully", () => {
            const filePath = path.join(tempDir, "nonexistent.weaudit");

            expect(fs.existsSync(filePath)).to.equal(false);

            // Simulate how the extension would handle missing file
            let data: SerializedData | undefined;
            if (fs.existsSync(filePath)) {
                data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
            } else {
                data = createDefaultSerializedData();
            }

            expect(validateSerializedData(data)).to.equal(true);
            expect(data.treeEntries).to.have.length(0);
        });

        it("handles corrupt JSON file", () => {
            const filePath = path.join(tempDir, "corrupt.weaudit");
            fs.writeFileSync(filePath, "{ invalid json }}}");

            let parseError: Error | undefined;
            try {
                JSON.parse(fs.readFileSync(filePath, "utf-8"));
            } catch (e) {
                parseError = e as Error;
            }

            expect(parseError).to.be.instanceOf(SyntaxError);
        });

        it("handles empty file", () => {
            const filePath = path.join(tempDir, "empty.weaudit");
            fs.writeFileSync(filePath, "");

            const content = fs.readFileSync(filePath, "utf-8");
            expect(content).to.equal("");

            let parseError: Error | undefined;
            try {
                JSON.parse(content);
            } catch (e) {
                parseError = e as Error;
            }

            expect(parseError).to.be.instanceOf(SyntaxError);
        });

        it("rejects file with invalid schema", () => {
            const invalidData = {
                clientRemote: "",
                gitRemote: "",
                gitSha: "",
                treeEntries: [{ label: "missing fields" }], // Invalid entry
                auditedFiles: [],
                resolvedEntries: [],
            };
            const filePath = path.join(tempDir, "invalid.weaudit");
            fs.writeFileSync(filePath, JSON.stringify(invalidData));

            const content = fs.readFileSync(filePath, "utf-8");
            const parsed = JSON.parse(content);

            expect(validateSerializedData(parsed)).to.equal(false);
        });

        it("accepts legacy file without partiallyAuditedFiles", () => {
            const legacyData = {
                clientRemote: "",
                gitRemote: "",
                gitSha: "",
                treeEntries: [],
                auditedFiles: [],
                resolvedEntries: [],
                // partiallyAuditedFiles intentionally omitted
            };
            const filePath = path.join(tempDir, "legacy.weaudit");
            fs.writeFileSync(filePath, JSON.stringify(legacyData));

            const content = fs.readFileSync(filePath, "utf-8");
            const parsed = JSON.parse(content);

            expect(validateSerializedData(parsed)).to.equal(true);
        });
    });

    describe("Saving .weaudit files", () => {
        it("creates .vscode directory if missing", () => {
            const vscodeDir = path.join(tempDir, ".vscode");
            expect(fs.existsSync(vscodeDir)).to.equal(false);

            fs.mkdirSync(vscodeDir, { recursive: true });

            expect(fs.existsSync(vscodeDir)).to.equal(true);
        });

        it("writes valid JSON to file", () => {
            const data = createValidSerializedData();
            const vscodeDir = path.join(tempDir, ".vscode");
            fs.mkdirSync(vscodeDir, { recursive: true });
            const filePath = path.join(vscodeDir, "testuser.weaudit");

            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

            expect(fs.existsSync(filePath)).to.equal(true);

            const content = fs.readFileSync(filePath, "utf-8");
            const parsed = JSON.parse(content);

            expect(validateSerializedData(parsed)).to.equal(true);
            expect(parsed.treeEntries).to.have.length(1);
        });

        it("overwrites existing file", () => {
            const vscodeDir = path.join(tempDir, ".vscode");
            fs.mkdirSync(vscodeDir, { recursive: true });
            const filePath = path.join(vscodeDir, "testuser.weaudit");

            // Write initial data
            const initialData = createDefaultSerializedData();
            fs.writeFileSync(filePath, JSON.stringify(initialData));

            // Write updated data
            const updatedData = createValidSerializedData();
            fs.writeFileSync(filePath, JSON.stringify(updatedData));

            const content = fs.readFileSync(filePath, "utf-8");
            const parsed = JSON.parse(content);

            expect(parsed.treeEntries).to.have.length(1);
        });

        it("preserves other users data when saving", () => {
            // Simulate multiple users' data in separate files
            const vscodeDir = path.join(tempDir, ".vscode");
            fs.mkdirSync(vscodeDir, { recursive: true });

            // Alice's data
            const aliceData = createValidSerializedData();
            aliceData.treeEntries[0].author = "alice";
            aliceData.treeEntries[0].label = "Alice's finding";
            fs.writeFileSync(path.join(vscodeDir, "alice.weaudit"), JSON.stringify(aliceData));

            // Bob's data
            const bobData = createValidSerializedData();
            bobData.treeEntries[0].author = "bob";
            bobData.treeEntries[0].label = "Bob's finding";
            fs.writeFileSync(path.join(vscodeDir, "bob.weaudit"), JSON.stringify(bobData));

            // Verify both files exist and have correct data
            const aliceParsed = JSON.parse(fs.readFileSync(path.join(vscodeDir, "alice.weaudit"), "utf-8"));
            const bobParsed = JSON.parse(fs.readFileSync(path.join(vscodeDir, "bob.weaudit"), "utf-8"));

            expect(aliceParsed.treeEntries[0].label).to.equal("Alice's finding");
            expect(bobParsed.treeEntries[0].label).to.equal("Bob's finding");
        });

        it("handles special characters in file content", () => {
            const data = createValidSerializedData();
            data.treeEntries[0].label = 'Special chars: "quotes" & <brackets> \n newlines';
            data.treeEntries[0].details.description = "Unicode: \u00e9\u00e8\u00ea \u4e2d\u6587";

            const vscodeDir = path.join(tempDir, ".vscode");
            fs.mkdirSync(vscodeDir, { recursive: true });
            const filePath = path.join(vscodeDir, "special.weaudit");

            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

            const content = fs.readFileSync(filePath, "utf-8");
            const parsed = JSON.parse(content);

            expect(parsed.treeEntries[0].label).to.equal('Special chars: "quotes" & <brackets> \n newlines');
            expect(parsed.treeEntries[0].details.description).to.equal("Unicode: \u00e9\u00e8\u00ea \u4e2d\u6587");
        });
    });

    describe("Day log operations", () => {
        it("loads day log from .weauditdaylog file", () => {
            const dayLogPath = path.join(tempDir, ".weauditdaylog");
            const dayLogData = [
                ["2024-01-15", ["file1.ts", "file2.ts"]],
                ["2024-01-16", ["file3.ts"]],
            ];
            fs.writeFileSync(dayLogPath, JSON.stringify(dayLogData, null, 2));

            const content = fs.readFileSync(dayLogPath, "utf-8");
            const parsed = new Map<string, string[]>(JSON.parse(content));

            expect(parsed.size).to.equal(2);
            expect(parsed.get("2024-01-15")).to.deep.equal(["file1.ts", "file2.ts"]);
            expect(parsed.get("2024-01-16")).to.deep.equal(["file3.ts"]);
        });

        it("handles missing day log file", () => {
            const dayLogPath = path.join(tempDir, ".weauditdaylog");
            expect(fs.existsSync(dayLogPath)).to.equal(false);

            // Simulate fallback to empty map
            let dayLog: Map<string, string[]>;
            if (fs.existsSync(dayLogPath)) {
                dayLog = new Map(JSON.parse(fs.readFileSync(dayLogPath, "utf-8")));
            } else {
                dayLog = new Map();
            }

            expect(dayLog.size).to.equal(0);
        });

        it("handles corrupt day log file", () => {
            const dayLogPath = path.join(tempDir, ".weauditdaylog");
            fs.writeFileSync(dayLogPath, "not valid json");

            let parseError: Error | undefined;
            try {
                JSON.parse(fs.readFileSync(dayLogPath, "utf-8"));
            } catch (e) {
                parseError = e as Error;
            }

            expect(parseError).to.be.instanceOf(SyntaxError);
        });

        it("persists day log changes", () => {
            const dayLogPath = path.join(tempDir, ".weauditdaylog");
            const dayLog = new Map<string, string[]>();

            // Add entries
            dayLog.set("2024-01-17", ["newfile.ts"]);
            dayLog.set("2024-01-18", ["another.ts", "more.ts"]);

            // Save
            fs.writeFileSync(dayLogPath, JSON.stringify(Array.from(dayLog), null, 2));

            // Reload and verify
            const content = fs.readFileSync(dayLogPath, "utf-8");
            const reloaded = new Map<string, string[]>(JSON.parse(content));

            expect(reloaded.size).to.equal(2);
            expect(reloaded.get("2024-01-17")).to.deep.equal(["newfile.ts"]);
            expect(reloaded.get("2024-01-18")).to.deep.equal(["another.ts", "more.ts"]);
        });

        it("updates existing day log entries", () => {
            const dayLogPath = path.join(tempDir, ".weauditdaylog");

            // Initial data
            const dayLog = new Map<string, string[]>();
            dayLog.set("2024-01-19", ["initial.ts"]);
            fs.writeFileSync(dayLogPath, JSON.stringify(Array.from(dayLog), null, 2));

            // Load, modify, save
            const loaded = new Map<string, string[]>(JSON.parse(fs.readFileSync(dayLogPath, "utf-8")));
            loaded.get("2024-01-19")!.push("added.ts");
            fs.writeFileSync(dayLogPath, JSON.stringify(Array.from(loaded), null, 2));

            // Verify
            const reloaded = new Map<string, string[]>(JSON.parse(fs.readFileSync(dayLogPath, "utf-8")));
            expect(reloaded.get("2024-01-19")).to.deep.equal(["initial.ts", "added.ts"]);
        });

        it("handles empty day log", () => {
            const dayLogPath = path.join(tempDir, ".weauditdaylog");
            fs.writeFileSync(dayLogPath, "[]");

            const content = fs.readFileSync(dayLogPath, "utf-8");
            const dayLog = new Map<string, string[]>(JSON.parse(content));

            expect(dayLog.size).to.equal(0);
        });
    });

    describe("File discovery", () => {
        it("finds .weaudit files in .vscode directory", () => {
            const vscodeDir = path.join(tempDir, ".vscode");
            fs.mkdirSync(vscodeDir, { recursive: true });

            // Create multiple .weaudit files
            fs.writeFileSync(path.join(vscodeDir, "alice.weaudit"), JSON.stringify(createDefaultSerializedData()));
            fs.writeFileSync(path.join(vscodeDir, "bob.weaudit"), JSON.stringify(createDefaultSerializedData()));
            fs.writeFileSync(path.join(vscodeDir, "settings.json"), "{}"); // Non-.weaudit file

            const files = fs.readdirSync(vscodeDir);
            const weauditFiles = files.filter((f) => f.endsWith(".weaudit"));

            expect(weauditFiles).to.have.length(2);
            expect(weauditFiles).to.include("alice.weaudit");
            expect(weauditFiles).to.include("bob.weaudit");
        });

        it("handles missing .vscode directory", () => {
            const vscodeDir = path.join(tempDir, ".vscode");
            expect(fs.existsSync(vscodeDir)).to.equal(false);

            let weauditFiles: string[] = [];
            if (fs.existsSync(vscodeDir)) {
                weauditFiles = fs.readdirSync(vscodeDir).filter((f) => f.endsWith(".weaudit"));
            }

            expect(weauditFiles).to.have.length(0);
        });

        it("extracts username from .weaudit filename", () => {
            const filename = "alice.weaudit";
            const username = filename.replace(".weaudit", "");

            expect(username).to.equal("alice");
        });
    });
});
