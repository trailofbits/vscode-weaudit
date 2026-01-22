import type { Entry, FullEntry } from "../types";
import { createDefaultEntryDetails, getEntryIndexFromArray } from "../types";

/**
 * Result of a delete or resolve operation.
 */
export interface DeleteResolveResult {
    /** Whether the operation was successful */
    success: boolean;
    /** The entry that was removed, if any */
    removedEntry?: FullEntry;
    /** Error message if the operation failed */
    error?: string;
}

/**
 * Removes an entry from an array using entryEquals comparison.
 * Returns the removed entry or an error if not found.
 * @param entry the entry to remove
 * @param entries the array to remove from (will be mutated)
 * @returns the result of the operation
 */
export function removeEntryFromArray(entry: FullEntry, entries: FullEntry[]): DeleteResolveResult {
    const idx = getEntryIndexFromArray(entry, entries);
    if (idx === -1) {
        return { success: false, error: "Entry not found in array" };
    }
    const removed = entries.splice(idx, 1)[0];
    return { success: true, removedEntry: removed };
}

/**
 * Adds an entry to the resolved entries list, ensuring it has details.
 * @param entry the entry to add (may be mutated to add default details)
 * @param resolvedEntries the resolved entries array (will be mutated)
 */
export function addToResolvedEntries(entry: FullEntry, resolvedEntries: FullEntry[]): void {
    if (entry.details === undefined) {
        entry.details = createDefaultEntryDetails();
    }
    resolvedEntries.push(entry);
}

/**
 * Restores an entry from resolved back to tree entries.
 * Ensures the entry has details and removes it from resolved.
 * @param entry the entry to restore (may be mutated to add default details)
 * @param treeEntries the tree entries array (will be mutated)
 * @param resolvedEntries the resolved entries array (will be mutated)
 * @returns the result of the operation
 */
export function restoreEntryFromResolved(entry: FullEntry, treeEntries: FullEntry[], resolvedEntries: FullEntry[]): DeleteResolveResult {
    if (entry.details === undefined) {
        entry.details = createDefaultEntryDetails();
    }

    treeEntries.push(entry);
    const idx = getEntryIndexFromArray(entry, resolvedEntries);
    if (idx === -1) {
        return { success: false, error: "Entry not found in resolved entries" };
    }
    resolvedEntries.splice(idx, 1);
    return { success: true, removedEntry: entry };
}

/**
 * Gets unique authors from an array of entries.
 * @param entries the entries to get authors from
 * @returns array of unique author strings
 */
export function getUniqueAuthors(entries: Entry[]): string[] {
    return entries.map((entry) => entry.author).filter((value, index, self) => self.indexOf(value) === index);
}

/**
 * Restores all resolved entries to tree entries.
 * Returns the unique authors affected.
 * @param treeEntries the tree entries array (will be mutated)
 * @param resolvedEntries the resolved entries array (will be mutated)
 * @returns array of unique authors of the restored entries
 */
export function restoreAllEntries(treeEntries: FullEntry[], resolvedEntries: FullEntry[]): string[] {
    if (resolvedEntries.length === 0) {
        return [];
    }

    // Get unique authors before moving
    const authors = getUniqueAuthors(resolvedEntries);

    // Add all resolved to tree entries
    treeEntries.push(...resolvedEntries);

    // Clear resolved entries (splice to maintain array reference)
    resolvedEntries.splice(0, resolvedEntries.length);

    return authors;
}

/**
 * Deletes all resolved entries and returns the unique authors affected.
 * @param resolvedEntries the resolved entries array (will be mutated)
 * @returns array of unique authors of the deleted entries
 */
export function deleteAllResolvedEntries(resolvedEntries: FullEntry[]): string[] {
    if (resolvedEntries.length === 0) {
        return [];
    }

    const authors = getUniqueAuthors(resolvedEntries);
    resolvedEntries.splice(0, resolvedEntries.length);
    return authors;
}
