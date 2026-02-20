import * as assert from "node:assert";
import { flushSessionsWithTimeout, ShutdownFlushSession } from "../../src/sync/shutdownFlush";

describe("Shutdown flush coordination", () => {
    it("returns completed when all sessions flush before timeout", async () => {
        const sessions: ShutdownFlushSession[] = [
            {
                isSyncActive: (): boolean => true,
                flushPending: async (): Promise<void> => {
                    await new Promise<void>((resolve) => setTimeout(resolve, 10));
                },
            },
            {
                isSyncActive: (): boolean => false,
                flushPending: (): Promise<void> => Promise.resolve(),
            },
        ];

        const result = await flushSessionsWithTimeout(sessions, 200);
        assert.deepStrictEqual(result, {
            status: "completed",
            sessionCount: 2,
            activeAtStart: 1,
        });
    });

    it("returns timed_out when any session exceeds timeout", async () => {
        const sessions: ShutdownFlushSession[] = [
            {
                isSyncActive: (): boolean => true,
                flushPending: async (): Promise<void> => {
                    await new Promise<void>(() => {
                        // Never resolves to force timeout.
                    });
                },
            },
        ];

        const result = await flushSessionsWithTimeout(sessions, 20);
        assert.deepStrictEqual(result, {
            status: "timed_out",
            sessionCount: 1,
            activeAtStart: 1,
        });
    });

    it("returns failed when a session flush rejects", async () => {
        const sessions: ShutdownFlushSession[] = [
            {
                isSyncActive: (): boolean => false,
                flushPending: (): Promise<void> => Promise.reject(new Error("flush failed")),
            },
        ];

        const result = await flushSessionsWithTimeout(sessions, 200);
        assert.deepStrictEqual(result, {
            status: "failed",
            sessionCount: 1,
            activeAtStart: 0,
            errorMessage: "flush failed",
        });
    });

    it("returns completed for empty session lists", async () => {
        const result = await flushSessionsWithTimeout([], 50);
        assert.deepStrictEqual(result, {
            status: "completed",
            sessionCount: 0,
            activeAtStart: 0,
        });
    });
});
