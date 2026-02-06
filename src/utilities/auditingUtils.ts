import type { PartiallyAuditedFile } from "../types";

/**
 * A line region with start and end line numbers.
 */
export interface LineRegion {
    startLine: number;
    endLine: number;
}

/**
 * Result of splitting a region when deselecting a portion.
 */
export interface SplitResult {
    /** Whether the region was modified or split */
    modified: boolean;
    /** Whether the entire region was deleted (exact match) */
    deleted: boolean;
    /** Whether a split occurred (resulting in two regions) */
    split: boolean;
    /** The new region created by the split, if any */
    newRegion?: LineRegion;
}

/**
 * Checks if two regions overlap or are adjacent (can be merged).
 * Overlap patterns checked:
 * 1. a.start is within b's bounds
 * 2. a.end is within b's bounds
 * 3. a completely contains b
 * 4. a and b are adjacent (a.end + 1 === b.start or b.end + 1 === a.start)
 * @param a first region
 * @param b second region
 * @returns true if regions overlap or are adjacent
 */
export function regionsOverlapOrAdjacent(a: LineRegion, b: LineRegion): boolean {
    // a.start is within b's bounds
    if (b.startLine <= a.startLine && b.endLine >= a.startLine) {
        return true;
    }
    // a.end is within b's bounds
    if (b.startLine <= a.endLine && b.endLine >= a.endLine) {
        return true;
    }
    // a completely contains b
    if (a.startLine <= b.startLine && a.endLine >= b.endLine) {
        return true;
    }
    // Adjacent: a ends right before b starts
    if (a.endLine === b.startLine - 1) {
        return true;
    }
    // Adjacent: b ends right before a starts
    if (b.endLine === a.startLine - 1) {
        return true;
    }
    return false;
}

/**
 * Merges two overlapping or adjacent regions into one.
 * Takes the minimum start line and maximum end line.
 * @param a first region
 * @param b second region
 * @returns merged region
 */
export function mergeRegions(a: LineRegion, b: LineRegion): LineRegion {
    return {
        startLine: Math.min(a.startLine, b.startLine),
        endLine: Math.max(a.endLine, b.endLine),
    };
}

/**
 * Merges all overlapping or adjacent partially audited regions for the same file.
 * Regions are sorted by path then startLine before processing.
 * @param regions the regions to merge
 * @returns merged regions (new array, input is not mutated)
 */
export function mergePartiallyAuditedRegions(regions: PartiallyAuditedFile[]): PartiallyAuditedFile[] {
    if (regions.length === 0) {
        return [];
    }

    const cleanedEntries: PartiallyAuditedFile[] = [];
    // Sort first by path and startLine for the merge to work
    const sortedEntries = [...regions].sort((a, b) => a.path.localeCompare(b.path) || a.startLine - b.startLine);

    for (const entry of sortedEntries) {
        // Check if the current entry can be merged with an existing one
        const partIdx = cleanedEntries.findIndex(
            (file) =>
                // Only merge entries for the same file
                file.path === entry.path && regionsOverlapOrAdjacent(file, entry),
        );

        if (partIdx > -1) {
            // Merge with existing entry
            const existing = cleanedEntries[partIdx];
            const merged = mergeRegions(existing, entry);
            cleanedEntries[partIdx] = {
                ...existing,
                startLine: merged.startLine,
                endLine: merged.endLine,
            };
        } else {
            // Add as new entry
            cleanedEntries.push({ ...entry });
        }
    }

    return cleanedEntries;
}

/**
 * Checks if a selection is completely contained within an existing region.
 * @param selection the selection to check
 * @param region the region to check against
 * @returns true if selection is within region bounds
 */
export function selectionContainedInRegion(selection: LineRegion, region: LineRegion): boolean {
    return selection.startLine >= region.startLine && selection.endLine <= region.endLine;
}

/**
 * Splits or modifies a region when a portion is deselected.
 * Handles these cases:
 * 1. Exact match: delete the region entirely
 * 2. Same end line: adjust start of remaining region
 * 3. Same start line: adjust end of remaining region
 * 4. Middle selection: split into two regions
 * @param existing the existing region (will be mutated)
 * @param selection the selection to remove
 * @returns result describing what happened
 */
export function splitRegionOnDeselect(existing: LineRegion, selection: LineRegion): SplitResult {
    // Exact match - delete entire region
    if (existing.startLine === selection.startLine && existing.endLine === selection.endLine) {
        return { modified: true, deleted: true, split: false };
    }

    // Same end line - adjust the existing region's end
    if (existing.endLine === selection.endLine) {
        existing.endLine = selection.startLine - 1;
        return { modified: true, deleted: false, split: false };
    }

    // Same start line - adjust the existing region's start
    if (existing.startLine === selection.startLine) {
        existing.startLine = selection.endLine + 1;
        return { modified: true, deleted: false, split: false };
    }

    // Middle selection - split into two regions
    const newRegion: LineRegion = {
        startLine: selection.endLine + 1,
        endLine: existing.endLine,
    };
    existing.endLine = selection.startLine - 1;
    return { modified: true, deleted: false, split: true, newRegion };
}

/**
 * Adjusts the selection end line when the end character is at position 0.
 * VS Code sets the end of a fully selected line as the first character of the next line,
 * so we decrement the end line if needed.
 * @param startLine the start line of the selection
 * @param endLine the end line of the selection
 * @param endChar the end character position
 * @returns adjusted end line
 */
export function adjustSelectionEndLine(startLine: number, endLine: number, endChar: number): number {
    if (endLine > startLine && endChar === 0) {
        return endLine - 1;
    }
    return endLine;
}

/**
 * Adjusts for empty last line in GitHub preview.
 * GitHub preview does not show the preview if the last document line is empty,
 * so we decrement by one but ensure we don't go before the start line.
 * @param endLine the current end line
 * @param startLine the start line (minimum bound)
 * @param totalLines total number of lines in the document
 * @param isLastLineEmpty whether the last line in the document is empty
 * @returns adjusted end line
 */
export function adjustForEmptyLastLine(endLine: number, startLine: number, totalLines: number, isLastLineEmpty: boolean): number {
    if (endLine === totalLines - 1 && isLastLineEmpty) {
        return Math.max(endLine - 1, startLine);
    }
    return endLine;
}
