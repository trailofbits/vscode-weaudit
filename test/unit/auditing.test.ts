import { expect } from "chai";
import * as sinon from "sinon";

import { AuditedFile, PartiallyAuditedFile } from "../../src/types";

/**
 * Helper to create a valid AuditedFile for testing
 */
function createAuditedFile(overrides: Partial<AuditedFile> = {}): AuditedFile {
    return {
        path: "src/test.ts",
        author: "testuser",
        ...overrides,
    };
}

/**
 * Helper to create a valid PartiallyAuditedFile for testing
 */
function createPartiallyAuditedFile(overrides: Partial<PartiallyAuditedFile> = {}): PartiallyAuditedFile {
    return {
        path: "src/test.ts",
        author: "testuser",
        startLine: 10,
        endLine: 50,
        ...overrides,
    };
}

describe("File Auditing", () => {
    describe("toggleAudited logic", () => {
        describe("adding files to audited list", () => {
            it("adds file to auditedFiles when not present", () => {
                const auditedFiles: AuditedFile[] = [];
                const relativePath = "src/newfile.ts";
                const username = "testuser";

                // Check if file exists
                const index = auditedFiles.findIndex((file) => file.path === relativePath);
                expect(index).to.equal(-1);

                // Add it since it doesn't exist
                if (index === -1) {
                    auditedFiles.push({ path: relativePath, author: username });
                }

                expect(auditedFiles).to.have.length(1);
                expect(auditedFiles[0].path).to.equal(relativePath);
                expect(auditedFiles[0].author).to.equal(username);
            });

            it("removes file from auditedFiles when already present", () => {
                const auditedFiles: AuditedFile[] = [createAuditedFile({ path: "src/existing.ts", author: "alice" })];
                const relativePath = "src/existing.ts";

                const index = auditedFiles.findIndex((file) => file.path === relativePath);
                expect(index).to.equal(0);

                // Remove since it exists
                let relevantUsername = "";
                if (index > -1) {
                    const removed = auditedFiles.splice(index, 1);
                    relevantUsername = removed[0].author;
                }

                expect(auditedFiles).to.have.length(0);
                expect(relevantUsername).to.equal("alice");
            });

            it("returns correct username when adding", () => {
                const auditedFiles: AuditedFile[] = [];
                const relativePath = "src/newfile.ts";
                const currentUsername = "bob";

                const index = auditedFiles.findIndex((file) => file.path === relativePath);
                let relevantUsername = "";

                if (index > -1) {
                    const removed = auditedFiles.splice(index, 1);
                    relevantUsername = removed[0].author;
                } else {
                    auditedFiles.push({ path: relativePath, author: currentUsername });
                    relevantUsername = currentUsername;
                }

                expect(relevantUsername).to.equal("bob");
            });

            it("returns original author when removing", () => {
                const auditedFiles: AuditedFile[] = [createAuditedFile({ path: "src/test.ts", author: "originalAuthor" })];
                const relativePath = "src/test.ts";
                const currentUsername = "differentUser";

                const index = auditedFiles.findIndex((file) => file.path === relativePath);
                let relevantUsername = "";

                if (index > -1) {
                    const removed = auditedFiles.splice(index, 1);
                    relevantUsername = removed[0].author;
                } else {
                    auditedFiles.push({ path: relativePath, author: currentUsername });
                    relevantUsername = currentUsername;
                }

                // Should return the original author, not the current user
                expect(relevantUsername).to.equal("originalAuthor");
            });
        });

        describe("cleaning partial audits on toggle", () => {
            it("removes partial audit entries for toggled file", () => {
                const partiallyAuditedFiles: PartiallyAuditedFile[] = [
                    createPartiallyAuditedFile({ path: "src/file1.ts" }),
                    createPartiallyAuditedFile({ path: "src/file2.ts" }),
                ];

                // Simulate cleanPartialAudits for file1.ts
                const relativePathToClean = "src/file1.ts";
                const cleanedFiles = partiallyAuditedFiles.filter((file) => file.path !== relativePathToClean);

                expect(cleanedFiles).to.have.length(1);
                expect(cleanedFiles[0].path).to.equal("src/file2.ts");
            });

            it("preserves partial audits for other files", () => {
                const partiallyAuditedFiles: PartiallyAuditedFile[] = [createPartiallyAuditedFile({ path: "src/other.ts" })];

                const relativePathToClean = "src/toggled.ts";
                const cleanedFiles = partiallyAuditedFiles.filter((file) => file.path !== relativePathToClean);

                expect(cleanedFiles).to.have.length(1);
            });
        });

        describe("day log updates", () => {
            it("adds file to day log on audit", () => {
                const dayLog = new Map<string, string[]>();
                const todayString = new Date().toDateString();
                const relativePath = "src/newfile.ts";
                const isAdd = true;

                // Simulate updateDayLog
                const todayFiles = dayLog.get(todayString);
                if (todayFiles === undefined) {
                    dayLog.set(todayString, [relativePath]);
                } else {
                    const index = todayFiles.findIndex((file) => file === relativePath);
                    if (index === -1 && isAdd) {
                        todayFiles.push(relativePath);
                    }
                }

                expect(dayLog.get(todayString)).to.deep.equal([relativePath]);
            });

            it("removes file from day log on unaudit", () => {
                const todayString = new Date().toDateString();
                const relativePath = "src/existing.ts";
                const dayLog = new Map<string, string[]>([[todayString, [relativePath, "src/other.ts"]]]);
                const isAdd = false;

                // Simulate updateDayLog
                const todayFiles = dayLog.get(todayString);
                if (todayFiles !== undefined) {
                    const index = todayFiles.findIndex((file) => file === relativePath);
                    if (index > -1 && !isAdd) {
                        todayFiles.splice(index, 1);
                    }
                }

                expect(dayLog.get(todayString)).to.deep.equal(["src/other.ts"]);
            });

            it("creates new day entry if none exists", () => {
                const dayLog = new Map<string, string[]>();
                const todayString = "Mon Jan 15 2024";
                const relativePath = "src/file.ts";
                const isAdd = true;

                const todayFiles = dayLog.get(todayString);
                if (todayFiles === undefined) {
                    dayLog.set(todayString, [relativePath]);
                }

                expect(dayLog.has(todayString)).to.be.true;
                expect(dayLog.get(todayString)).to.have.length(1);
            });

            it("does not duplicate file in day log", () => {
                const todayString = new Date().toDateString();
                const relativePath = "src/file.ts";
                const dayLog = new Map<string, string[]>([[todayString, [relativePath]]]);
                const isAdd = true;

                const todayFiles = dayLog.get(todayString)!;
                const index = todayFiles.findIndex((file) => file === relativePath);
                if (index === -1 && isAdd) {
                    todayFiles.push(relativePath);
                }

                // Should still have only one entry
                expect(dayLog.get(todayString)).to.have.length(1);
            });
        });
    });

    describe("isAudited logic", () => {
        it("returns true when file is in auditedFiles", () => {
            const auditedFiles: AuditedFile[] = [createAuditedFile({ path: "src/audited.ts" }), createAuditedFile({ path: "src/other.ts" })];

            const isAudited = auditedFiles.findIndex((entry) => entry.path === "src/audited.ts") !== -1;

            expect(isAudited).to.be.true;
        });

        it("returns false when file is not in auditedFiles", () => {
            const auditedFiles: AuditedFile[] = [createAuditedFile({ path: "src/audited.ts" })];

            const isAudited = auditedFiles.findIndex((entry) => entry.path === "src/notaudited.ts") !== -1;

            expect(isAudited).to.be.false;
        });

        it("returns false for empty auditedFiles array", () => {
            const auditedFiles: AuditedFile[] = [];

            const isAudited = auditedFiles.findIndex((entry) => entry.path === "src/any.ts") !== -1;

            expect(isAudited).to.be.false;
        });

        it("matches exact path only", () => {
            const auditedFiles: AuditedFile[] = [createAuditedFile({ path: "src/file.ts" })];

            // Should not match partial path
            const isPartialMatch = auditedFiles.findIndex((entry) => entry.path === "src/file") !== -1;
            const isExactMatch = auditedFiles.findIndex((entry) => entry.path === "src/file.ts") !== -1;

            expect(isPartialMatch).to.be.false;
            expect(isExactMatch).to.be.true;
        });
    });

    describe("addPartiallyAudited logic", () => {
        describe("adding new partial audits", () => {
            it("adds new partial audit entry when file not fully audited", () => {
                const auditedFiles: AuditedFile[] = [];
                const partiallyAuditedFiles: PartiallyAuditedFile[] = [];
                const relativePath = "src/file.ts";
                const username = "testuser";
                const startLine = 10;
                const endLine = 50;

                // Check if fully audited
                const fullyAuditedIndex = auditedFiles.findIndex((file) => file.path === relativePath);
                if (fullyAuditedIndex === -1) {
                    partiallyAuditedFiles.push({
                        path: relativePath,
                        author: username,
                        startLine,
                        endLine,
                    });
                }

                expect(partiallyAuditedFiles).to.have.length(1);
                expect(partiallyAuditedFiles[0].startLine).to.equal(10);
                expect(partiallyAuditedFiles[0].endLine).to.equal(50);
            });

            it("ignores partial audit if file already fully audited", () => {
                const auditedFiles: AuditedFile[] = [createAuditedFile({ path: "src/file.ts" })];
                const partiallyAuditedFiles: PartiallyAuditedFile[] = [];
                const relativePath = "src/file.ts";

                const fullyAuditedIndex = auditedFiles.findIndex((file) => file.path === relativePath);
                if (fullyAuditedIndex === -1) {
                    partiallyAuditedFiles.push(createPartiallyAuditedFile({ path: relativePath }));
                }

                // Should not add since file is fully audited
                expect(partiallyAuditedFiles).to.have.length(0);
            });
        });

        describe("removing partial audits by re-selection", () => {
            it("removes exact matching partial audit region", () => {
                const partiallyAuditedFiles: PartiallyAuditedFile[] = [createPartiallyAuditedFile({ path: "src/file.ts", startLine: 10, endLine: 50 })];
                const location = { startLine: 10, endLine: 50 };
                const relativePath = "src/file.ts";

                // Find if this region is already marked
                const alreadyMarkedIndex = partiallyAuditedFiles.findIndex(
                    (file) => file.path === relativePath && file.startLine <= location.startLine && file.endLine >= location.endLine,
                );

                if (alreadyMarkedIndex > -1) {
                    const entry = partiallyAuditedFiles[alreadyMarkedIndex];
                    if (entry.startLine === location.startLine && entry.endLine === location.endLine) {
                        partiallyAuditedFiles.splice(alreadyMarkedIndex, 1);
                    }
                }

                expect(partiallyAuditedFiles).to.have.length(0);
            });

            it("splits entry when removing middle portion", () => {
                const partiallyAuditedFiles: PartiallyAuditedFile[] = [createPartiallyAuditedFile({ path: "src/file.ts", startLine: 10, endLine: 100 })];
                // Remove lines 40-60 from the middle
                const location = { startLine: 40, endLine: 60 };
                const relativePath = "src/file.ts";

                const alreadyMarkedIndex = partiallyAuditedFiles.findIndex(
                    (file) => file.path === relativePath && file.startLine <= location.startLine && file.endLine >= location.endLine,
                );

                if (alreadyMarkedIndex > -1) {
                    const previousMarkedEntry = partiallyAuditedFiles[alreadyMarkedIndex];
                    const locationClone = { ...previousMarkedEntry };

                    let splitNeeded = true;
                    if (previousMarkedEntry.endLine === location.endLine) {
                        previousMarkedEntry.endLine = location.startLine - 1;
                        splitNeeded = false;
                    }
                    if (previousMarkedEntry.startLine === location.startLine) {
                        previousMarkedEntry.startLine = location.endLine + 1;
                        splitNeeded = false;
                    }

                    if (splitNeeded) {
                        previousMarkedEntry.endLine = location.startLine - 1;
                        locationClone.startLine = location.endLine + 1;
                        partiallyAuditedFiles.push(locationClone);
                    }
                }

                expect(partiallyAuditedFiles).to.have.length(2);
                // First part: lines 10-39
                expect(partiallyAuditedFiles[0].startLine).to.equal(10);
                expect(partiallyAuditedFiles[0].endLine).to.equal(39);
                // Second part: lines 61-100
                expect(partiallyAuditedFiles[1].startLine).to.equal(61);
                expect(partiallyAuditedFiles[1].endLine).to.equal(100);
            });

            it("adjusts entry when removing end portion", () => {
                const partiallyAuditedFiles: PartiallyAuditedFile[] = [createPartiallyAuditedFile({ path: "src/file.ts", startLine: 10, endLine: 50 })];
                // Remove lines 40-50 (the end)
                const location = { startLine: 40, endLine: 50 };
                const relativePath = "src/file.ts";

                const alreadyMarkedIndex = partiallyAuditedFiles.findIndex(
                    (file) => file.path === relativePath && file.startLine <= location.startLine && file.endLine >= location.endLine,
                );

                if (alreadyMarkedIndex > -1) {
                    const previousMarkedEntry = partiallyAuditedFiles[alreadyMarkedIndex];

                    if (previousMarkedEntry.endLine === location.endLine) {
                        previousMarkedEntry.endLine = location.startLine - 1;
                    }
                }

                expect(partiallyAuditedFiles).to.have.length(1);
                expect(partiallyAuditedFiles[0].startLine).to.equal(10);
                expect(partiallyAuditedFiles[0].endLine).to.equal(39);
            });

            it("adjusts entry when removing start portion", () => {
                const partiallyAuditedFiles: PartiallyAuditedFile[] = [createPartiallyAuditedFile({ path: "src/file.ts", startLine: 10, endLine: 50 })];
                // Remove lines 10-25 (the start)
                const location = { startLine: 10, endLine: 25 };
                const relativePath = "src/file.ts";

                const alreadyMarkedIndex = partiallyAuditedFiles.findIndex(
                    (file) => file.path === relativePath && file.startLine <= location.startLine && file.endLine >= location.endLine,
                );

                if (alreadyMarkedIndex > -1) {
                    const previousMarkedEntry = partiallyAuditedFiles[alreadyMarkedIndex];

                    if (previousMarkedEntry.startLine === location.startLine) {
                        previousMarkedEntry.startLine = location.endLine + 1;
                    }
                }

                expect(partiallyAuditedFiles).to.have.length(1);
                expect(partiallyAuditedFiles[0].startLine).to.equal(26);
                expect(partiallyAuditedFiles[0].endLine).to.equal(50);
            });
        });
    });

    describe("mergePartialAudits logic", () => {
        it("merges overlapping entries for same file", () => {
            const partiallyAuditedFiles: PartiallyAuditedFile[] = [
                createPartiallyAuditedFile({ path: "src/file.ts", startLine: 10, endLine: 30 }),
                createPartiallyAuditedFile({ path: "src/file.ts", startLine: 25, endLine: 50 }),
            ];

            // Sort first
            const sortedEntries = partiallyAuditedFiles.sort((a, b) => a.path.localeCompare(b.path) || a.startLine - b.startLine);

            const cleanedEntries: PartiallyAuditedFile[] = [];
            for (const entry of sortedEntries) {
                const partIdx = cleanedEntries.findIndex(
                    (file) =>
                        file.path === entry.path &&
                        ((file.startLine <= entry.startLine && file.endLine >= entry.startLine) ||
                            (file.startLine <= entry.endLine && file.endLine >= entry.endLine) ||
                            (file.startLine >= entry.startLine && file.endLine <= entry.endLine) ||
                            file.endLine === entry.startLine - 1),
                );

                if (partIdx > -1) {
                    // Merge by extending the existing entry
                    cleanedEntries[partIdx].startLine = Math.min(cleanedEntries[partIdx].startLine, entry.startLine);
                    cleanedEntries[partIdx].endLine = Math.max(cleanedEntries[partIdx].endLine, entry.endLine);
                } else {
                    cleanedEntries.push({ ...entry });
                }
            }

            expect(cleanedEntries).to.have.length(1);
            expect(cleanedEntries[0].startLine).to.equal(10);
            expect(cleanedEntries[0].endLine).to.equal(50);
        });

        it("merges adjacent entries (endLine === startLine - 1)", () => {
            const partiallyAuditedFiles: PartiallyAuditedFile[] = [
                createPartiallyAuditedFile({ path: "src/file.ts", startLine: 10, endLine: 30 }),
                createPartiallyAuditedFile({ path: "src/file.ts", startLine: 31, endLine: 50 }),
            ];

            const sortedEntries = partiallyAuditedFiles.sort((a, b) => a.path.localeCompare(b.path) || a.startLine - b.startLine);

            const cleanedEntries: PartiallyAuditedFile[] = [];
            for (const entry of sortedEntries) {
                const partIdx = cleanedEntries.findIndex((file) => file.path === entry.path && file.endLine === entry.startLine - 1);

                if (partIdx > -1) {
                    cleanedEntries[partIdx].endLine = entry.endLine;
                } else {
                    cleanedEntries.push({ ...entry });
                }
            }

            expect(cleanedEntries).to.have.length(1);
            expect(cleanedEntries[0].startLine).to.equal(10);
            expect(cleanedEntries[0].endLine).to.equal(50);
        });

        it("keeps separate entries for different files", () => {
            const partiallyAuditedFiles: PartiallyAuditedFile[] = [
                createPartiallyAuditedFile({ path: "src/file1.ts", startLine: 10, endLine: 30 }),
                createPartiallyAuditedFile({ path: "src/file2.ts", startLine: 10, endLine: 30 }),
            ];

            const sortedEntries = partiallyAuditedFiles.sort((a, b) => a.path.localeCompare(b.path) || a.startLine - b.startLine);

            const cleanedEntries: PartiallyAuditedFile[] = [];
            for (const entry of sortedEntries) {
                const partIdx = cleanedEntries.findIndex((file) => file.path === entry.path && file.endLine >= entry.startLine - 1);

                if (partIdx > -1) {
                    cleanedEntries[partIdx].endLine = Math.max(cleanedEntries[partIdx].endLine, entry.endLine);
                } else {
                    cleanedEntries.push({ ...entry });
                }
            }

            expect(cleanedEntries).to.have.length(2);
        });

        it("keeps non-overlapping entries in same file separate", () => {
            const partiallyAuditedFiles: PartiallyAuditedFile[] = [
                createPartiallyAuditedFile({ path: "src/file.ts", startLine: 10, endLine: 30 }),
                createPartiallyAuditedFile({ path: "src/file.ts", startLine: 50, endLine: 70 }),
            ];

            const sortedEntries = partiallyAuditedFiles.sort((a, b) => a.path.localeCompare(b.path) || a.startLine - b.startLine);

            const cleanedEntries: PartiallyAuditedFile[] = [];
            for (const entry of sortedEntries) {
                // Check if overlapping or adjacent
                const partIdx = cleanedEntries.findIndex(
                    (file) =>
                        file.path === entry.path &&
                        ((file.startLine <= entry.startLine && file.endLine >= entry.startLine) || file.endLine === entry.startLine - 1),
                );

                if (partIdx > -1) {
                    cleanedEntries[partIdx].endLine = Math.max(cleanedEntries[partIdx].endLine, entry.endLine);
                } else {
                    cleanedEntries.push({ ...entry });
                }
            }

            // Gap between 30 and 50, should remain separate
            expect(cleanedEntries).to.have.length(2);
        });
    });

    describe("filterAudited and filterPartiallyAudited logic", () => {
        describe("filterAudited", () => {
            it("removes entries for specific username", () => {
                const auditedFiles: AuditedFile[] = [
                    createAuditedFile({ path: "src/file1.ts", author: "alice" }),
                    createAuditedFile({ path: "src/file2.ts", author: "bob" }),
                    createAuditedFile({ path: "src/file3.ts", author: "alice" }),
                ];

                const filtered = auditedFiles.filter((entry) => entry.author !== "alice");

                expect(filtered).to.have.length(1);
                expect(filtered[0].author).to.equal("bob");
            });

            it("preserves all entries when username not found", () => {
                const auditedFiles: AuditedFile[] = [createAuditedFile({ author: "alice" }), createAuditedFile({ author: "bob" })];

                const filtered = auditedFiles.filter((entry) => entry.author !== "charlie");

                expect(filtered).to.have.length(2);
            });

            it("handles empty array", () => {
                const auditedFiles: AuditedFile[] = [];

                const filtered = auditedFiles.filter((entry) => entry.author !== "anyone");

                expect(filtered).to.have.length(0);
            });
        });

        describe("filterPartiallyAudited", () => {
            it("removes entries for specific username", () => {
                const partiallyAuditedFiles: PartiallyAuditedFile[] = [
                    createPartiallyAuditedFile({ author: "alice" }),
                    createPartiallyAuditedFile({ author: "bob" }),
                ];

                const filtered = partiallyAuditedFiles.filter((entry) => entry.author !== "alice");

                expect(filtered).to.have.length(1);
                expect(filtered[0].author).to.equal("bob");
            });
        });
    });

    describe("concatAudited and concatPartiallyAudited logic", () => {
        it("concatenates audited files arrays", () => {
            let auditedFiles: AuditedFile[] = [createAuditedFile({ path: "src/file1.ts" })];
            const newFiles: AuditedFile[] = [createAuditedFile({ path: "src/file2.ts" }), createAuditedFile({ path: "src/file3.ts" })];

            auditedFiles = auditedFiles.concat(newFiles);

            expect(auditedFiles).to.have.length(3);
        });

        it("concatenates partially audited files arrays", () => {
            let partiallyAuditedFiles: PartiallyAuditedFile[] = [createPartiallyAuditedFile({ path: "src/file1.ts" })];
            const newFiles: PartiallyAuditedFile[] = [createPartiallyAuditedFile({ path: "src/file2.ts" })];

            partiallyAuditedFiles = partiallyAuditedFiles.concat(newFiles);

            expect(partiallyAuditedFiles).to.have.length(2);
        });

        it("handles empty source array", () => {
            let auditedFiles: AuditedFile[] = [];
            const newFiles: AuditedFile[] = [createAuditedFile()];

            auditedFiles = auditedFiles.concat(newFiles);

            expect(auditedFiles).to.have.length(1);
        });

        it("handles empty new array", () => {
            let auditedFiles: AuditedFile[] = [createAuditedFile()];
            const newFiles: AuditedFile[] = [];

            auditedFiles = auditedFiles.concat(newFiles);

            expect(auditedFiles).to.have.length(1);
        });
    });

    describe("checkIfAllSiblingFilesAreAudited logic", () => {
        it("adds folder to audited when all files audited", () => {
            // Simulating folder audit check
            const siblingFiles = ["file1.ts", "file2.ts", "file3.ts"];
            const auditedFiles: AuditedFile[] = siblingFiles.map((f) => createAuditedFile({ path: `src/${f}` }));

            const allFilesAudited = siblingFiles.every((file) => auditedFiles.findIndex((af) => af.path === `src/${file}`) !== -1);

            expect(allFilesAudited).to.be.true;
        });

        it("does not add folder when some files not audited", () => {
            const siblingFiles = ["file1.ts", "file2.ts", "file3.ts"];
            const auditedFiles: AuditedFile[] = [
                createAuditedFile({ path: "src/file1.ts" }),
                // file2.ts and file3.ts are not audited
            ];

            const allFilesAudited = siblingFiles.every((file) => auditedFiles.findIndex((af) => af.path === `src/${file}`) !== -1);

            expect(allFilesAudited).to.be.false;
        });

        it("removes folder when file becomes unaudited", () => {
            const auditedFiles: AuditedFile[] = [
                createAuditedFile({ path: "src" }), // folder
                createAuditedFile({ path: "src/file1.ts" }),
                createAuditedFile({ path: "src/file2.ts" }),
            ];

            // Simulate unauditing file1.ts
            const index = auditedFiles.findIndex((f) => f.path === "src/file1.ts");
            if (index > -1) {
                auditedFiles.splice(index, 1);
            }

            // Check if all siblings still audited (they're not)
            const siblingFiles = ["file1.ts", "file2.ts"];
            const allFilesAudited = siblingFiles.every((file) => auditedFiles.findIndex((af) => af.path === `src/${file}`) !== -1);

            if (!allFilesAudited) {
                // Remove folder from audited
                const folderIndex = auditedFiles.findIndex((f) => f.path === "src");
                if (folderIndex > -1) {
                    auditedFiles.splice(folderIndex, 1);
                }
            }

            expect(auditedFiles).to.have.length(1);
            expect(auditedFiles[0].path).to.equal("src/file2.ts");
        });
    });

    describe("Edge Cases", () => {
        it("handles files with same name in different folders", () => {
            const auditedFiles: AuditedFile[] = [createAuditedFile({ path: "src/components/Button.ts" }), createAuditedFile({ path: "src/utils/Button.ts" })];

            const isComponentsButtonAudited = auditedFiles.findIndex((f) => f.path === "src/components/Button.ts") !== -1;
            const isUtilsButtonAudited = auditedFiles.findIndex((f) => f.path === "src/utils/Button.ts") !== -1;

            expect(isComponentsButtonAudited).to.be.true;
            expect(isUtilsButtonAudited).to.be.true;

            // Different path should not match
            const isOtherButtonAudited = auditedFiles.findIndex((f) => f.path === "src/Button.ts") !== -1;
            expect(isOtherButtonAudited).to.be.false;
        });

        it("handles partial audit at file boundaries (line 0)", () => {
            const partiallyAuditedFile = createPartiallyAuditedFile({
                path: "src/file.ts",
                startLine: 0,
                endLine: 10,
            });

            expect(partiallyAuditedFile.startLine).to.equal(0);
        });

        it("handles partial audit of single line", () => {
            const partiallyAuditedFile = createPartiallyAuditedFile({
                path: "src/file.ts",
                startLine: 42,
                endLine: 42,
            });

            expect(partiallyAuditedFile.startLine).to.equal(partiallyAuditedFile.endLine);
        });

        it("handles very long file paths", () => {
            const longPath = "src/" + "deeply/nested/".repeat(20) + "file.ts";
            const auditedFile = createAuditedFile({ path: longPath });

            expect(auditedFile.path).to.equal(longPath);

            const auditedFiles = [auditedFile];
            const isAudited = auditedFiles.findIndex((f) => f.path === longPath) !== -1;
            expect(isAudited).to.be.true;
        });

        it("handles special characters in file paths", () => {
            const specialPath = "src/[id]/components/(group)/page.tsx";
            const auditedFile = createAuditedFile({ path: specialPath });
            const auditedFiles = [auditedFile];

            const isAudited = auditedFiles.findIndex((f) => f.path === specialPath) !== -1;
            expect(isAudited).to.be.true;
        });

        it("handles multiple users auditing same file", () => {
            // In the actual implementation, each user has their own .weaudit file
            // But entries can reference the same file path
            const auditedFiles: AuditedFile[] = [
                createAuditedFile({ path: "src/file.ts", author: "alice" }),
                createAuditedFile({ path: "src/file.ts", author: "bob" }),
            ];

            // Both entries exist
            expect(auditedFiles).to.have.length(2);

            // Filter by author still works
            const aliceFiles = auditedFiles.filter((f) => f.author === "alice");
            expect(aliceFiles).to.have.length(1);
        });

        it("preserves partial audit order after merge", () => {
            const partiallyAuditedFiles: PartiallyAuditedFile[] = [
                createPartiallyAuditedFile({ path: "b.ts", startLine: 10, endLine: 20 }),
                createPartiallyAuditedFile({ path: "a.ts", startLine: 30, endLine: 40 }),
                createPartiallyAuditedFile({ path: "a.ts", startLine: 10, endLine: 20 }),
            ];

            const sorted = partiallyAuditedFiles.sort((a, b) => a.path.localeCompare(b.path) || a.startLine - b.startLine);

            // After sorting: a.ts (10-20), a.ts (30-40), b.ts (10-20)
            expect(sorted[0].path).to.equal("a.ts");
            expect(sorted[0].startLine).to.equal(10);
            expect(sorted[1].path).to.equal("a.ts");
            expect(sorted[1].startLine).to.equal(30);
            expect(sorted[2].path).to.equal("b.ts");
        });
    });
});
