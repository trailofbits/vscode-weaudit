/* eslint-disable @typescript-eslint/naming-convention */

/**
 * Represents the type of an entry.
 *
 * Other than having different color configuration settings, findings and notes are essentially the same.
 *
 * The general idea is that
 * Findings are used to represent dangerous or buggy code and
 * Notes are used to add comments or other information to the codebase.
 */
export enum EntryType {
    Finding,
    Note,
}

/**
 * Represent the client or audit repository.
 */
export enum Repository {
    Audit = "Audit",
    Client = "Client",
}

/**
 * Trail of Bits finding severities.
 */
export enum FindingSeverity {
    Informational = "Informational",
    Undetermined = "Undetermined",
    Low = "Low",
    Medium = "Medium",
    High = "High",
    Undefined = "",
}

/**
 * Trail of Bits finding difficulties.
 */
export enum FindingDifficulty {
    Undetermined = "Undetermined",
    NA = "N/A",
    Low = "Low",
    Medium = "Medium",
    High = "High",
    Undefined = "",
}

/**
 * Trail of Bits finding types.
 */
export enum FindingType {
    AccessControls = "Access Controls",
    AuditingAndLogging = "Auditing and Logging",
    Authentication = "Authentication",
    Configuration = "Configuration",
    Cryptography = "Cryptography",
    DataExposure = "Data Exposure",
    DataValidation = "Data Validation",
    DenialOfService = "Denial of Service",
    ErrorReporting = "Error Reporting",
    Patching = "Patching",
    SessionManagement = "Session Management",
    Testing = "Testing",
    Timing = "Timing",
    UndefinedBehavior = "Undefined Behavior",
    Undefined = "",
}
/* eslint-enable @typescript-eslint/naming-convention */

/**
 * This object is a representation of the codeMarker class without circular references between objects.
 * This is used to serialize the data with JSON.stringify.
 */
export interface SerializedData {
    clientRemote: string;
    gitRemote: string;
    gitSha: string;
    treeEntries: Entry[];
    auditedFiles: AuditedFile[];
    resolvedEntries: Entry[];
}

/**
 * Creates a default serialized data object.
 */
export function createDefaultSerializedData(): SerializedData {
    return {
        clientRemote: "",
        gitRemote: "",
        gitSha: "",
        treeEntries: [],
        auditedFiles: [],
        resolvedEntries: [],
    };
}

export function validateSerializedData(data: SerializedData): boolean {
    // ignore clientRemote, gitRemote and gitSha as these are optional
    if (data.treeEntries === undefined || data.auditedFiles === undefined || data.resolvedEntries === undefined) {
        return false;
    }
    for (const entry of data.treeEntries.concat(data.resolvedEntries)) {
        if (!validateEntry(entry)) {
            return false;
        }
    }
    for (const auditedFile of data.auditedFiles) {
        if (!validateAuditedFile(auditedFile)) {
            return false;
        }
    }
    return true;
}

function validateEntry(entry: Entry): boolean {
    if (
        entry.label === undefined ||
        entry.entryType === undefined ||
        entry.locations === undefined ||
        entry.details === undefined ||
        entry.author === undefined
    ) {
        return false;
    }
    // validate entryType
    if (entry.entryType !== EntryType.Finding && entry.entryType !== EntryType.Note) {
        return false;
    }

    for (const location of entry.locations) {
        if (!validateLocation(location)) {
            return false;
        }
    }
    if (!validateEntryDetails(entry.details)) {
        return false;
    }
    return true;
}

function validateAuditedFile(auditedFile: AuditedFile): boolean {
    return auditedFile.path !== undefined && auditedFile.author !== undefined;
}

function validateLocation(location: Location): boolean {
    return location.path !== undefined && location.startLine !== undefined && location.endLine !== undefined && location.label !== undefined;
}

function validateEntryDetails(entryDetails: EntryDetails): boolean {
    return (
        entryDetails.severity !== undefined &&
        entryDetails.difficulty !== undefined &&
        entryDetails.type !== undefined &&
        entryDetails.description !== undefined &&
        entryDetails.exploit !== undefined &&
        entryDetails.recommendation !== undefined
    );
}

// ====================================================================

// The data used to fill the Finding Details panel
export interface EntryDetails {
    severity: FindingSeverity;
    difficulty: FindingDifficulty;
    type: FindingType;
    description: string;
    exploit: string;
    recommendation: string;
}

/**
 * Creates a default entry details object.
 * @returns the default entry details object
 */
export function createDefaultEntryDetails() {
    return {
        severity: FindingSeverity.Undefined,
        difficulty: FindingDifficulty.Undefined,
        type: FindingType.Undefined,
        description: "",
        exploit: "",
        recommendation: "Short term, \nLong term, \n",
    };
}

/**
 * Remote and Permalink type
 */
export interface RemoteAndPermalink {
    remote: string;
    permalink: string;
}

/**
 * A location in a file.
 */
export interface Location {
    /** The path relative to the base git directory */
    path: string;

    /** The line where the entry starts */
    startLine: number;

    /** The line where the entry ends */
    endLine: number;

