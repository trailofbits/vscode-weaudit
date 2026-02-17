/**
 * VS Code API mock factories for unit testing.
 *
 * These mocks provide minimal implementations of VS Code types
 * needed for testing weAudit extension logic without a real VS Code host.
 */

import * as sinon from "sinon";

/**
 * Creates a mock VS Code Uri object.
 */
export function createMockUri(fsPath: string): {
    fsPath: string;
    path: string;
    scheme: string;
    authority: string;
    query: string;
    fragment: string;
    with: sinon.SinonStub;
    toString: () => string;
} {
    return {
        fsPath,
        path: fsPath,
        scheme: "file",
        authority: "",
        query: "",
        fragment: "",
        with: sinon.stub().returnsThis(),
        toString: () => `file://${fsPath}`,
    };
}

/**
 * Creates a mock WorkspaceFolder.
 * @param path - The filesystem path for the workspace folder
 * @param name - Optional name (defaults to basename of path)
 * @param index - Optional index (defaults to 0)
 */
export function createMockWorkspaceFolder(
    path: string,
    name?: string,
    index: number = 0,
): {
    uri: ReturnType<typeof createMockUri>;
    name: string;
    index: number;
} {
    const folderName = name ?? path.split("/").pop() ?? "workspace";
    return {
        uri: createMockUri(path),
        name: folderName,
        index,
    };
}

/**
 * Creates a mock Range object.
 */
export function createMockRange(
    startLine: number,
    startCharacter: number,
    endLine: number,
    endCharacter: number,
): {
    start: { line: number; character: number };
    end: { line: number; character: number };
    isEmpty: boolean;
    isSingleLine: boolean;
    contains: sinon.SinonStub;
    isEqual: sinon.SinonStub;
    intersection: sinon.SinonStub;
    union: sinon.SinonStub;
    with: sinon.SinonStub;
} {
    return {
        start: { line: startLine, character: startCharacter },
        end: { line: endLine, character: endCharacter },
        isEmpty: startLine === endLine && startCharacter === endCharacter,
        isSingleLine: startLine === endLine,
        contains: sinon.stub().returns(false),
        isEqual: sinon.stub().returns(false),
        intersection: sinon.stub().returns(undefined),
        union: sinon.stub().returnsThis(),
        with: sinon.stub().returnsThis(),
    };
}

/**
 * Creates a mock Selection object.
 */
export function createMockSelection(
    startLine: number,
    startCharacter: number,
    endLine: number,
    endCharacter: number,
): ReturnType<typeof createMockRange> & {
    anchor: { line: number; character: number };
    active: { line: number; character: number };
    isReversed: boolean;
} {
    const range = createMockRange(startLine, startCharacter, endLine, endCharacter);
    return {
        ...range,
        anchor: { line: startLine, character: startCharacter },
        active: { line: endLine, character: endCharacter },
        isReversed: false,
    };
}

/**
 * Creates a mock TextDocument.
 */
export function createMockTextDocument(
    uri: string | ReturnType<typeof createMockUri>,
    content: string = "",
): {
    uri: ReturnType<typeof createMockUri>;
    fileName: string;
    isUntitled: boolean;
    languageId: string;
    version: number;
    isDirty: boolean;
    isClosed: boolean;
    lineCount: number;
    getText: sinon.SinonStub;
    getWordRangeAtPosition: sinon.SinonStub;
    lineAt: sinon.SinonStub;
    offsetAt: sinon.SinonStub;
    positionAt: sinon.SinonStub;
    validateRange: sinon.SinonStub;
    validatePosition: sinon.SinonStub;
    save: sinon.SinonStub;
} {
    const mockUri = typeof uri === "string" ? createMockUri(uri) : uri;
    const lines = content.split("\n");

    return {
        uri: mockUri,
        fileName: mockUri.fsPath,
        isUntitled: false,
        languageId: "typescript",
        version: 1,
        isDirty: false,
        isClosed: false,
        lineCount: lines.length,
        getText: sinon.stub().returns(content),
        getWordRangeAtPosition: sinon.stub().returns(undefined),
        lineAt: sinon.stub().callsFake((lineOrPosition: number | { line: number }) => {
            const lineNum = typeof lineOrPosition === "number" ? lineOrPosition : lineOrPosition.line;
            const text = lines[lineNum] ?? "";
            return {
                lineNumber: lineNum,
                text,
                range: createMockRange(lineNum, 0, lineNum, text.length),
                rangeIncludingLineBreak: createMockRange(lineNum, 0, lineNum, text.length + 1),
                firstNonWhitespaceCharacterIndex: text.search(/\S/),
                isEmptyOrWhitespace: text.trim().length === 0,
            };
        }),
        offsetAt: sinon.stub().returns(0),
        positionAt: sinon.stub().returns({ line: 0, character: 0 }),
        validateRange: sinon.stub().callsFake((range: ReturnType<typeof createMockRange>) => range),
        validatePosition: sinon.stub().callsFake((pos: { line: number; character: number }) => pos),
        save: sinon.stub().resolves(true),
    };
}

