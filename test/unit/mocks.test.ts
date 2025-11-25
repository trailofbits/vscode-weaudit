import { expect } from "chai";

import {
    createMockWorkspaceFolder,
    createMockTextEditor,
    createMockExtensionContext,
    createMockUri,
    createMockRange,
    createMockSelection,
    createMockTextDocument,
    createMockMemento,
    createMockOutputChannel,
    createMockEventEmitter,
    createMockWebview,
    createMockWebviewView,
} from "../mocks/vscode";

describe("VS Code mock factories", () => {
    describe("createMockUri", () => {
        it("creates a mock Uri with correct fsPath", () => {
            const uri = createMockUri("/path/to/file.ts");
            expect(uri.fsPath).to.equal("/path/to/file.ts");
            expect(uri.scheme).to.equal("file");
        });
    });

    describe("createMockWorkspaceFolder", () => {
        it("creates a workspace folder with uri and name", () => {
            const folder = createMockWorkspaceFolder("/workspace/project");
            expect(folder.uri.fsPath).to.equal("/workspace/project");
            expect(folder.name).to.equal("project");
            expect(folder.index).to.equal(0);
        });

        it("accepts custom name and index", () => {
            const folder = createMockWorkspaceFolder("/workspace/project", "CustomName", 2);
            expect(folder.name).to.equal("CustomName");
            expect(folder.index).to.equal(2);
        });
    });

    describe("createMockRange", () => {
        it("creates a range with start and end positions", () => {
            const range = createMockRange(10, 0, 15, 20);
            expect(range.start.line).to.equal(10);
            expect(range.start.character).to.equal(0);
            expect(range.end.line).to.equal(15);
            expect(range.end.character).to.equal(20);
        });

        it("detects single-line ranges", () => {
            const range = createMockRange(5, 0, 5, 10);
            expect(range.isSingleLine).to.equal(true);
        });
    });

    describe("createMockSelection", () => {
        it("creates a selection with anchor and active", () => {
            const selection = createMockSelection(1, 0, 5, 10);
            expect(selection.anchor.line).to.equal(1);
            expect(selection.active.line).to.equal(5);
        });
    });

    describe("createMockTextDocument", () => {
        it("creates a document with uri and content", () => {
            const doc = createMockTextDocument("/path/to/file.ts", "const x = 1;\nconst y = 2;");
            expect(doc.uri.fsPath).to.equal("/path/to/file.ts");
            expect(doc.lineCount).to.equal(2);
            expect(doc.getText()).to.equal("const x = 1;\nconst y = 2;");
        });

        it("provides lineAt functionality", () => {
            const doc = createMockTextDocument("/file.ts", "line0\nline1\nline2");
            const line = doc.lineAt(1);
            expect(line.text).to.equal("line1");
            expect(line.lineNumber).to.equal(1);
        });
    });

    describe("createMockTextEditor", () => {
        it("creates an editor with document and selection", () => {
            const selection = createMockSelection(0, 0, 5, 0);
            const editor = createMockTextEditor("/path/to/file.ts", selection);
            expect(editor.document.uri.fsPath).to.equal("/path/to/file.ts");
            expect(editor.selection.start.line).to.equal(0);
            expect(editor.selection.end.line).to.equal(5);
        });

        it("provides default selection at 0,0", () => {
            const editor = createMockTextEditor("/path/to/file.ts");
            expect(editor.selection.start.line).to.equal(0);
            expect(editor.selection.start.character).to.equal(0);
        });

        it("has stubbed methods", () => {
            const editor = createMockTextEditor("/file.ts");
            expect(editor.setDecorations).to.be.a("function");
            expect(editor.revealRange).to.be.a("function");
            expect(editor.edit).to.be.a("function");
        });
    });

    describe("createMockExtensionContext", () => {
        it("creates a context with required properties", () => {
            const context = createMockExtensionContext("/mock/extension");
            expect(context.extensionPath).to.equal("/mock/extension");
            expect(context.extensionUri.fsPath).to.equal("/mock/extension");
            expect(context.subscriptions).to.be.an("array");
        });

        it("provides working asAbsolutePath", () => {
            const context = createMockExtensionContext("/mock/extension");
            expect(context.asAbsolutePath("media/icon.png")).to.equal("/mock/extension/media/icon.png");
        });

        it("provides working memento (workspaceState)", () => {
            const context = createMockExtensionContext();
            context.workspaceState.update("key", "value");
            expect(context.workspaceState.get("key")).to.equal("value");
        });

        it("provides working memento (globalState)", () => {
            const context = createMockExtensionContext();
            context.globalState.update("globalKey", { nested: "value" });
            expect(context.globalState.get("globalKey")).to.deep.equal({ nested: "value" });
        });
    });

    describe("createMockMemento", () => {
        it("stores and retrieves values", () => {
            const memento = createMockMemento();
            memento.update("testKey", 123);
            expect(memento.get("testKey")).to.equal(123);
        });

        it("returns default for missing keys", () => {
            const memento = createMockMemento();
            expect(memento.get("missing", "default")).to.equal("default");
        });
    });

    describe("createMockOutputChannel", () => {
        it("creates an output channel with name", () => {
            const channel = createMockOutputChannel("Test Channel");
            expect(channel.name).to.equal("Test Channel");
            expect(channel.appendLine).to.be.a("function");
        });
    });

    describe("createMockEventEmitter", () => {
        it("fires events to listeners", () => {
            const emitter = createMockEventEmitter<string>();
            let received: string | undefined;
            emitter.event((value: string) => {
                received = value;
            });
            emitter.fire("test");
            expect(received).to.equal("test");
        });
    });

    describe("createMockWebview", () => {
        it("creates a webview with postMessage", () => {
            const webview = createMockWebview();
            expect(webview.postMessage).to.be.a("function");
            expect(webview.options.enableScripts).to.equal(true);
        });
    });

    describe("createMockWebviewView", () => {
        it("creates a webview view with nested webview", () => {
            const view = createMockWebviewView();
            expect(view.webview).to.exist;
            expect(view.webview.postMessage).to.be.a("function");
            expect(view.visible).to.equal(true);
        });
    });
});
