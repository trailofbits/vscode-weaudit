import * as path from "path";
import * as fs from "fs";

/**
 * A method that normalizes the slashes in a path based on current operating system.
 *
 * @param filePath - The file path string to normalize
 * @returns The path with slashes normalized for the current operating system
 */
export function normalizePathForOS(wsRoot: string, filePath: string): string {
    if (process.platform === "win32" && filePath.includes("/")) {
        // Unix-style paths on Windows
        return path.normalize(filePath);
    } else if (process.platform !== "win32" && filePath.includes("\\")) {
        if (fs.existsSync(path.join(wsRoot, filePath))) {
            // Hateful edge case, this is a unix-style path with backslashes in the file name.
            return filePath;
        } else {
            // Windows path on non-windows OS
            return filePath.replace(/\\/g, "/");
        }
    }
    return filePath;
}
