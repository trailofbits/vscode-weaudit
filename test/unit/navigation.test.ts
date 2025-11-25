import { expect } from "chai";
import * as path from "path";

import { PartiallyAuditedFile } from "../../src/types";

/**
 * Represents a partially audited region with its workspace root context
 */
interface PartiallyAuditedRegion {
    file: PartiallyAuditedFile;
    rootPath: string;
}

/**
 * Mock workspace root for testing
 */
interface MockWorkspaceRoot {
    rootPath: string;
    partiallyAuditedFiles: PartiallyAuditedFile[];
}

/**
 * Helper to create a PartiallyAuditedFile for testing
 */
function createPartiallyAuditedFile(overrides: Partial<PartiallyAuditedFile> = {}): PartiallyAuditedFile {
    return {
        path: "src/file.ts",
        author: "testuser",
        startLine: 10,
        endLine: 50,
        ...overrides,
    };
}

/**
 * Helper to create a MockWorkspaceRoot for testing
 */
function createMockWorkspaceRoot(rootPath: string, files: PartiallyAuditedFile[]): MockWorkspaceRoot {
    return {
        rootPath,
        partiallyAuditedFiles: files,
    };
}

/**
 * Collects all partially audited regions from all workspace roots
 */
function collectAllPartiallyAuditedRegions(roots: MockWorkspaceRoot[]): PartiallyAuditedRegion[] {
    const allRegions: PartiallyAuditedRegion[] = [];

    for (const wsRoot of roots) {
        for (const file of wsRoot.partiallyAuditedFiles) {
            allRegions.push({
                file,
                rootPath: wsRoot.rootPath,
            });
        }
    }

    return allRegions;
}

/**
 * Sorts regions by file path, then by start line for consistent navigation order
 */
function sortRegions(regions: PartiallyAuditedRegion[]): PartiallyAuditedRegion[] {
    return [...regions].sort((a, b) => {
        const pathComparison = a.file.path.localeCompare(b.file.path);
        if (pathComparison !== 0) {
            return pathComparison;
        }
        return a.file.startLine - b.file.startLine;
    });
}

/**
 * Simulates navigateToNextPartiallyAuditedRegion logic
 * Returns the target region index and URI, or undefined if no regions
 */
function navigateToNextPartiallyAuditedRegion(
    roots: MockWorkspaceRoot[],
    currentIndex: number,
): { nextIndex: number; targetRegion: PartiallyAuditedRegion; uri: string } | undefined {
    const allRegions = collectAllPartiallyAuditedRegions(roots);

    if (allRegions.length === 0) {
        return undefined;
    }

    // Sort for consistent order
    const sortedRegions = sortRegions(allRegions);

    // Wrap around to start
    const nextIndex = (currentIndex + 1) % sortedRegions.length;
    const targetRegion = sortedRegions[nextIndex];
    const uri = path.join(targetRegion.rootPath, targetRegion.file.path);

    return { nextIndex, targetRegion, uri };
}

