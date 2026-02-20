import * as childProcess from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import * as vscode from "vscode";

import { type DocEntry, isValidDocEntry } from "./types";

/** Options passed to runDocumentationAgent. */
export interface AgentRunOpts {
    /** Plugin install directory passed to query() plugins option. */
    skillPluginPath: string;
    /** Skill name for slash-command invocation in the prompt. */
    skillName: string;
    targetDir: string;
    workspaceRoot: string;
    /** Absolute path to the claude CLI binary. */
    claudeBinaryPath: string;
    /** Anthropic API key from VS Code configuration. */
    apiKey: string;
    /** Called with a human-readable progress message during generation. */
    onProgress: (message: string, truncate: boolean) => void;
}

// ---------------------------------------------------------------------------
// Claude binary detection
// ---------------------------------------------------------------------------

/**
 * Attempts to locate the Claude Code CLI binary without blocking the UI.
 * Detection order:
 *   1. `CLAUDE_BINARY` environment variable
 *   2. `claude-code.binaryPath` VS Code setting (Claude Code extension config)
 *   3. Common installation paths (~/.local/bin, /usr/local/bin, Homebrew, etc.)
 *   4. `which claude` / `where claude` shell lookup (last resort — spawns a subprocess)
 * @returns The resolved absolute path, or an empty string if not found.
 */
export function detectClaudeBinary(): string {
    // 1. Explicit env var override.
    const fromEnv = process.env["CLAUDE_BINARY"]?.trim();
    if (fromEnv && fs.existsSync(fromEnv)) {
        return fromEnv;
    }

    // 2. VS Code extension configuration (Claude Code extension).
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const vscodeModule = require("vscode") as typeof vscode;
        for (const key of ["binaryPath", "executablePath", "cliPath"]) {
            const fromConfig = vscodeModule.workspace.getConfiguration("claude-code").get<string>(key, "").trim();
            if (fromConfig && fs.existsSync(fromConfig)) {
                return fromConfig;
            }
        }
    } catch {
        // Not in VS Code host (e.g., unit tests) — skip.
    }

    // 3. Common installation paths.
    const home = os.homedir();
    const candidates: string[] = [
        path.join(home, ".local", "bin", "claude"),
        path.join(home, ".npm-global", "bin", "claude"),
        "/usr/local/bin/claude",
        "/opt/homebrew/bin/claude",
        "/usr/bin/claude",
    ];
    if (process.platform === "win32") {
        candidates.push(path.join(home, "AppData", "Roaming", "npm", "claude.cmd"), path.join(home, "AppData", "Local", "Programs", "claude", "claude.exe"));
    }
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    // 4. Shell which/where lookup (spawns a subprocess — fast, 2 s timeout).
    try {
        const cmd = process.platform === "win32" ? "where claude" : "which claude";
        const result = childProcess.execSync(cmd, { encoding: "utf-8", timeout: 2000 }).trim().split("\n")[0]?.trim() ?? "";
        if (result && fs.existsSync(result)) {
            return result;
        }
    } catch {
        // Binary not on PATH.
    }

    return "";
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Runs the documentation agent over the target directory using the query() API
 * from @anthropic-ai/claude-agent-sdk, which runs Claude Code as a subprocess.
 *
 * The agent is given Read and Glob tools and autonomously explores the target
 * directory, generating a JSON array of DocEntry objects. Generation is aborted
 * when the cancellation token fires.
 *
 * @param opts Agent run options including skill plugin path and target directory.
 * @param token VS Code cancellation token used to abort the loop.
 * @returns Array of validated DocEntry objects produced by the agent.
 */
