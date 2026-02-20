/** Entry type: function, file-level, or region. */
export type DocEntryType = "function" | "file" | "region";

/**
 * A single documented symbol or code region produced by the documentation agent.
 * Persisted to disk and loaded back to drive editor decorations and hover tooltips.
 */
export interface DocEntry {
    type: DocEntryType;
    /** Relative path from workspace root. */
    path: string;
    /** 0-indexed start line. */
    startLine: number;
    /** 0-indexed end line, inclusive. */
    endLine: number;
    /** Function name, present when type === "function". */
    functionName?: string;
    /** 1–2 sentence summary shown as inline ghost text. */
    summary: string;
    /** Full markdown documentation shown in hover tooltip. */
    fullDoc: string;
    /** ISO 8601 generation timestamp. */
    generatedAt: string;
    /** Skill name (stem of .md file). */
    skill: string;
}

/**
 * Persisted metadata for one documentation generation run.
 * Split across metadata.json (all fields except entries) and entries.json.
 */
export interface DocSessionData {
    version: 1;
    skill: string;
    /** Relative path from workspace root. */
    targetDirectory: string;
    generatedAt: string;
    workspaceRoot: string;
    entries: DocEntry[];
}

/**
 * Validates that an unknown value conforms to the DocEntry interface.
 * Used when deserializing agent responses and stored sessions.
 * @param obj The value to validate.
 * @returns True if the value is a valid DocEntry, false otherwise.
 */
export function isValidDocEntry(obj: unknown): obj is DocEntry {
    if (typeof obj !== "object" || obj === null) {
        return false;
    }
    const e = obj as Record<string, unknown>;
    return (
        (e["type"] === "function" || e["type"] === "file" || e["type"] === "region") &&
        typeof e["path"] === "string" &&
        e["path"].length > 0 &&
        typeof e["startLine"] === "number" &&
        typeof e["endLine"] === "number" &&
        e["startLine"] >= 0 &&
        e["endLine"] >= e["startLine"] &&
        typeof e["summary"] === "string" &&
        e["summary"].length > 0 &&
        typeof e["fullDoc"] === "string" &&
        typeof e["generatedAt"] === "string" &&
        typeof e["skill"] === "string" &&
        (e["functionName"] === undefined || typeof e["functionName"] === "string")
    );
}
