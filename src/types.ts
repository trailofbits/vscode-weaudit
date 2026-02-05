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
    // older versions do not have partiallyAuditedFiles
    partiallyAuditedFiles?: PartiallyAuditedFile[];
    resolvedEntries: Entry[];
}

/**
 * This object is a representation of the codeMarker class without circular references between objects.
 * This is used when deserializing the data with JSON.parse.
 */
export interface FullSerializedData {
    clientRemote: string;
    gitRemote: string;
    gitSha: string;
    treeEntries: FullEntry[];
    auditedFiles: AuditedFile[];
    // older versions do not have partiallyAuditedFiles
    partiallyAuditedFiles?: PartiallyAuditedFile[];
    resolvedEntries: FullEntry[];
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
        partiallyAuditedFiles: [],
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
    if (data.partiallyAuditedFiles) {
        for (const partiallyAuditedFile of data.partiallyAuditedFiles) {
            if (!validatepartiallyAuditedFile(partiallyAuditedFile)) {
                return false;
            }
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

function validatepartiallyAuditedFile(partiallyAuditedFile: PartiallyAuditedFile): boolean {
    return validateAuditedFile(partiallyAuditedFile) && partiallyAuditedFile.startLine !== undefined && partiallyAuditedFile.endLine !== undefined;
}

function validateLocation(location: Location): boolean {
    return location.path !== undefined && location.startLine !== undefined && location.endLine !== undefined && location.label !== undefined;
}

function validateEntryDetails(entryDetails: EntryDetails): boolean {
    const provenanceValid = entryDetails.provenance === undefined || typeof entryDetails.provenance === "string";
    const commitHashValid = entryDetails.commitHash === undefined || typeof entryDetails.commitHash === "string";
    return (
        entryDetails.severity !== undefined &&
        entryDetails.difficulty !== undefined &&
        entryDetails.type !== undefined &&
        entryDetails.description !== undefined &&
        entryDetails.exploit !== undefined &&
        entryDetails.recommendation !== undefined &&
        provenanceValid &&
        commitHashValid
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
    provenance?: string;
    commitHash?: string;
}

/**
 * Creates a default entry details object.
 * @param commitHash Optional commit hash to attach to the entry details.
 * @returns the default entry details object
 */
export function createDefaultEntryDetails(commitHash?: string): EntryDetails {
    return {
        severity: FindingSeverity.Undefined,
        difficulty: FindingDifficulty.Undefined,
        type: FindingType.Undefined,
        description: "",
        exploit: "",
        recommendation: "Short term, \nLong term, \n",
        provenance: "human",
        commitHash: commitHash ?? "",
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
 * A location in a file that also includes the corresponding root.
 * This is needed for multi-root workspace support.
 */
export interface FullLocation extends Location {
    /** The absolute path to the (multi-)root*/
    rootPath: string;
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
 * An entry that also includes the path to the corresponding roots.
 * This is needed for multi-root workspace support.
 */
export interface FullEntry extends Entry {
    /** Locations including the root*/
    locations: FullLocation[];
}

/**
 * A location entry
 */
export interface LocationEntry {
    location: Location;
    parentEntry: Entry;
}

/**
 * A location entry that includes paths to the corresponding roots.
 * This is needed for multi-root workspace support.
 */
export interface FullLocationEntry extends LocationEntry {
    location: FullLocation;
    parentEntry: FullEntry;
}

/**
 * A path organizer entry
 */
export interface PathOrganizerEntry {
    pathLabel: string;
}

/**
 * A full path that includes the absolute path to the workspace root
 * and the relative path to the file included in the root.
 */
export interface FullPath {
    rootPath: string;
    path: string;
}

/**
 * A tuple containing a root path and a unique label for that root path
 */
export interface RootPathAndLabel {
    rootPath: string;
    rootLabel: string;
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
 * @param parentEntry the parent of this entry
 * @returns the additional location entry
 */
export function createLocationEntry(location: FullLocation, parentEntry: FullEntry): FullLocationEntry {
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

export function mergeTwoEntryArrays(a: Entry[], b: Entry[]): Entry[] {
    // merge two arrays of entries
    // without duplicates
    const result: Entry[] = [...a];
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
 * Checks if two partially audited files are equal.
 * @param a the first audited file
 * @param b the second audited file
 * @returns true if the audited files are equal, false otherwise
 */
function partiallyAuditedEquals(a: PartiallyAuditedFile, b: PartiallyAuditedFile): boolean {
    return a.path === b.path && a.startLine === b.startLine && a.endLine === b.endLine;
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
    const result: AuditedFile[] = [...a];
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

/**
 * Merges two arrays of partially audited files, removing duplicates.
 * @param a the first array
 * @param b the second array
 * @returns the merged array
 */
export function mergeTwoPartiallyAuditedFileArrays(a: PartiallyAuditedFile[], b: PartiallyAuditedFile[]): PartiallyAuditedFile[] {
    // merge two arrays of entries
    // without duplicates
    const result: PartiallyAuditedFile[] = [...a];
    for (let i = 0; i < b.length; i++) {
        let found = false;
        for (let j = 0; j < a.length; j++) {
            if (partiallyAuditedEquals(a[j], b[i])) {
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

export interface PartiallyAuditedFile {
    path: string;
    author: string;
    startLine: number;
    endLine: number;
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
 * - FullEntry: a finding or a note, are used when there is a single location
 * - FullLocationEntry: are used to represent additional locations
 * - PathOrganizerEntry: a path organizer, used to organize the findings by file
 */
export type TreeEntry = FullEntry | FullLocationEntry | PathOrganizerEntry;

/**
 * Type predicates for the TreeEntry union type.
 * https://www.typescriptlang.org/docs/handbook/2/narrowing.html#using-type-predicates
 */
export function isLocationEntry(treeEntry: TreeEntry): treeEntry is FullLocationEntry {
    return (treeEntry as FullLocationEntry).parentEntry !== undefined;
}

export function isPathOrganizerEntry(treeEntry: TreeEntry): treeEntry is PathOrganizerEntry {
    return (treeEntry as PathOrganizerEntry).pathLabel !== undefined;
}

export function isEntry(treeEntry: TreeEntry): treeEntry is FullEntry {
    return (treeEntry as FullEntry).entryType !== undefined;
}

/**
 * Type predicate for backwards compatibility purposes
 */
export function isOldEntry(entry: Entry | FullEntry | FullLocationEntry): entry is Entry {
    return (entry as FullEntry).locations[0]?.rootPath === undefined && (entry as FullLocationEntry).location?.rootPath === undefined;
}

export interface ConfigurationEntry {
    path: string;
    username: string;
    root: WorkspaceRootEntry;
}

export interface WorkspaceRootEntry {
    label: string;
}

export type ConfigTreeEntry = ConfigurationEntry | WorkspaceRootEntry;

export function isConfigurationEntry(treeEntry: ConfigTreeEntry): treeEntry is ConfigurationEntry {
    return (treeEntry as ConfigurationEntry).username !== undefined;
}

export function isWorkspaceRootEntry(treeEntry: ConfigTreeEntry): treeEntry is WorkspaceRootEntry {
    return (treeEntry as WorkspaceRootEntry).label !== undefined;
}

export function configEntryEquals(a: ConfigurationEntry, b: ConfigurationEntry): boolean {
    return a.path === b.path && a.username === b.username && a.root.label === b.root.label;
}
