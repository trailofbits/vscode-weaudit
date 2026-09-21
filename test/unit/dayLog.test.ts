import * as assert from "node:assert";
import { countReviewedLines, DayLogEntry, updateFileLog, updateRegionLog } from "../../src/utilities/dayLog";

describe("Daily review log", () => {
    const region = { path: "src/file.ts", startLine: 2, endLine: 5 };

    it("counts inclusive regions without reading or counting the whole file", () => {
        assert.strictEqual(
            countReviewedLines(region, () => assert.fail("Unexpected file read")),
            4,
        );
        assert.strictEqual(
            countReviewedLines({ ...region, endLine: 2 }, () => ""),
            1,
        );
    });

    it("merges overlapping and adjacent selections without double counting", () => {
        let entries = updateRegionLog([], region, true);
        entries = updateRegionLog(entries, { ...region, startLine: 4, endLine: 8 }, true);
        entries = updateRegionLog(entries, { ...region, startLine: 9, endLine: 10 }, true);
        assert.deepStrictEqual(entries, [{ ...region, endLine: 10 }]);
    });

    it("splits and removes unmarked regions without changing the previous snapshot", () => {
        const previous = [region];
        const entries = updateRegionLog(previous, { ...region, startLine: 3, endLine: 4 }, false);
        assert.deepStrictEqual(entries, [
            { ...region, endLine: 2 },
            { ...region, startLine: 5 },
        ]);
        assert.deepStrictEqual(previous, [region]);
        assert.deepStrictEqual(updateRegionLog(entries, region, false), []);
    });

    it("keeps disjoint regions and other files separate", () => {
        const entries = updateRegionLog(["other.ts", region], { ...region, startLine: 10, endLine: 12 }, true);
        assert.strictEqual(entries.length, 3);
        assert.strictEqual(
            entries.reduce((sum, entry) => sum + countReviewedLines(entry, () => "a\nb\n"), 0),
            9,
        );
    });

    it("replaces regions with a whole-file review and removes them when unmarked", () => {
        const entries = updateFileLog([region, "other.ts"], region.path, true);
        assert.deepStrictEqual(entries, ["other.ts", region.path]);
        assert.deepStrictEqual(updateRegionLog(entries, region, true), entries);
        assert.deepStrictEqual(updateFileLog(entries, region.path, false), ["other.ts"]);
        assert.deepStrictEqual(updateFileLog([], region.path, false), []);
    });

    it("loads legacy and mixed logs after JSON persistence", () => {
        const legacy = JSON.parse('[["Mon Sep 21 2026",["src/file.ts"]]]') as [string, DayLogEntry[]][];
        const log = new Map(legacy);
        log.set("Tue Sep 22 2026", updateRegionLog([], region, true));
        const reloaded = new Map(JSON.parse(JSON.stringify([...log])) as [string, DayLogEntry[]][]);
        assert.deepStrictEqual(reloaded.get("Mon Sep 21 2026"), ["src/file.ts"]);
        assert.deepStrictEqual(reloaded.get("Tue Sep 22 2026"), [region]);
    });

    it("preserves whole-file newline counts for CRLF, empty files and final unterminated lines", () => {
        for (const [content, expected] of [
            ["a\r\nb\r\n", 2],
            ["", 0],
            ["a\nb", 1],
        ] as const) {
            assert.strictEqual(
                countReviewedLines("file.ts", () => content),
                expected,
            );
        }
    });
});