/**
 * Creates a mock TextEditor.
 * @param uri - The URI or path of the document
 * @param selection - Optional selection (defaults to position 0,0)
 */
export function createMockTextEditor(
    uri: string | ReturnType<typeof createMockUri>,
    selection?: ReturnType<typeof createMockSelection>,
): {
    document: ReturnType<typeof createMockTextDocument>;
    selection: ReturnType<typeof createMockSelection>;
    selections: ReturnType<typeof createMockSelection>[];
    visibleRanges: ReturnType<typeof createMockRange>[];
    options: {
        tabSize: number;
        insertSpaces: boolean;
        cursorStyle: number;
        lineNumbers: number;
    };
    viewColumn: number;
    edit: sinon.SinonStub;
    insertSnippet: sinon.SinonStub;
    setDecorations: sinon.SinonStub;
    revealRange: sinon.SinonStub;
    show: sinon.SinonStub;
    hide: sinon.SinonStub;
} {
    const mockSelection = selection ?? createMockSelection(0, 0, 0, 0);

    return {
        document: createMockTextDocument(uri),
        selection: mockSelection,
        selections: [mockSelection],
        visibleRanges: [createMockRange(0, 0, 100, 0)],
        options: {
            tabSize: 4,
            insertSpaces: true,
            cursorStyle: 1,
            lineNumbers: 1,
        },
        viewColumn: 1,
        edit: sinon.stub().resolves(true),
        insertSnippet: sinon.stub().resolves(true),
        setDecorations: sinon.stub(),
        revealRange: sinon.stub(),
        show: sinon.stub(),
        hide: sinon.stub(),
    };
}

/**
 * Creates a mock Memento (used for workspaceState and globalState).
 */
export function createMockMemento(): {
    keys: sinon.SinonStub;
    get: sinon.SinonStub;
    update: sinon.SinonStub;
} {
    const storage = new Map<string, unknown>();

    return {
        keys: sinon.stub().callsFake(() => Array.from(storage.keys())),
        get: sinon.stub().callsFake((key: string, defaultValue?: unknown) => storage.get(key) ?? defaultValue),
        update: sinon.stub().callsFake((key: string, value: unknown) => {
            storage.set(key, value);
            return Promise.resolve();
        }),
    };
}

/**
 * Creates a mock SecretStorage.
 */
export function createMockSecretStorage(): {
    get: sinon.SinonStub;
    store: sinon.SinonStub;
    delete: sinon.SinonStub;
    onDidChange: sinon.SinonStub;
} {
    const secrets = new Map<string, string>();

    return {
        get: sinon.stub().callsFake((key: string) => Promise.resolve(secrets.get(key))),
        store: sinon.stub().callsFake((key: string, value: string) => {
            secrets.set(key, value);
            return Promise.resolve();
        }),
        delete: sinon.stub().callsFake((key: string) => {
            secrets.delete(key);
            return Promise.resolve();
        }),
        onDidChange: sinon.stub(),
    };
}

/**
 * Creates a mock ExtensionContext.
 * @param extensionPath - Optional path to the extension (defaults to /mock/extension)
 */
export function createMockExtensionContext(extensionPath: string = "/mock/extension"): {
    subscriptions: { dispose: sinon.SinonStub }[];
    workspaceState: ReturnType<typeof createMockMemento>;
    globalState: ReturnType<typeof createMockMemento> & { setKeysForSync: sinon.SinonStub };
    secrets: ReturnType<typeof createMockSecretStorage>;
    extensionUri: ReturnType<typeof createMockUri>;
    extensionPath: string;
    environmentVariableCollection: {
        persistent: boolean;
        description: string;
        replace: sinon.SinonStub;
        append: sinon.SinonStub;
        prepend: sinon.SinonStub;
        get: sinon.SinonStub;
        forEach: sinon.SinonStub;
        delete: sinon.SinonStub;
        clear: sinon.SinonStub;
    };
    asAbsolutePath: (relativePath: string) => string;
    storageUri: ReturnType<typeof createMockUri>;
    storagePath: string;
    globalStorageUri: ReturnType<typeof createMockUri>;
    globalStoragePath: string;
    logUri: ReturnType<typeof createMockUri>;
    logPath: string;
    extensionMode: number;
    extension: {
        id: string;
        extensionUri: ReturnType<typeof createMockUri>;
        extensionPath: string;
        isActive: boolean;
        packageJSON: Record<string, unknown>;
        exports: undefined;
        activate: sinon.SinonStub;
    };
} {
    const globalState = {
        ...createMockMemento(),
        setKeysForSync: sinon.stub(),
    };

    return {
        subscriptions: [],
        workspaceState: createMockMemento(),
        globalState,
        secrets: createMockSecretStorage(),
        extensionUri: createMockUri(extensionPath),
        extensionPath,
        environmentVariableCollection: {
            persistent: false,
            description: "Mock environment collection",
            replace: sinon.stub(),
            append: sinon.stub(),
            prepend: sinon.stub(),
            get: sinon.stub(),
            forEach: sinon.stub(),
            delete: sinon.stub(),
            clear: sinon.stub(),
        },
        asAbsolutePath: (relativePath: string) => `${extensionPath}/${relativePath}`,
        storageUri: createMockUri(`${extensionPath}/storage`),
        storagePath: `${extensionPath}/storage`,
        globalStorageUri: createMockUri(`${extensionPath}/globalStorage`),
        globalStoragePath: `${extensionPath}/globalStorage`,
        logUri: createMockUri(`${extensionPath}/logs`),
        logPath: `${extensionPath}/logs`,
        extensionMode: 3, // ExtensionMode.Production
        extension: {
            id: "trailofbits.weaudit",
            extensionUri: createMockUri(extensionPath),
            extensionPath,
            isActive: true,
            packageJSON: { name: "weaudit", version: "1.0.0" },
            exports: undefined,
            activate: sinon.stub().resolves(),
        },
    };
}

