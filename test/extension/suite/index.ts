import * as path from "path";
import Mocha from "mocha";
import * as glob from "glob";

export async function run(): Promise<void> {
    // Create the mocha test
    const mocha = new Mocha({
        ui: "tdd",
        color: true,
        timeout: 60000, // Extension tests may need more time
    });

    const testsRoot = path.resolve(__dirname, ".");

    // Find all test files
    const files = glob.sync("**/*.test.js", { cwd: testsRoot });

    // Add files to the test suite
    for (const file of files) {
        mocha.addFile(path.resolve(testsRoot, file));
    }

    return new Promise((resolve, reject) => {
        try {
            // Run the mocha test
            mocha.run((failures) => {
                if (failures > 0) {
                    reject(new Error(`${failures} tests failed.`));
                } else {
                    resolve();
                }
            });
        } catch (err) {
            console.error(err);
            reject(err);
        }
    });
}
