import * as vscode from "vscode";

const SPACE = "\u00a0";
const GUTTER_ICON_PATH = "media/tobwhite.svg";

/**
 * Handles the decoration configurations and their updates when themes or the configuration changes.
 */
export class DecorationManager {
    public emptyDecorationType = vscode.window.createTextEditorDecorationType({});
    private gutterIconPath: vscode.Uri;

    public ownFindingDecorationType;
    public otherFindingDecorationType;
    public ownNoteDecorationType;
    public otherNoteDecorationType;
    public auditedFileDecorationType;

    constructor(context: vscode.ExtensionContext) {
        this.gutterIconPath = vscode.Uri.file(context.asAbsolutePath(GUTTER_ICON_PATH));

        this.ownFindingDecorationType = this.loadOwnDecorationConfiguration();
        this.otherFindingDecorationType = this.loadOtherDecorationConfiguration();
        this.ownNoteDecorationType = this.loadOwnNoteDecorationConfiguration();
        this.otherNoteDecorationType = this.loadOtherNoteDecorationConfiguration();
        this.auditedFileDecorationType = this.loadAuditedDecorationConfiguration();
    }

    private createDecorationTypeWithString(color: string): vscode.TextEditorDecorationType {
        return vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            backgroundColor: color,
            gutterIconPath: this.gutterIconPath,
            gutterIconSize: "contain",
            overviewRulerColor: color,
            overviewRulerLane: vscode.OverviewRulerLane.Full,
        });
    }

    private loadOwnDecorationConfiguration(): vscode.TextEditorDecorationType {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const color: string = vscode.workspace.getConfiguration("weAudit").get("ownFindingColor")!;
        return this.createDecorationTypeWithString(color);
    }

    private loadOtherDecorationConfiguration(): vscode.TextEditorDecorationType {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const color: string = vscode.workspace.getConfiguration("weAudit").get("otherFindingColor")!;
        return this.createDecorationTypeWithString(color);
    }

    private loadOwnNoteDecorationConfiguration(): vscode.TextEditorDecorationType {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const color: string = vscode.workspace.getConfiguration("weAudit").get("ownNoteColor")!;
        return this.createDecorationTypeWithString(color);
    }

    private loadOtherNoteDecorationConfiguration(): vscode.TextEditorDecorationType {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const color: string = vscode.workspace.getConfiguration("weAudit").get("otherNoteColor")!;
        return this.createDecorationTypeWithString(color);
    }

    private loadAuditedDecorationConfiguration(): vscode.TextEditorDecorationType {
        return vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            backgroundColor: vscode.workspace.getConfiguration("weAudit").get("auditedColor"),
        });
    }

    /**
     * Reload all decoration configurations.
     * TODO: make it possible to reload only one decoration type
     */
    public reloadAllDecorationConfigurations(): void {
        // dispose old decoration types. This is necessary to clean up old decoration types,
        // otherwise they would be left over and we wouldn't be able to remove them.
        this.ownFindingDecorationType.dispose();
        this.otherFindingDecorationType.dispose();
        this.ownNoteDecorationType.dispose();
        this.otherNoteDecorationType.dispose();
        this.auditedFileDecorationType.dispose();

        this.ownFindingDecorationType = this.loadOwnDecorationConfiguration();
        this.otherFindingDecorationType = this.loadOtherDecorationConfiguration();
        this.ownNoteDecorationType = this.loadOwnNoteDecorationConfiguration();
        this.otherNoteDecorationType = this.loadOtherNoteDecorationConfiguration();
        this.auditedFileDecorationType = this.loadAuditedDecorationConfiguration();
    }

    /**
     * Removes the finding decorations from the given editor so the file can be shown without highlights.
     */
    public clearEditorDecorations(editor: vscode.TextEditor): void {
        editor.setDecorations(this.ownFindingDecorationType, []);
        editor.setDecorations(this.otherFindingDecorationType, []);
        editor.setDecorations(this.ownNoteDecorationType, []);
        editor.setDecorations(this.otherNoteDecorationType, []);
    }
}

/**
 * Creates a hover decoration for a range.
 * @param range the range to decorate
 * @param text the hover text
 * @returns the text decoration
 */
export function hoverOnLabel(range: vscode.Range, text: string): vscode.DecorationOptions {
    return {
        range: range,
        hoverMessage: text,
    };
}

/**
 * Creates a text decoration for an entry.
 * @param line the line of the entry
 * @param label the label of the entry
 * @returns the text decoration
 */
export function labelAfterFirstLineTextDecoration(line: number, label: string): vscode.DecorationOptions {
    return {
        range: new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER),
        renderOptions: {
            dark: {
                after: {
                    // spaces are removed by vscode, so we need to add a utf-8 space
                    contentText: ("      " + label).replace(/ /g, SPACE),
                    color: "#aaaaaa88",
                },
            },
            light: {
                after: {
                    contentText: ("      " + label).replace(/ /g, SPACE),
                    color: "#11111188",
                },
            },
        },
    };
}