export async function runDocumentationAgent(opts: AgentRunOpts, token: vscode.CancellationToken): Promise<DocEntry[]> {
    // Lazy-require to avoid needing the SDK in unit-test contexts.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { query } = require("@anthropic-ai/claude-agent-sdk") as typeof import("@anthropic-ai/claude-agent-sdk");

    const abortController = new AbortController();
    const cancelListener = token.onCancellationRequested(() => abortController.abort());

    // Merge process.env so the subprocess has PATH, HOME, etc., but override the API key.
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
        if (v !== undefined) {
            env[k] = v;
        }
    }
    env["ANTHROPIC_API_KEY"] = opts.apiKey;

    opts.onProgress("Starting documentation agent", false);

    try {
        const messages = query({
            prompt: buildPrompt(opts.skillName, opts.targetDir, opts.workspaceRoot),
            options: {
                cwd: opts.workspaceRoot,
                pathToClaudeCodeExecutable: opts.claudeBinaryPath,
                plugins: [{ type: "local", path: opts.skillPluginPath }],
                env,
                permissionMode: "bypassPermissions",
                allowDangerouslySkipPermissions: true,
                abortController,
                allowedTools: ["Read", "Glob", "Grep"],
            },
        });

        let roundCount = 0;
        for await (const msg of messages) {
            if (token.isCancellationRequested) {
                break;
            }
            // Cast through unknown — the SDK's BetaMessage type depends on
            // @anthropic-ai/sdk which is not resolvable in this project.
            const rawMsg = msg as unknown as Record<string, unknown>;

            if (rawMsg["type"] === "assistant") {
                roundCount++;
                opts.onProgress(`— Round ${roundCount} —`, false);
                const content = (rawMsg["message"] as Record<string, unknown>)["content"];
                const blocks = (content as Array<Record<string, unknown>>) ?? [];
                for (const block of blocks) {
                    if (block["type"] === "text") {
                        const text = (block["text"] as string | undefined)?.trim();
                        if (text) {
                            opts.onProgress(`Text: ${text}`, false);
                        }
                    }
                    if (block["type"] === "thinking") {
                        const thinking = (block["thinking"] as string | undefined)?.trim();
                        if (thinking) {
                            opts.onProgress(`Thinking ${thinking}`, true);
                        }
                    }
                    if (block["type"] === "tool_use") {
                        const name = (block["name"] as string | undefined)?.trim();
                        if (name) {
                            opts.onProgress(`Tool use: ${name} ${JSON.stringify(block["input"])}`, true);
                        }
                    }
                }
            }
            if (rawMsg["type"] === "result") {
                if (rawMsg["subtype"] === "success") {
                    return parseEntries(rawMsg["result"] as string);
                }
                const errors = "errors" in rawMsg ? (rawMsg["errors"] as string[]).join(", ") : (rawMsg["subtype"] as string);
                throw new Error(`Agent failed (${rawMsg["subtype"] as string}): ${errors}`);
            }
        }

        if (token.isCancellationRequested) {
            throw new Error("Documentation generation was cancelled.");
        }
        return [];
    } finally {
        cancelListener.dispose();
    }
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

/**
 * Builds the prompt for the documentation agent, invoking the named skill
 * as a slash command and describing the expected JSON output format.
 * @param skillName The slash-command name of the installed skill.
 * @param targetDir Absolute path to the directory to document.
 * @param workspaceRoot Absolute path to the workspace root.
 * @returns The full prompt string to pass to query().
 */
export function buildPrompt(skillName: string, targetDir: string, workspaceRoot: string): string {
    return `/${skillName} Generate documentation for all source files in: ${targetDir}

Workspace root: ${workspaceRoot}

Use the Read and Glob tools to explore and read source files.
After reading the relevant files, output ONLY a JSON array of documentation entries
with this exact schema — no other text before or after the array:

[
  {
    "type": "function" | "file",
    "path": "<path relative to workspace root>",
    "startLine": <0-indexed integer>,
    "endLine": <0-indexed integer, inclusive>,
    "functionName": "<name if type is function, otherwise omit>",
    "summary": "<1-2 sentence summary for inline ghost text>",
    "fullDoc": "<full markdown documentation>",
    "generatedAt": "<ISO 8601 timestamp>",
    "skill": "<skill name>"
  }
]

In fullDoc, use the markdown in the same output format as specified by the ${skillName} skill.`;
}

// ---------------------------------------------------------------------------
// Output parsing
// ---------------------------------------------------------------------------

export function parseEntries(responseText: string): DocEntry[] {
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
        // Lazy-require vscode for warning message.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const vscodeModule = require("vscode") as typeof vscode;
        void vscodeModule.window.showWarningMessage("weAudit docOverlay: Agent did not produce a JSON array. No entries saved.");
        return [];
    }

    let parsed: unknown[];
    try {
        parsed = JSON.parse(jsonMatch[0]) as unknown[];
    } catch {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const vscodeModule = require("vscode") as typeof vscode;
        void vscodeModule.window.showWarningMessage("weAudit docOverlay: Agent produced malformed JSON. No entries saved.");
        return [];
    }

    return parsed.filter((e): e is DocEntry => {
        const valid = isValidDocEntry(e);
        if (!valid) {
            console.log("weAudit docOverlay: skipping invalid entry:", e);
        }
        return valid;
    });
}