/**
 * Creates a mock OutputChannel.
 */
export function createMockOutputChannel(name: string = "Test"): {
    name: string;
    append: sinon.SinonStub;
    appendLine: sinon.SinonStub;
    replace: sinon.SinonStub;
    clear: sinon.SinonStub;
    show: sinon.SinonStub;
    hide: sinon.SinonStub;
    dispose: sinon.SinonStub;
} {
    return {
        name,
        append: sinon.stub(),
        appendLine: sinon.stub(),
        replace: sinon.stub(),
        clear: sinon.stub(),
        show: sinon.stub(),
        hide: sinon.stub(),
        dispose: sinon.stub(),
    };
}

/**
 * Creates a mock EventEmitter.
 */
export function createMockEventEmitter<T>(): {
    event: sinon.SinonStub;
    fire: sinon.SinonStub;
    dispose: sinon.SinonStub;
} {
    const listeners: Array<(e: T) => void> = [];

    return {
        event: sinon.stub().callsFake((listener: (e: T) => void) => {
            listeners.push(listener);
            return { dispose: () => listeners.splice(listeners.indexOf(listener), 1) };
        }),
        fire: sinon.stub().callsFake((data: T) => {
            listeners.forEach((listener) => listener(data));
        }),
        dispose: sinon.stub(),
    };
}

/**
 * Creates a mock TreeDataProvider refresh event emitter.
 * Useful for testing tree view updates.
 */
export function createMockTreeDataProviderEmitter<T>(): {
    onDidChangeTreeData: sinon.SinonStub;
    fire: sinon.SinonStub;
} {
    const emitter = createMockEventEmitter<T | undefined>();
    return {
        onDidChangeTreeData: emitter.event,
        fire: emitter.fire,
    };
}

/**
 * Creates a mock FileSystemWatcher.
 */
export function createMockFileSystemWatcher(): {
    ignoreCreateEvents: boolean;
    ignoreChangeEvents: boolean;
    ignoreDeleteEvents: boolean;
    onDidCreate: sinon.SinonStub;
    onDidChange: sinon.SinonStub;
    onDidDelete: sinon.SinonStub;
    dispose: sinon.SinonStub;
} {
    return {
        ignoreCreateEvents: false,
        ignoreChangeEvents: false,
        ignoreDeleteEvents: false,
        onDidCreate: sinon.stub(),
        onDidChange: sinon.stub(),
        onDidDelete: sinon.stub(),
        dispose: sinon.stub(),
    };
}

/**
 * Creates a mock Webview.
 */
export function createMockWebview(): {
    options: { enableScripts: boolean };
    html: string;
    onDidReceiveMessage: sinon.SinonStub;
    postMessage: sinon.SinonStub;
    asWebviewUri: sinon.SinonStub;
    cspSource: string;
} {
    return {
        options: { enableScripts: true },
        html: "",
        onDidReceiveMessage: sinon.stub(),
        postMessage: sinon.stub().resolves(true),
        asWebviewUri: sinon.stub().callsFake((uri: ReturnType<typeof createMockUri>) => uri),
        cspSource: "https://mock.csp.source",
    };
}

/**
 * Creates a mock WebviewView (for sidebar webviews).
 */
export function createMockWebviewView(): {
    viewType: string;
    webview: ReturnType<typeof createMockWebview>;
    title: string | undefined;
    description: string | undefined;
    badge: undefined;
    visible: boolean;
    onDidDispose: sinon.SinonStub;
    onDidChangeVisibility: sinon.SinonStub;
    show: sinon.SinonStub;
} {
    return {
        viewType: "mockWebviewView",
        webview: createMockWebview(),
        title: undefined,
        description: undefined,
        badge: undefined,
        visible: true,
        onDidDispose: sinon.stub(),
        onDidChangeVisibility: sinon.stub(),
        show: sinon.stub(),
    };
}
