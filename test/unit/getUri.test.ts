import { expect } from "chai";
import proxyquire = require("proxyquire");

describe("utilities/getUri", () => {
    it("joins paths and passes through webview.asWebviewUri", () => {
        const joinCalls: any[] = [];
        const asCalls: any[] = [];

        const { getUri } = proxyquire("../../src/utilities/getUri", {
            vscode: {
                Uri: {
                    joinPath: (...args: any[]) => {
                        joinCalls.push(args);
                        return { joined: args };
                    },
                },
                "@noCallThru": true,
            },
        });

        const fakeWebview = {
            asWebviewUri: (uri: any) => {
                asCalls.push(uri);
                return { webviewUri: true, ...uri };
            },
        };

        const extensionUri = { ext: true };
        const result = getUri(fakeWebview as any, extensionUri as any, ["media", "file.txt"]);

        expect(joinCalls).to.have.length(1);
        expect(joinCalls[0][0]).to.equal(extensionUri);
        expect(joinCalls[0].slice(1)).to.deep.equal(["media", "file.txt"]);

        expect(asCalls).to.have.length(1);
        expect(asCalls[0]).to.deep.equal({ joined: [extensionUri, "media", "file.txt"] });

        expect(result).to.deep.equal({ webviewUri: true, joined: [extensionUri, "media", "file.txt"] });
    });
});
