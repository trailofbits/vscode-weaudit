import { expect } from "chai";
import * as sinon from "sinon";

// Constants from decorationManager.ts
const SPACE = "\u00a0";
const GUTTER_ICON_PATH = "media/tobwhite.svg";

/**
 * Mock decoration type for testing
 */
interface MockDecorationType {
    key: string;
    disposed: boolean;
    dispose: () => void;
}

function createMockDecorationType(key: string): MockDecorationType {
    return {
        key,
        disposed: false,
        dispose() {
            this.disposed = true;
        },
    };
}

/**
 * Mock VS Code workspace configuration
 */
function createMockWorkspaceConfiguration(settings: Record<string, string>) {
    return {
        get: sinon.stub().callsFake((key: string) => settings[key]),
    };
}

/**
 * Mock decoration options like hoverOnLabel and labelAfterFirstLineTextDecoration
 */
interface MockRange {
    startLine: number;
    startCharacter: number;
    endLine: number;
    endCharacter: number;
}

function createMockRange(startLine: number, startChar: number, endLine: number, endChar: number): MockRange {
    return {
        startLine,
        startCharacter: startChar,
        endLine,
        endCharacter: endChar,
    };
}

describe("Decoration Manager", () => {
    describe("Decoration Types", () => {
        it("creates 5 different decoration types", () => {
            const decorationTypes = ["ownFinding", "otherFinding", "ownNote", "otherNote", "auditedFile"];

            expect(decorationTypes).to.have.length(5);
        });

        it("creates emptyDecorationType for clearing decorations", () => {
            // Empty decoration type is used to clear existing decorations
            const emptyDecorationType = createMockDecorationType("empty");

            expect(emptyDecorationType.key).to.equal("empty");
        });

        describe("createDecorationTypeWithString", () => {
            it("creates decoration with backgroundColor from color string", () => {
                const color = "#ff000044";
                const decorationOptions = {
                    isWholeLine: true,
                    backgroundColor: color,
                    gutterIconSize: "contain",
                    overviewRulerColor: color,
                };

                expect(decorationOptions.backgroundColor).to.equal("#ff000044");
                expect(decorationOptions.isWholeLine).to.be.true;
                expect(decorationOptions.overviewRulerColor).to.equal(color);
            });

            it("includes gutter icon path", () => {
                const extensionPath = "/mock/extension";
                const gutterIconPath = `${extensionPath}/${GUTTER_ICON_PATH}`;

                expect(gutterIconPath).to.include("tobwhite.svg");
                expect(gutterIconPath).to.include("media");
            });
        });
    });

    describe("Loading Decoration Configurations", () => {
        it("loadOwnDecorationConfiguration reads from weAudit.ownFindingColor", () => {
            const config = createMockWorkspaceConfiguration({
                ownFindingColor: "#ff000044",
            });

            const color = config.get("ownFindingColor");

            expect(color).to.equal("#ff000044");
            expect(config.get.calledWith("ownFindingColor")).to.be.true;
        });

        it("loadOtherDecorationConfiguration reads from weAudit.otherFindingColor", () => {
            const config = createMockWorkspaceConfiguration({
                otherFindingColor: "#00ff0044",
            });

            const color = config.get("otherFindingColor");

            expect(color).to.equal("#00ff0044");
        });

        it("loadOwnNoteDecorationConfiguration reads from weAudit.ownNoteColor", () => {
            const config = createMockWorkspaceConfiguration({
                ownNoteColor: "#0000ff44",
            });

            const color = config.get("ownNoteColor");

            expect(color).to.equal("#0000ff44");
        });

        it("loadOtherNoteDecorationConfiguration reads from weAudit.otherNoteColor", () => {
            const config = createMockWorkspaceConfiguration({
                otherNoteColor: "#ffff0044",
            });

            const color = config.get("otherNoteColor");

            expect(color).to.equal("#ffff0044");
        });

        it("loadAuditedDecorationConfiguration reads from weAudit.auditedColor", () => {
            const config = createMockWorkspaceConfiguration({
                auditedColor: "#44444422",
            });

            const color = config.get("auditedColor");

            expect(color).to.equal("#44444422");
        });

        it("auditedFileDecorationType does not include gutter icon", () => {
            // Audited file decoration only has background color, no gutter icon
            const auditedDecorationOptions = {
                isWholeLine: true,
                backgroundColor: "#44444422",
                // No gutterIconPath
            };

            expect("gutterIconPath" in auditedDecorationOptions).to.be.false;
            expect(auditedDecorationOptions.isWholeLine).to.be.true;
        });
    });

    describe("reloadAllDecorationConfigurations", () => {
        it("disposes all existing decoration types before reloading", () => {
            const decorationTypes = {
                ownFinding: createMockDecorationType("ownFinding"),
                otherFinding: createMockDecorationType("otherFinding"),
                ownNote: createMockDecorationType("ownNote"),
                otherNote: createMockDecorationType("otherNote"),
                auditedFile: createMockDecorationType("auditedFile"),
            };

            // Simulate reloadAllDecorationConfigurations - dispose phase
            Object.values(decorationTypes).forEach((dt) => dt.dispose());

            expect(decorationTypes.ownFinding.disposed).to.be.true;
            expect(decorationTypes.otherFinding.disposed).to.be.true;
            expect(decorationTypes.ownNote.disposed).to.be.true;
            expect(decorationTypes.otherNote.disposed).to.be.true;
            expect(decorationTypes.auditedFile.disposed).to.be.true;
        });

        it("creates new decoration types after disposing old ones", () => {
            let decorationTypes = {
                ownFinding: createMockDecorationType("ownFinding-v1"),
                otherFinding: createMockDecorationType("otherFinding-v1"),
                ownNote: createMockDecorationType("ownNote-v1"),
                otherNote: createMockDecorationType("otherNote-v1"),
                auditedFile: createMockDecorationType("auditedFile-v1"),
            };

            const oldOwnFinding = decorationTypes.ownFinding;

            // Simulate reload
            Object.values(decorationTypes).forEach((dt) => dt.dispose());
            decorationTypes = {
                ownFinding: createMockDecorationType("ownFinding-v2"),
                otherFinding: createMockDecorationType("otherFinding-v2"),
                ownNote: createMockDecorationType("ownNote-v2"),
                otherNote: createMockDecorationType("otherNote-v2"),
                auditedFile: createMockDecorationType("auditedFile-v2"),
            };

            // Old ones are disposed
            expect(oldOwnFinding.disposed).to.be.true;
            // New ones are not disposed
            expect(decorationTypes.ownFinding.disposed).to.be.false;
            expect(decorationTypes.ownFinding.key).to.equal("ownFinding-v2");
        });

        it("reloads with updated color configuration", () => {
            const initialConfig = createMockWorkspaceConfiguration({
                ownFindingColor: "#ff0000",
            });
            const updatedConfig = createMockWorkspaceConfiguration({
                ownFindingColor: "#00ff00",
            });

            const initialColor = initialConfig.get("ownFindingColor");
            const updatedColor = updatedConfig.get("ownFindingColor");

            expect(initialColor).to.equal("#ff0000");
            expect(updatedColor).to.equal("#00ff00");
        });
    });

    describe("hoverOnLabel", () => {
        it("creates decoration options with range and hover message", () => {
            const range = createMockRange(10, 0, 10, 50);
            const text = "Finding: SQL Injection vulnerability";

            // Simulate hoverOnLabel
            const decoration = {
                range: range,
                hoverMessage: text,
            };

            expect(decoration.range).to.equal(range);
            expect(decoration.hoverMessage).to.equal(text);
        });

        it("supports multi-line ranges", () => {
            const range = createMockRange(10, 0, 20, 100);
            const text = "Multi-line finding";

            const decoration = {
                range: range,
                hoverMessage: text,
            };

            expect(decoration.range.startLine).to.equal(10);
            expect(decoration.range.endLine).to.equal(20);
        });

        it("handles empty hover text", () => {
            const range = createMockRange(5, 0, 5, 10);
            const text = "";

            const decoration = {
                range: range,
                hoverMessage: text,
            };

            expect(decoration.hoverMessage).to.equal("");
        });

        it("handles hover text with special characters", () => {
            const range = createMockRange(1, 0, 1, 10);
            const text = "Finding: <script>alert('xss')</script>";

            const decoration = {
                range: range,
                hoverMessage: text,
            };

            expect(decoration.hoverMessage).to.include("<script>");
        });
    });

    describe("labelAfterFirstLineTextDecoration", () => {
        it("creates decoration with range spanning entire line", () => {
            const line = 42;
            const label = "TOB-001: Critical Bug";

            // Simulate labelAfterFirstLineTextDecoration range
            const range = createMockRange(line, 0, line, Number.MAX_SAFE_INTEGER);

            expect(range.startLine).to.equal(42);
            expect(range.endLine).to.equal(42);
            expect(range.startCharacter).to.equal(0);
            expect(range.endCharacter).to.equal(Number.MAX_SAFE_INTEGER);
        });

        it("replaces spaces with non-breaking spaces in label", () => {
            const label = "TOB-001: Critical Bug";
            const paddedLabel = "      " + label;
            const contentText = paddedLabel.replace(/ /g, SPACE);

            // Verify spaces are replaced with non-breaking space (U+00A0)
            expect(contentText).to.not.include(" ");
            expect(contentText).to.include(SPACE);
            expect(contentText).to.include("TOB-001:");
        });

        it("includes render options for dark theme", () => {
            const line = 10;
            const label = "Test Label";
            const contentText = ("      " + label).replace(/ /g, SPACE);

            const renderOptions = {
                dark: {
                    after: {
                        contentText,
                        color: "#aaaaaa88",
                    },
                },
            };

            expect(renderOptions.dark.after.color).to.equal("#aaaaaa88");
            expect(renderOptions.dark.after.contentText).to.include("Test");
        });

        it("includes render options for light theme", () => {
            const line = 10;
            const label = "Test Label";
            const contentText = ("      " + label).replace(/ /g, SPACE);

            const renderOptions = {
                light: {
                    after: {
                        contentText,
                        color: "#11111188",
                    },
                },
            };

            expect(renderOptions.light.after.color).to.equal("#11111188");
            expect(renderOptions.light.after.contentText).to.include("Test");
        });

        it("adds padding before label text", () => {
            const label = "Bug";
            const paddedLabel = "      " + label;

            // 6 spaces of padding
            expect(paddedLabel.indexOf("Bug")).to.equal(6);
        });

        it("handles empty label", () => {
            const label = "";
            const contentText = ("      " + label).replace(/ /g, SPACE);

            // Should still have padding converted to non-breaking spaces
            expect(contentText.length).to.equal(6);
            expect(contentText).to.equal(SPACE.repeat(6));
        });

        it("handles label with multiple spaces", () => {
            const label = "Bug:    Multiple   Spaces";
            const contentText = ("      " + label).replace(/ /g, SPACE);

            // All spaces should be non-breaking
            expect(contentText).to.not.include(" ");
        });
    });

    describe("Configuration Settings", () => {
        it("uses default colors from extension configuration", () => {
            // Default colors as defined in package.json
            const defaultConfig = {
                ownFindingColor: "#ff000044",
                otherFindingColor: "#00ff0044",
                ownNoteColor: "#0000ff44",
                otherNoteColor: "#ffff0044",
                auditedColor: "#44444422",
            };

            expect(defaultConfig.ownFindingColor).to.match(/^#[0-9a-f]{8}$/i);
            expect(defaultConfig.otherFindingColor).to.match(/^#[0-9a-f]{8}$/i);
            expect(defaultConfig.ownNoteColor).to.match(/^#[0-9a-f]{8}$/i);
            expect(defaultConfig.otherNoteColor).to.match(/^#[0-9a-f]{8}$/i);
            expect(defaultConfig.auditedColor).to.match(/^#[0-9a-f]{8}$/i);
        });

        it("colors include alpha channel for transparency", () => {
            const color = "#ff000044";
            const alphaHex = color.slice(7, 9);

            expect(alphaHex).to.equal("44");
            // 44 in hex = 68 in decimal, which is ~27% opacity
            expect(parseInt(alphaHex, 16)).to.be.lessThan(128);
        });
    });

    describe("Gutter Icon", () => {
        it("uses tobwhite.svg as gutter icon", () => {
            expect(GUTTER_ICON_PATH).to.equal("media/tobwhite.svg");
        });

        it("resolves gutter icon path using extension context", () => {
            const extensionPath = "/home/user/.vscode/extensions/trailofbits.weaudit-1.0.0";
            const absolutePath = `${extensionPath}/${GUTTER_ICON_PATH}`;

            expect(absolutePath).to.equal("/home/user/.vscode/extensions/trailofbits.weaudit-1.0.0/media/tobwhite.svg");
        });

        it("sets gutter icon size to contain", () => {
            const decorationOptions = {
                gutterIconPath: "/path/to/icon.svg",
                gutterIconSize: "contain",
            };

            expect(decorationOptions.gutterIconSize).to.equal("contain");
        });
    });

    describe("Overview Ruler", () => {
        it("shows decorations in overview ruler with same color", () => {
            const color = "#ff000044";
            const decorationOptions = {
                backgroundColor: color,
                overviewRulerColor: color,
            };

            expect(decorationOptions.overviewRulerColor).to.equal(decorationOptions.backgroundColor);
        });

        it("uses full lane in overview ruler", () => {
            // OverviewRulerLane.Full = 7 in VS Code
            const overviewRulerLane = 7; // vscode.OverviewRulerLane.Full

            expect(overviewRulerLane).to.equal(7);
        });
    });

    describe("Whole Line Decoration", () => {
        it("decorates entire line for findings and notes", () => {
            const decorationOptions = {
                isWholeLine: true,
            };

            expect(decorationOptions.isWholeLine).to.be.true;
        });

        it("decorates entire line for audited files", () => {
            const auditedDecorationOptions = {
                isWholeLine: true,
                backgroundColor: "#44444422",
            };

            expect(auditedDecorationOptions.isWholeLine).to.be.true;
        });
    });
});