    /** The label of the location */
    label: string;

    /** The description of the location. This is currently used only when externally loading entries */
    description: string;
}

/**
 * Represents an entry in the finding tree.
 */
export interface Entry {
    /** The title of the entry */
    label: string;

    /** The type of the entry (finding or note) */
    entryType: EntryType;

    /** The author of the entry */
    author: string;

    /** The details of the entry */
    details: EntryDetails;

    /** Locations */
    locations: Location[];
}

/**
 * A location entry
 */
export interface LocationEntry {
    location: Location;
    parentEntry: Entry;
}

/**
 * A path organizer entry
 */
export interface PathOrganizerEntry {
    pathLabel: string;
}

/**
 * Creates a PathOrganizer entry.
 * @param path the path of the file
 * @returns the PathOrganizer entry
 */
export function createPathOrganizer(path: string): PathOrganizerEntry {
    return { pathLabel: path };
}

/**
 * Creates an additional location entry.
 * @param location the location of the entry
 * @returns the additional location entry
 */
export function createLocationEntry(location: Location, parentEntry: Entry): LocationEntry {
    return { location: location, parentEntry: parentEntry };
}

/**
 * Checks if two entries are equal.
 * @returns true if the entries are equal, false otherwise
 */
export function entryEquals(a: Entry, b: Entry): boolean {
    if (a.locations.length !== b.locations.length) {
        return false;
    }
    // locations equality
    for (let i = 0; i < a.locations.length; i++) {
        if (
            a.locations[i].path !== b.locations[i].path ||
            a.locations[i].startLine !== b.locations[i].startLine ||
            a.locations[i].endLine !== b.locations[i].endLine
        ) {
            return false;
        }
    }

    return a.entryType === b.entryType && a.author === b.author && a.label === b.label;
}

/**
 * Finds the index of the entry in an array. We use entryEquals
 * because we want to find the exact entry.
 * @param entry
 * @returns the index of the entry in the resolved entries list, or -1 if not found
 */
export function getEntryIndexFromArray(entry: Entry, array: Entry[]): number {
    for (let i = 0; i < array.length; i++) {
        if (entryEquals(entry, array[i])) {
            return i;
        }
    }
    return -1;
}

export function mergeTwoEntryArrays(a: Entry[], b: Entry[]) {
    // merge two arrays of entries
    // without duplicates
    const result: Entry[] = a;
    for (let i = 0; i < b.length; i++) {
        let found = false;
        for (let j = 0; j < a.length; j++) {
            if (entryEquals(a[j], b[i])) {
                found = true;
                break;
            }
        }
        if (!found) {
            result.push(b[i]);
        }
    }
    return result;
}

/**
 * Checks if two audited files are equal.
 * @param a the first audited file
 * @param b the second audited file
 * @returns true if the audited files are equal, false otherwise
 */
function auditedEquals(a: AuditedFile, b: AuditedFile): boolean {
    return a.path === b.path && a.author === b.author;
}

/**
 * Merges two arrays of audited files, removing duplicates.
 * @param a the first array
 * @param b the second array
 * @returns the merged array
 */
export function mergeTwoAuditedFileArrays(a: AuditedFile[], b: AuditedFile[]): AuditedFile[] {
    // merge two arrays of entries
    // without duplicates
    const result: AuditedFile[] = a;
    for (let i = 0; i < b.length; i++) {
        let found = false;
        for (let j = 0; j < a.length; j++) {
            if (auditedEquals(a[j], b[i])) {
                found = true;
                break;
            }
        }
        if (!found) {
            result.push(b[i]);
        }
    }
    return result;
}

export interface AuditedFile {
    path: string;
    author: string;
}

export enum TreeViewMode {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    List,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    GroupByFile,
}

/**
 * Gets the label for a tree view mode. These correspond to the values in the package.json.
 * @param mode the tree view mode
 * @returns the label for the tree view mode
 */
export function treeViewModeLabel(mode: TreeViewMode): string {
    switch (mode) {
        case TreeViewMode.List:
            return "list";
        case TreeViewMode.GroupByFile:
            return "byFile";
    }
}

/**
 * TreeEntry union type.
 * This is used to represent the tree entries in the finding tree.
 * - Entry: a finding or a note, are used when there is a single location
 * - LocationEntry: are used to represent additional locations
 * - PathOrganizerEntry: a path organizer, used to organize the findings by file
 */
export type TreeEntry = Entry | LocationEntry | PathOrganizerEntry;

/**
 * Type predicates for the TreeEntry union type.
 * https://www.typescriptlang.org/docs/handbook/2/narrowing.html#using-type-predicates
 */
export function isLocationEntry(treeEntry: TreeEntry): treeEntry is LocationEntry {
    return (treeEntry as LocationEntry).parentEntry !== undefined;
}

export function isPathOrganizerEntry(treeEntry: TreeEntry): treeEntry is PathOrganizerEntry {
    return (treeEntry as PathOrganizerEntry).pathLabel !== undefined;
}

export function isEntry(treeEntry: TreeEntry): treeEntry is Entry {
    return (treeEntry as Entry).entryType !== undefined;
}
