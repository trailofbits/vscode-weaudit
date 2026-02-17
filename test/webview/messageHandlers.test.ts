import { expect } from "chai";
import * as sinon from "sinon";

import {
    WebviewMessage,
    UpdateEntryMessage,
    UpdateRepositoryMessage,
    ChooseWorkspaceRootMessage,
    SetWorkspaceRootsMessage,
    WebviewIsReadyMessage,
} from "../../src/webview/webviewMessageTypes";

/**
 * Mock command executor for testing webview message handlers
 */
function createMockCommandExecutor() {
    const executedCommands: Array<{ command: string; args: unknown[] }> = [];

    return {
        executeCommand: sinon.stub().callsFake((command: string, ...args: unknown[]) => {
            executedCommands.push({ command, args });
            return Promise.resolve();
        }),
        getExecutedCommands: () => executedCommands,
        reset: () => {
            executedCommands.length = 0;
        },
    };
}

/**
 * Mock error handler for testing
 */
function createMockErrorHandler() {
    const errors: string[] = [];

    return {
        showErrorMessage: sinon.stub().callsFake((message: string) => {
            errors.push(message);
        }),
        getErrors: () => errors,
        reset: () => {
            errors.length = 0;
        },
    };
}

describe("Webview Message Handlers", () => {
    describe("Finding Details Panel Message Handler", () => {
        describe("update-entry message", () => {
            it("executes updateCurrentSelectedEntry command with field, value, and isPersistent", () => {
                const commandExecutor = createMockCommandExecutor();

                const message: UpdateEntryMessage = {
                    command: "update-entry",
                    field: "severity",
                    value: "High",
                    isPersistent: true,
                };

                // Simulate message handler
                if (message.command === "update-entry") {
                    commandExecutor.executeCommand("weAudit.updateCurrentSelectedEntry", message.field, message.value, message.isPersistent);
                }

                const commands = commandExecutor.getExecutedCommands();
                expect(commands).to.have.length(1);
                expect(commands[0].command).to.equal("weAudit.updateCurrentSelectedEntry");
                expect(commands[0].args).to.deep.equal(["severity", "High", true]);
            });

            it("handles non-persistent updates", () => {
                const commandExecutor = createMockCommandExecutor();

                const message: UpdateEntryMessage = {
                    command: "update-entry",
                    field: "description",
                    value: "This is a draft",
                    isPersistent: false,
                };

                if (message.command === "update-entry") {
                    commandExecutor.executeCommand("weAudit.updateCurrentSelectedEntry", message.field, message.value, message.isPersistent);
                }

                const commands = commandExecutor.getExecutedCommands();
                expect(commands[0].args[2]).to.be.false;
            });

            it("handles empty value", () => {
                const commandExecutor = createMockCommandExecutor();

                const message: UpdateEntryMessage = {
                    command: "update-entry",
                    field: "exploit",
                    value: "",
                    isPersistent: true,
                };

                if (message.command === "update-entry") {
                    commandExecutor.executeCommand("weAudit.updateCurrentSelectedEntry", message.field, message.value, message.isPersistent);
                }

                const commands = commandExecutor.getExecutedCommands();
                expect(commands[0].args[1]).to.equal("");
            });
        });

        describe("webview-ready message", () => {
            it("executes showSelectedEntryInFindingDetails command", () => {
                const commandExecutor = createMockCommandExecutor();

                const message: WebviewIsReadyMessage = {
                    command: "webview-ready",
                };

                // Simulate message handler for finding details
                if (message.command === "webview-ready") {
                    commandExecutor.executeCommand("weAudit.showSelectedEntryInFindingDetails");
                }

                const commands = commandExecutor.getExecutedCommands();
                expect(commands).to.have.length(1);
                expect(commands[0].command).to.equal("weAudit.showSelectedEntryInFindingDetails");
            });
        });
    });

    describe("Git Config Panel Message Handler", () => {
        describe("update-repository-config message", () => {
            it("executes updateGitConfig command with correct parameters", () => {
                const commandExecutor = createMockCommandExecutor();
                const dirToPathMap = new Map([["project1", "/workspace/project1"]]);

                const message: UpdateRepositoryMessage = {
                    command: "update-repository-config",
                    rootLabel: "project1",
                    clientURL: "https://github.com/client/repo",
                    auditURL: "https://github.com/audit/repo",
                    commitHash: "abc123",
                };

                // Simulate message handler
                if (message.command === "update-repository-config") {
                    const rootPath = dirToPathMap.get(message.rootLabel);
                    if (rootPath !== undefined) {
                        commandExecutor.executeCommand("weAudit.updateGitConfig", rootPath, message.clientURL, message.auditURL, message.commitHash);
                    }
                }

                const commands = commandExecutor.getExecutedCommands();
                expect(commands).to.have.length(1);
                expect(commands[0].command).to.equal("weAudit.updateGitConfig");
                expect(commands[0].args).to.deep.equal(["/workspace/project1", "https://github.com/client/repo", "https://github.com/audit/repo", "abc123"]);
            });

            it("shows error when rootLabel is not found in map", () => {
                const commandExecutor = createMockCommandExecutor();
                const errorHandler = createMockErrorHandler();
                const dirToPathMap = new Map<string, string>();

                const message: UpdateRepositoryMessage = {
                    command: "update-repository-config",
                    rootLabel: "unknownProject",
                    clientURL: "https://github.com/client/repo",
                    auditURL: "https://github.com/audit/repo",
                    commitHash: "abc123",
                };

                // Simulate message handler
                if (message.command === "update-repository-config") {
                    const rootPath = dirToPathMap.get(message.rootLabel);
                    if (rootPath === undefined) {
                        errorHandler.showErrorMessage(`weAudit: Error updating repository config. Directory: ${message.rootLabel} is not a workspace root.`);
                    }
                }

                const errors = errorHandler.getErrors();
                expect(errors).to.have.length(1);
                expect(errors[0]).to.include("unknownProject");
                expect(errors[0]).to.include("not a workspace root");
            });
        });

        describe("choose-workspace-root message", () => {
            it("executes pushGitConfigView command with resolved rootPath", () => {
                const commandExecutor = createMockCommandExecutor();
                const dirToPathMap = new Map([
                    ["project1", "/workspace/project1"],
                    ["project2", "/workspace/project2"],
                ]);

                const message: ChooseWorkspaceRootMessage = {
                    command: "choose-workspace-root",
                    rootLabel: "project2",
                };

                // Simulate message handler
                if (message.command === "choose-workspace-root") {
                    const rootPath = dirToPathMap.get(message.rootLabel);
                    if (rootPath !== undefined) {
                        commandExecutor.executeCommand("weAudit.pushGitConfigView", rootPath);
                    }
                }

                const commands = commandExecutor.getExecutedCommands();
                expect(commands).to.have.length(1);
                expect(commands[0].command).to.equal("weAudit.pushGitConfigView");
                expect(commands[0].args).to.deep.equal(["/workspace/project2"]);
            });

            it("shows error when workspace root is not found", () => {
                const commandExecutor = createMockCommandExecutor();
                const errorHandler = createMockErrorHandler();
                const dirToPathMap = new Map<string, string>();

                const message: ChooseWorkspaceRootMessage = {
                    command: "choose-workspace-root",
                    rootLabel: "nonexistent",
                };

                // Simulate message handler
                if (message.command === "choose-workspace-root") {
                    const rootPath = dirToPathMap.get(message.rootLabel);
                    if (rootPath === undefined) {
                        errorHandler.showErrorMessage(`weAudit: Error choosing workspace root. Directory: ${message.rootLabel} is not a workspace root.`);
                    }
                }

                const commands = commandExecutor.getExecutedCommands();
                const errors = errorHandler.getErrors();

                expect(commands).to.have.length(0);
                expect(errors).to.have.length(1);
                expect(errors[0]).to.include("nonexistent");
            });
        });

        describe("webview-ready message for git config", () => {
            it("executes getGitConfigRoots and pushGitConfigView commands", () => {
                const commandExecutor = createMockCommandExecutor();
                const currentRootPath = "/workspace/project1";

                const message: WebviewIsReadyMessage = {
                    command: "webview-ready",
                };

                // Simulate message handler for git config
                if (message.command === "webview-ready") {
                    commandExecutor.executeCommand("weAudit.getGitConfigRoots");
                    commandExecutor.executeCommand("weAudit.pushGitConfigView", currentRootPath ? currentRootPath : null);
                }

                const commands = commandExecutor.getExecutedCommands();
                expect(commands).to.have.length(2);
                expect(commands[0].command).to.equal("weAudit.getGitConfigRoots");
                expect(commands[1].command).to.equal("weAudit.pushGitConfigView");
                expect(commands[1].args).to.deep.equal(["/workspace/project1"]);
            });

            it("passes null when no current root path", () => {
                const commandExecutor = createMockCommandExecutor();
                const currentRootPath = "";

                const message: WebviewIsReadyMessage = {
                    command: "webview-ready",
                };

                if (message.command === "webview-ready") {
                    commandExecutor.executeCommand("weAudit.getGitConfigRoots");
                    commandExecutor.executeCommand("weAudit.pushGitConfigView", currentRootPath ? currentRootPath : null);
                }

                const commands = commandExecutor.getExecutedCommands();
                expect(commands[1].args).to.deep.equal([null]);
            });
        });
    });

    describe("Message Type Validation", () => {
        it("identifies update-entry messages correctly", () => {
            const message: WebviewMessage = {
                command: "update-entry",
                field: "severity",
                value: "High",
                isPersistent: true,
            };

            expect(message.command).to.equal("update-entry");
            expect("field" in message).to.be.true;
            expect("value" in message).to.be.true;
            expect("isPersistent" in message).to.be.true;
        });

        it("identifies update-repository-config messages correctly", () => {
            const message: WebviewMessage = {
                command: "update-repository-config",
                rootLabel: "project",
                clientURL: "https://example.com",
                auditURL: "https://example.com",
                commitHash: "abc123",
            };

            expect(message.command).to.equal("update-repository-config");
            expect("rootLabel" in message).to.be.true;
            expect("clientURL" in message).to.be.true;
        });

        it("identifies choose-workspace-root messages correctly", () => {
            const message: WebviewMessage = {
                command: "choose-workspace-root",
                rootLabel: "project",
            };

            expect(message.command).to.equal("choose-workspace-root");
            expect("rootLabel" in message).to.be.true;
        });

        it("identifies webview-ready messages correctly", () => {
            const message: WebviewMessage = {
                command: "webview-ready",
            };

            expect(message.command).to.equal("webview-ready");
        });

        it("identifies set-workspace-roots messages correctly", () => {
            const message: SetWorkspaceRootsMessage = {
                command: "set-workspace-roots",
                rootLabels: ["project1", "project2"],
            };

            expect(message.command).to.equal("set-workspace-roots");
            expect("rootLabels" in message).to.be.true;
            expect(message.rootLabels).to.have.length(2);
        });
    });

    describe("dirToPathMap Management", () => {
        it("correctly maps root labels to paths", () => {
            const rootPathsAndLabels = [
                { rootPath: "/workspace/project1", rootLabel: "project1" },
                { rootPath: "/workspace/project2", rootLabel: "project2" },
            ];

            const dirToPathMap = new Map<string, string>();
            for (const rootPathAndLabel of rootPathsAndLabels) {
                dirToPathMap.set(rootPathAndLabel.rootLabel, rootPathAndLabel.rootPath);
            }

            expect(dirToPathMap.get("project1")).to.equal("/workspace/project1");
            expect(dirToPathMap.get("project2")).to.equal("/workspace/project2");
        });

        it("clears and rebuilds map on setGitConfigRoots", () => {
            const dirToPathMap = new Map([["oldProject", "/old/path"]]);

            const newRoots = [{ rootPath: "/new/path", rootLabel: "newProject" }];

            dirToPathMap.clear();
            for (const root of newRoots) {
                dirToPathMap.set(root.rootLabel, root.rootPath);
            }

            expect(dirToPathMap.has("oldProject")).to.be.false;
            expect(dirToPathMap.get("newProject")).to.equal("/new/path");
        });

        it("handles empty roots list", () => {
            const dirToPathMap = new Map([["project", "/path"]]);

            const newRoots: Array<{ rootPath: string; rootLabel: string }> = [];

            dirToPathMap.clear();
            for (const root of newRoots) {
                dirToPathMap.set(root.rootLabel, root.rootPath);
            }

            expect(dirToPathMap.size).to.equal(0);
        });
    });

    describe("currentRootPathAndLabel Updates", () => {
        it("updates current root when setGitConfigRoots finds matching root", () => {
            let currentRootPathAndLabel = { rootPath: "/workspace/project1", rootLabel: "project1" };
            const newRoots = [
                { rootPath: "/workspace/project1", rootLabel: "project1" },
                { rootPath: "/workspace/project2", rootLabel: "project2" },
            ];

            const idx = newRoots.findIndex((r) => r.rootPath === currentRootPathAndLabel.rootPath && r.rootLabel === currentRootPathAndLabel.rootLabel);

            if (idx === -1 && newRoots.length > 0) {
                currentRootPathAndLabel = newRoots[0];
            }

            // Should keep existing because it was found
            expect(currentRootPathAndLabel.rootLabel).to.equal("project1");
        });

        it("switches to first root when current root not found", () => {
            let currentRootPathAndLabel = { rootPath: "/workspace/removed", rootLabel: "removed" };
            const newRoots = [
                { rootPath: "/workspace/project1", rootLabel: "project1" },
                { rootPath: "/workspace/project2", rootLabel: "project2" },
            ];

            const idx = newRoots.findIndex((r) => r.rootPath === currentRootPathAndLabel.rootPath && r.rootLabel === currentRootPathAndLabel.rootLabel);

            if (idx === -1 && newRoots.length > 0) {
                currentRootPathAndLabel = newRoots[0];
            }

            // Should switch to first available root
            expect(currentRootPathAndLabel.rootLabel).to.equal("project1");
        });

        it("keeps empty state when no roots available", () => {
            let currentRootPathAndLabel = { rootPath: "", rootLabel: "" };
            const newRoots: Array<{ rootPath: string; rootLabel: string }> = [];

            const idx = newRoots.findIndex((r) => r.rootPath === currentRootPathAndLabel.rootPath && r.rootLabel === currentRootPathAndLabel.rootLabel);

            if (idx === -1 && newRoots.length > 0) {
                currentRootPathAndLabel = newRoots[0];
            }

            expect(currentRootPathAndLabel.rootPath).to.equal("");
            expect(currentRootPathAndLabel.rootLabel).to.equal("");
        });
    });
});
