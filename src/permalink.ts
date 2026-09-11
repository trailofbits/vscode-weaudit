import { sep } from "node:path";
import type { Location } from "./types";

/** The file path and line range used by a repository permalink. */
type PermalinkLocation = Pick<Location, "path" | "startLine" | "endLine">;

/**
 * Builds a repository permalink from an OS-native relative file path.
 *
 * Args:
 *     remote: Repository URL.
 *     sha: Commit hash.
 *     location: File path and zero-based line range.
 *     separator: Native filesystem separator (defaults to the current OS).
 *
 * Returns:
 *     A permalink with encoded path segments and the host-specific line fragment.
 */
export function generatePermalink(remote: string, sha: string, location: PermalinkLocation, separator = sep): string {
    const segments = location.path.split(separator).join("/").split("/");
    const filePath = segments.map(encodeURIComponent).join("/");
    if (URL.parse(remote)?.hostname === "bitbucket.org") {
        return `${remote}/src/${sha}/${filePath}#lines-${location.startLine + 1}:${location.endLine + 1}`;
    }
    return `${remote}/blob/${sha}/${filePath}#L${location.startLine + 1}-L${location.endLine + 1}`;
}