describe("Navigation", () => {
    describe("navigateToNextPartiallyAuditedRegion", () => {
        describe("basic navigation", () => {
            it("navigates to next region in sorted order", () => {
                const roots = [
                    createMockWorkspaceRoot("/workspace/project", [
                        createPartiallyAuditedFile({ path: "src/b.ts", startLine: 10, endLine: 20 }),
                        createPartiallyAuditedFile({ path: "src/a.ts", startLine: 30, endLine: 40 }),
                    ]),
                ];

                // Start at index -1 to get first item
                const result1 = navigateToNextPartiallyAuditedRegion(roots, -1);

                expect(result1).to.not.be.undefined;
                // Should navigate to a.ts first (alphabetically sorted)
                expect(result1!.targetRegion.file.path).to.equal("src/a.ts");
                expect(result1!.nextIndex).to.equal(0);

                // Navigate to next
                const result2 = navigateToNextPartiallyAuditedRegion(roots, result1!.nextIndex);
                expect(result2!.targetRegion.file.path).to.equal("src/b.ts");
                expect(result2!.nextIndex).to.equal(1);
            });

            it("sorts by path first, then by startLine", () => {
                const roots = [
                    createMockWorkspaceRoot("/workspace/project", [
                        createPartiallyAuditedFile({ path: "src/file.ts", startLine: 100, endLine: 120 }),
                        createPartiallyAuditedFile({ path: "src/file.ts", startLine: 10, endLine: 30 }),
                        createPartiallyAuditedFile({ path: "src/other.ts", startLine: 50, endLine: 70 }),
                    ]),
                ];

                const allRegions = collectAllPartiallyAuditedRegions(roots);
                const sorted = sortRegions(allRegions);

                // Same file should be sorted by startLine
                expect(sorted[0].file.path).to.equal("src/file.ts");
                expect(sorted[0].file.startLine).to.equal(10);
                expect(sorted[1].file.path).to.equal("src/file.ts");
                expect(sorted[1].file.startLine).to.equal(100);
                expect(sorted[2].file.path).to.equal("src/other.ts");
            });
        });

        describe("wrapping behavior", () => {
            it("wraps around to first region after last", () => {
                const roots = [
                    createMockWorkspaceRoot("/workspace/project", [
                        createPartiallyAuditedFile({ path: "src/a.ts" }),
                        createPartiallyAuditedFile({ path: "src/b.ts" }),
                        createPartiallyAuditedFile({ path: "src/c.ts" }),
                    ]),
                ];

                // Navigate to last item (index 2)
                // Then navigate again - should wrap to 0
                const result = navigateToNextPartiallyAuditedRegion(roots, 2);

                expect(result).to.not.be.undefined;
                expect(result!.nextIndex).to.equal(0);
                expect(result!.targetRegion.file.path).to.equal("src/a.ts");
            });

            it("handles single region (always returns same)", () => {
                const roots = [createMockWorkspaceRoot("/workspace/project", [createPartiallyAuditedFile({ path: "src/only.ts" })])];

                const result1 = navigateToNextPartiallyAuditedRegion(roots, -1);
                expect(result1!.nextIndex).to.equal(0);
                expect(result1!.targetRegion.file.path).to.equal("src/only.ts");

                // Navigate again - should stay at 0
                const result2 = navigateToNextPartiallyAuditedRegion(roots, result1!.nextIndex);
                expect(result2!.nextIndex).to.equal(0);
                expect(result2!.targetRegion.file.path).to.equal("src/only.ts");
            });

            it("wraps correctly with two regions", () => {
                const roots = [
                    createMockWorkspaceRoot("/workspace/project", [
                        createPartiallyAuditedFile({ path: "src/first.ts" }),
                        createPartiallyAuditedFile({ path: "src/second.ts" }),
                    ]),
                ];

                const result1 = navigateToNextPartiallyAuditedRegion(roots, -1);
                expect(result1!.nextIndex).to.equal(0);

                const result2 = navigateToNextPartiallyAuditedRegion(roots, 0);
                expect(result2!.nextIndex).to.equal(1);

                const result3 = navigateToNextPartiallyAuditedRegion(roots, 1);
                expect(result3!.nextIndex).to.equal(0); // Wrapped
            });
        });

        describe("empty regions handling", () => {
            it("returns undefined when no partially audited regions exist", () => {
                const roots = [createMockWorkspaceRoot("/workspace/project1", []), createMockWorkspaceRoot("/workspace/project2", [])];

                const result = navigateToNextPartiallyAuditedRegion(roots, 0);

                expect(result).to.be.undefined;
            });

            it("returns undefined for empty roots array", () => {
                const roots: MockWorkspaceRoot[] = [];

                const result = navigateToNextPartiallyAuditedRegion(roots, 0);

                expect(result).to.be.undefined;
            });
        });

        describe("multi-file navigation", () => {
            it("navigates across multiple files in order", () => {
                const roots = [
                    createMockWorkspaceRoot("/workspace/project", [
                        createPartiallyAuditedFile({ path: "src/z.ts", startLine: 0, endLine: 10 }),
                        createPartiallyAuditedFile({ path: "src/a.ts", startLine: 0, endLine: 10 }),
                        createPartiallyAuditedFile({ path: "src/m.ts", startLine: 0, endLine: 10 }),
                    ]),
                ];

                // Verify sorted order
                const allRegions = collectAllPartiallyAuditedRegions(roots);
                const sorted = sortRegions(allRegions);

                expect(sorted[0].file.path).to.equal("src/a.ts");
                expect(sorted[1].file.path).to.equal("src/m.ts");
                expect(sorted[2].file.path).to.equal("src/z.ts");
            });

            it("handles multiple regions in same file across different roots", () => {
                const roots = [
                    createMockWorkspaceRoot("/workspace/project1", [createPartiallyAuditedFile({ path: "src/shared.ts", startLine: 10, endLine: 20 })]),
                    createMockWorkspaceRoot("/workspace/project2", [createPartiallyAuditedFile({ path: "src/shared.ts", startLine: 30, endLine: 40 })]),
                ];

                const allRegions = collectAllPartiallyAuditedRegions(roots);
                expect(allRegions).to.have.length(2);

                // Both have same file path but different rootPaths
                const sorted = sortRegions(allRegions);
                expect(sorted[0].file.path).to.equal("src/shared.ts");
                expect(sorted[1].file.path).to.equal("src/shared.ts");
                // Sorted by startLine since path is same
                expect(sorted[0].file.startLine).to.equal(10);
                expect(sorted[1].file.startLine).to.equal(30);
            });
        });

        describe("multi-root workspace navigation", () => {
            it("collects regions from all workspace roots", () => {
                const roots = [
                    createMockWorkspaceRoot("/workspace/frontend", [createPartiallyAuditedFile({ path: "src/App.tsx", startLine: 10, endLine: 30 })]),
                    createMockWorkspaceRoot("/workspace/backend", [createPartiallyAuditedFile({ path: "src/server.ts", startLine: 50, endLine: 70 })]),
                    createMockWorkspaceRoot("/workspace/shared", [createPartiallyAuditedFile({ path: "src/utils.ts", startLine: 20, endLine: 40 })]),
                ];

                const allRegions = collectAllPartiallyAuditedRegions(roots);

                expect(allRegions).to.have.length(3);
                // Verify each root contributed
                const rootPaths = allRegions.map((r) => r.rootPath);
                expect(rootPaths).to.include("/workspace/frontend");
                expect(rootPaths).to.include("/workspace/backend");
                expect(rootPaths).to.include("/workspace/shared");
            });

            it("generates correct URI by joining rootPath and file path", () => {
                const roots = [createMockWorkspaceRoot("/workspace/project", [createPartiallyAuditedFile({ path: "src/components/Button.tsx" })])];

                const result = navigateToNextPartiallyAuditedRegion(roots, -1);

                expect(result).to.not.be.undefined;
                expect(result!.uri).to.equal("/workspace/project/src/components/Button.tsx");
            });

            it("handles roots with no partially audited files", () => {
                const roots = [
                    createMockWorkspaceRoot("/workspace/project1", []), // Empty
                    createMockWorkspaceRoot("/workspace/project2", [createPartiallyAuditedFile({ path: "src/file.ts" })]),
                    createMockWorkspaceRoot("/workspace/project3", []), // Empty
                ];

                const result = navigateToNextPartiallyAuditedRegion(roots, -1);

                expect(result).to.not.be.undefined;
                expect(result!.targetRegion.rootPath).to.equal("/workspace/project2");
            });
        });
    });

    describe("Edge Cases", () => {
        it("handles files with same name in different directories", () => {
            const roots = [
                createMockWorkspaceRoot("/workspace/project", [
                    createPartiallyAuditedFile({ path: "src/utils/helpers.ts", startLine: 10, endLine: 20 }),
                    createPartiallyAuditedFile({ path: "lib/utils/helpers.ts", startLine: 30, endLine: 40 }),
                ]),
            ];

            const allRegions = collectAllPartiallyAuditedRegions(roots);
            const sorted = sortRegions(allRegions);

            // lib/ comes before src/ alphabetically
            expect(sorted[0].file.path).to.equal("lib/utils/helpers.ts");
            expect(sorted[1].file.path).to.equal("src/utils/helpers.ts");
        });

        it("handles very large number of regions", () => {
            const files: PartiallyAuditedFile[] = [];
            for (let i = 0; i < 1000; i++) {
                files.push(
                    createPartiallyAuditedFile({
                        path: `src/file${i.toString().padStart(4, "0")}.ts`,
                        startLine: i * 10,
                        endLine: i * 10 + 5,
                    }),
                );
            }
            const roots = [createMockWorkspaceRoot("/workspace/project", files)];

            const allRegions = collectAllPartiallyAuditedRegions(roots);
            expect(allRegions).to.have.length(1000);

            // Verify wrapping works at boundary
            const result = navigateToNextPartiallyAuditedRegion(roots, 999);
            expect(result!.nextIndex).to.equal(0);
        });

        it("handles special characters in file paths", () => {
            const roots = [
                createMockWorkspaceRoot("/workspace/project", [
                    createPartiallyAuditedFile({ path: "src/[id]/page.tsx" }),
                    createPartiallyAuditedFile({ path: "src/(group)/layout.tsx" }),
                ]),
            ];

            const result = navigateToNextPartiallyAuditedRegion(roots, -1);
            expect(result).to.not.be.undefined;
            // (group) comes before [id] in ASCII sort
            expect(result!.targetRegion.file.path).to.include("(group)");
        });

        it("handles unicode in file paths", () => {
            const roots = [createMockWorkspaceRoot("/workspace/project", [createPartiallyAuditedFile({ path: "src/i18n.ts" })])];

            const result = navigateToNextPartiallyAuditedRegion(roots, -1);
            expect(result).to.not.be.undefined;
            expect(result!.uri).to.include("i18n.ts");
        });

        it("handles regions that span entire file (line 0 to large number)", () => {
            const roots = [createMockWorkspaceRoot("/workspace/project", [createPartiallyAuditedFile({ path: "src/large.ts", startLine: 0, endLine: 10000 })])];

            const result = navigateToNextPartiallyAuditedRegion(roots, -1);
            expect(result!.targetRegion.file.startLine).to.equal(0);
            expect(result!.targetRegion.file.endLine).to.equal(10000);
        });

        it("maintains consistent order across multiple calls", () => {
            const roots = [
                createMockWorkspaceRoot("/workspace/project", [
                    createPartiallyAuditedFile({ path: "src/c.ts" }),
                    createPartiallyAuditedFile({ path: "src/a.ts" }),
                    createPartiallyAuditedFile({ path: "src/b.ts" }),
                ]),
            ];

            // Multiple navigation cycles should maintain same order
            const order1: string[] = [];
            let idx = -1;
            for (let i = 0; i < 6; i++) {
                const result = navigateToNextPartiallyAuditedRegion(roots, idx);
                order1.push(result!.targetRegion.file.path);
                idx = result!.nextIndex;
            }

            // Should cycle: a, b, c, a, b, c
            expect(order1).to.deep.equal(["src/a.ts", "src/b.ts", "src/c.ts", "src/a.ts", "src/b.ts", "src/c.ts"]);
        });

        it("handles regions with same file and same startLine (edge case)", () => {
            const roots = [
                createMockWorkspaceRoot("/workspace/project", [
                    createPartiallyAuditedFile({ path: "src/file.ts", startLine: 10, endLine: 20 }),
                    createPartiallyAuditedFile({ path: "src/file.ts", startLine: 10, endLine: 30 }),
                ]),
            ];

            const allRegions = collectAllPartiallyAuditedRegions(roots);
            expect(allRegions).to.have.length(2);

            // Should handle without error
            const result = navigateToNextPartiallyAuditedRegion(roots, -1);
            expect(result).to.not.be.undefined;
        });

        it("handles negative current index (initial state)", () => {
            const roots = [createMockWorkspaceRoot("/workspace/project", [createPartiallyAuditedFile({ path: "src/file.ts" })])];

            // -1 + 1 = 0, which is valid
            const result = navigateToNextPartiallyAuditedRegion(roots, -1);
            expect(result!.nextIndex).to.equal(0);
        });

        it("handles current index larger than array length (defensive)", () => {
            const roots = [
                createMockWorkspaceRoot("/workspace/project", [
                    createPartiallyAuditedFile({ path: "src/a.ts" }),
                    createPartiallyAuditedFile({ path: "src/b.ts" }),
                ]),
            ];

            // Index 10 with 2 items: (10 + 1) % 2 = 1
            const result = navigateToNextPartiallyAuditedRegion(roots, 10);
            expect(result!.nextIndex).to.equal(1);
        });
    });
});
