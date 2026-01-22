import type { Entry, FullEntry, FullLocation, Location } from "../types";

/**
 * Result of removing a location from an entry.
 */
export interface RemoveLocationResult {
    /** Whether a location was removed */
    removed: boolean;
    /** Whether the entry should be deleted (no locations remaining) */
    shouldDeleteEntry: boolean;
}

/**
 * Checks if two locations match on all 4 key properties:
 * path, startLine, endLine, and rootPath.
 * @param a first location
 * @param b second location
 * @returns true if all 4 properties match
 */
export function locationMatches(a: FullLocation, b: FullLocation): boolean {
    return a.path === b.path && a.startLine === b.startLine && a.endLine === b.endLine && a.rootPath === b.rootPath;
}

/**
 * Finds the index of a location in an array using 4-property comparison.
 * @param locations array of locations to search
 * @param target location to find
 * @returns index of the matching location, or -1 if not found
 */
export function findLocationIndex(locations: FullLocation[], target: FullLocation): number {
    for (let i = 0; i < locations.length; i++) {
        if (locationMatches(locations[i], target)) {
            return i;
        }
    }
    return -1;
}

/**
 * Removes a location from an entry's locations array.
 * Returns whether the location was removed and whether the entry should be deleted.
 * @param locations the locations array (will be mutated)
 * @param target the location to remove
 * @returns result indicating if removed and if entry should be deleted
 */
export function removeLocationFromEntry(locations: FullLocation[], target: FullLocation): RemoveLocationResult {
    const idx = findLocationIndex(locations, target);
    if (idx === -1) {
        return { removed: false, shouldDeleteEntry: false };
    }

    locations.splice(idx, 1);
    return {
        removed: true,
        shouldDeleteEntry: locations.length === 0,
    };
}

/**
 * Filters entries that have at least one location in the specified root path.
 * @param entries the entries to filter
 * @param rootPath the root path to match
 * @returns entries with at least one location in the root path
 */
export function filterEntriesByRootPath<T extends Entry>(entries: T[], rootPath: string): T[] {
    return entries.filter((entry) => {
        for (const location of entry.locations) {
            if ((location as FullLocation).rootPath === rootPath) {
                return true;
            }
        }
        return false;
    });
}

/**
 * Filters entries by author.
 * @param entries the entries to filter
 * @param author the author to match
 * @returns entries matching the author
 */
export function filterEntriesByAuthor<T extends Entry>(entries: T[], author: string): T[] {
    return entries.filter((entry) => entry.author === author);
}

/**
 * Filters entries by both author and root path.
 * Entry must have the specified author AND at least one location in the root path.
 * @param entries the entries to filter
 * @param author the author to match
 * @param rootPath the root path to match
 * @returns filtered entries
 */
export function filterEntriesByAuthorAndRootPath(entries: FullEntry[], author: string, rootPath: string): FullEntry[] {
    return entries.filter((entry) => {
        if (entry.author !== author) {
            return false;
        }
        for (const location of entry.locations) {
            if (location.rootPath === rootPath) {
                return true;
            }
        }
        return false;
    });
}
