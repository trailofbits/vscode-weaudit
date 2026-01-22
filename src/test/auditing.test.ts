import * as assert from "node:assert";
import type { PartiallyAuditedFile } from "../types";
import {
    adjustForEmptyLastLine,
    adjustSelectionEndLine,
    type LineRegion,
    mergePartiallyAuditedRegions,
    mergeRegions,
    regionsOverlapOrAdjacent,
    selectionContainedInRegion,
    splitRegionOnDeselect,
} from "../utilities/auditingUtils";

describe("auditingUtils", () => {
    describe("regionsOverlapOrAdjacent", () => {
        it("should return true when regions overlap (a.start within b)", () => {
            const a: LineRegion = { startLine: 5, endLine: 15 };
            const b: LineRegion = { startLine: 1, endLine: 10 };

            assert.strictEqual(regionsOverlapOrAdjacent(a, b), true);
        });

        it("should return true when regions overlap (a.end within b)", () => {
            const a: LineRegion = { startLine: 1, endLine: 8 };
            const b: LineRegion = { startLine: 5, endLine: 15 };

            assert.strictEqual(regionsOverlapOrAdjacent(a, b), true);
        });

        it("should return true when a contains b", () => {
            const a: LineRegion = { startLine: 1, endLine: 20 };
            const b: LineRegion = { startLine: 5, endLine: 15 };

            assert.strictEqual(regionsOverlapOrAdjacent(a, b), true);
        });

        it("should return true when regions are adjacent (a before b)", () => {
            const a: LineRegion = { startLine: 1, endLine: 10 };
            const b: LineRegion = { startLine: 11, endLine: 20 };

            assert.strictEqual(regionsOverlapOrAdjacent(a, b), true);
        });

        it("should return false when regions are not adjacent or overlapping", () => {
            const a: LineRegion = { startLine: 1, endLine: 10 };
            const b: LineRegion = { startLine: 15, endLine: 25 };

            assert.strictEqual(regionsOverlapOrAdjacent(a, b), false);
        });
    });

    describe("mergeRegions", () => {
        it("should merge overlapping regions", () => {
            const a: LineRegion = { startLine: 1, endLine: 10 };
            const b: LineRegion = { startLine: 5, endLine: 15 };

            const merged = mergeRegions(a, b);

            assert.strictEqual(merged.startLine, 1);
            assert.strictEqual(merged.endLine, 15);
        });

        it("should merge adjacent regions", () => {
            const a: LineRegion = { startLine: 1, endLine: 10 };
            const b: LineRegion = { startLine: 11, endLine: 20 };

            const merged = mergeRegions(a, b);

            assert.strictEqual(merged.startLine, 1);
            assert.strictEqual(merged.endLine, 20);
        });

        it("should handle when a contains b", () => {
            const a: LineRegion = { startLine: 1, endLine: 20 };
            const b: LineRegion = { startLine: 5, endLine: 15 };

            const merged = mergeRegions(a, b);

            assert.strictEqual(merged.startLine, 1);
            assert.strictEqual(merged.endLine, 20);
        });

        it("should handle when b contains a", () => {
            const a: LineRegion = { startLine: 5, endLine: 15 };
            const b: LineRegion = { startLine: 1, endLine: 20 };

            const merged = mergeRegions(a, b);

            assert.strictEqual(merged.startLine, 1);
            assert.strictEqual(merged.endLine, 20);
        });

        it("should handle identical regions", () => {
            const a: LineRegion = { startLine: 5, endLine: 10 };
            const b: LineRegion = { startLine: 5, endLine: 10 };

            const merged = mergeRegions(a, b);

            assert.strictEqual(merged.startLine, 5);
            assert.strictEqual(merged.endLine, 10);
        });

        it("should preserve min start and max end", () => {
            const a: LineRegion = { startLine: 10, endLine: 30 };
            const b: LineRegion = { startLine: 5, endLine: 25 };

            const merged = mergeRegions(a, b);

            assert.strictEqual(merged.startLine, 5);
            assert.strictEqual(merged.endLine, 30);
        });
    });

    describe("mergePartiallyAuditedRegions", () => {
        it("should merge overlapping regions for same file", () => {
            const regions: PartiallyAuditedFile[] = [
                { path: "src/test.ts", author: "user", startLine: 1, endLine: 10 },
                { path: "src/test.ts", author: "user", startLine: 5, endLine: 15 },
            ];

            const merged = mergePartiallyAuditedRegions(regions);

            assert.strictEqual(merged.length, 1);
            assert.strictEqual(merged[0].startLine, 1);
            assert.strictEqual(merged[0].endLine, 15);
        });

        it("should not merge regions for different files", () => {
            const regions: PartiallyAuditedFile[] = [
                { path: "src/a.ts", author: "user", startLine: 1, endLine: 10 },
                { path: "src/b.ts", author: "user", startLine: 1, endLine: 10 },
            ];

            const merged = mergePartiallyAuditedRegions(regions);

            assert.strictEqual(merged.length, 2);
        });

        it("should merge adjacent regions", () => {
            const regions: PartiallyAuditedFile[] = [
                { path: "src/test.ts", author: "user", startLine: 1, endLine: 10 },
                { path: "src/test.ts", author: "user", startLine: 11, endLine: 20 },
            ];

            const merged = mergePartiallyAuditedRegions(regions);

            assert.strictEqual(merged.length, 1);
            assert.strictEqual(merged[0].startLine, 1);
            assert.strictEqual(merged[0].endLine, 20);
        });

        it("should handle empty array", () => {
            const merged = mergePartiallyAuditedRegions([]);

            assert.deepStrictEqual(merged, []);
        });

        it("should not mutate input array", () => {
            const regions: PartiallyAuditedFile[] = [
                { path: "src/test.ts", author: "user", startLine: 1, endLine: 10 },
                { path: "src/test.ts", author: "user", startLine: 5, endLine: 15 },
            ];
            const originalLength = regions.length;

            mergePartiallyAuditedRegions(regions);

            assert.strictEqual(regions.length, originalLength);
        });
    });

    describe("selectionContainedInRegion", () => {
        it("should return true when selection is within region", () => {
            const selection: LineRegion = { startLine: 5, endLine: 8 };
            const region: LineRegion = { startLine: 1, endLine: 10 };

            assert.strictEqual(selectionContainedInRegion(selection, region), true);
        });

        it("should return true when selection equals region", () => {
            const selection: LineRegion = { startLine: 1, endLine: 10 };
            const region: LineRegion = { startLine: 1, endLine: 10 };

            assert.strictEqual(selectionContainedInRegion(selection, region), true);
        });

        it("should return false when selection extends beyond region", () => {
            const selection: LineRegion = { startLine: 5, endLine: 15 };
            const region: LineRegion = { startLine: 1, endLine: 10 };

            assert.strictEqual(selectionContainedInRegion(selection, region), false);
        });
    });

    describe("splitRegionOnDeselect", () => {
        it("should delete region when exact match", () => {
            const existing: LineRegion = { startLine: 1, endLine: 10 };
            const selection: LineRegion = { startLine: 1, endLine: 10 };

            const result = splitRegionOnDeselect(existing, selection);

            assert.strictEqual(result.deleted, true);
            assert.strictEqual(result.split, false);
        });

        it("should adjust end when selection has same end line", () => {
            const existing: LineRegion = { startLine: 1, endLine: 10 };
            const selection: LineRegion = { startLine: 5, endLine: 10 };

            const result = splitRegionOnDeselect(existing, selection);

            assert.strictEqual(result.modified, true);
            assert.strictEqual(result.deleted, false);
            assert.strictEqual(result.split, false);
            assert.strictEqual(existing.endLine, 4);
        });

        it("should adjust start when selection has same start line", () => {
            const existing: LineRegion = { startLine: 1, endLine: 10 };
            const selection: LineRegion = { startLine: 1, endLine: 5 };

            const result = splitRegionOnDeselect(existing, selection);

            assert.strictEqual(result.modified, true);
            assert.strictEqual(result.deleted, false);
            assert.strictEqual(result.split, false);
            assert.strictEqual(existing.startLine, 6);
        });

        it("should split region when selection is in middle", () => {
            const existing: LineRegion = { startLine: 1, endLine: 20 };
            const selection: LineRegion = { startLine: 8, endLine: 12 };

            const result = splitRegionOnDeselect(existing, selection);

            assert.strictEqual(result.split, true);
            assert.strictEqual(existing.startLine, 1);
            assert.strictEqual(existing.endLine, 7);
            assert.ok(result.newRegion);
            assert.strictEqual(result.newRegion.startLine, 13);
            assert.strictEqual(result.newRegion.endLine, 20);
        });
    });

    describe("adjustSelectionEndLine", () => {
        it("should decrement end line when end char is 0 and different from start", () => {
            const result = adjustSelectionEndLine(5, 10, 0);

            assert.strictEqual(result, 9);
        });

        it("should not adjust when end char is not 0", () => {
            const result = adjustSelectionEndLine(5, 10, 5);

            assert.strictEqual(result, 10);
        });

        it("should not adjust when start and end are same line", () => {
            const result = adjustSelectionEndLine(5, 5, 0);

            assert.strictEqual(result, 5);
        });
    });

    describe("adjustForEmptyLastLine", () => {
        it("should decrement when at last line and it is empty", () => {
            const result = adjustForEmptyLastLine(99, 50, 100, true);

            assert.strictEqual(result, 98);
        });

        it("should not go below start line", () => {
            const result = adjustForEmptyLastLine(99, 99, 100, true);

            assert.strictEqual(result, 99);
        });

        it("should not adjust when not at last line", () => {
            const result = adjustForEmptyLastLine(50, 10, 100, true);

            assert.strictEqual(result, 50);
        });
    });
});
