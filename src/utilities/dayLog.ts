/** A reviewed region with zero-based, inclusive line bounds. */
export interface ReviewedRegion {
    path: string;
    startLine: number;
    endLine: number;
}

/** Strings are workspace-relative paths for whole-file reviews; objects represent reviewed regions. */
export type DayLogEntry = string | ReviewedRegion;

/** Add or remove a region, merging overlaps and preserving unrelated daily entries. */
export function updateRegionLog(entries: DayLogEntry[], region: ReviewedRegion, add: boolean): DayLogEntry[] {
    if (entries.includes(region.path)) {
        return entries;
    }
    const unrelated = entries.filter((entry) => typeof entry === "string" || entry.path !== region.path);
    let regions = entries.filter((entry): entry is ReviewedRegion => typeof entry !== "string" && entry.path === region.path);
    if (add) {
        regions = [...regions, { ...region }];
    } else {
        regions = regions.flatMap((entry) => {
            if (entry.endLine < region.startLine || entry.startLine > region.endLine) {
                return [entry];
            }
            const remaining: ReviewedRegion[] = [];
            if (entry.startLine < region.startLine) {
                remaining.push({ ...entry, endLine: region.startLine - 1 });
            }
            if (entry.endLine > region.endLine) {
                remaining.push({ ...entry, startLine: region.endLine + 1 });
            }
            return remaining;
        });
    }
    const merged: ReviewedRegion[] = [];
    for (const entry of regions.sort((a, b) => a.startLine - b.startLine)) {
        const previous = merged[merged.length - 1];
        if (previous && entry.startLine <= previous.endLine + 1) {
            previous.endLine = Math.max(previous.endLine, entry.endLine);
        } else {
            merged.push({ ...entry });
        }
    }
    return [...unrelated, ...merged];
}

/** Replace today's entries for a file when its whole-file review status changes. */
export function updateFileLog(entries: DayLogEntry[], filePath: string, add: boolean): DayLogEntry[] {
    const remaining = entries.filter((entry) => (typeof entry === "string" ? entry : entry.path) !== filePath);
    return add ? [...remaining, filePath] : remaining;
}

/** Count inclusive region bounds or whole-file newline characters, matching the legacy wc -l behavior. */
export function countReviewedLines(entry: DayLogEntry, readFile: (filePath: string) => string): number {
    return typeof entry === "string" ? (readFile(entry).match(/\n/g) ?? []).length : entry.endLine - entry.startLine + 1;
}
