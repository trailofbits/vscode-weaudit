import { type SerializedData, validateSerializedData } from "./types";

/**
 * Parses a day log JSON string into a Map.
 * Day logs track which files were audited on each day.
 * @param jsonString The JSON string to parse
 * @returns A Map of date strings to arrays of file paths, or null if parsing fails
 */
export function parseDayLogJson(jsonString: string): Map<string, string[]> | null {
    if (!jsonString || jsonString.trim() === "") {
        return null;
    }
    try {
        const data = JSON.parse(jsonString) as Iterable<readonly [string, string[]]>;
        return new Map(data);
    } catch {
        return null;
    }
}

/**
 * Serializes a day log Map to a JSON string.
 * @param dayLog The Map to serialize
 * @returns The JSON string representation of the day log
 */
export function serializeDayLog(dayLog: Map<string, string[]>): string {
    return JSON.stringify(Array.from(dayLog), null, 2);
}

/**
 * Parses a .weaudit file JSON string into SerializedData.
 * @param jsonString The JSON string to parse
 * @returns The parsed SerializedData, or null if parsing or validation fails
 */
export function parseWeauditFile(jsonString: string): SerializedData | null {
    if (!jsonString || jsonString.trim() === "") {
        return null;
    }
    try {
        const data = JSON.parse(jsonString) as SerializedData;
        if (!validateSerializedData(data)) {
            return null;
        }
        return data;
    } catch {
        return null;
    }
}

/**
 * Serializes SerializedData to a JSON string for .weaudit files.
 * @param data The SerializedData to serialize
 * @returns The JSON string representation
 */
export function serializeWeauditFile(data: SerializedData): string {
    return JSON.stringify(data, null, 4);
}
