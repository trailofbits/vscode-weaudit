/**
 * Minimal contract required to flush pending sync work during shutdown.
 */
export interface ShutdownFlushSession {
    flushPending(): Promise<void>;
    isSyncActive(): boolean;
}

/**
 * Outcome of attempting to flush sync sessions during shutdown.
 */
export type ShutdownFlushResult =
    | { status: "completed"; sessionCount: number; activeAtStart: number }
    | { status: "timed_out"; sessionCount: number; activeAtStart: number }
    | { status: "failed"; sessionCount: number; activeAtStart: number; errorMessage: string };

/**
 * Run shutdown flushing across all sessions and return a structured outcome.
 */
export async function flushSessionsWithTimeout(sessions: ShutdownFlushSession[], timeoutMs: number): Promise<ShutdownFlushResult> {
    const sessionCount = sessions.length;
    const activeAtStart = sessions.filter((session) => session.isSyncActive()).length;
    if (sessionCount === 0) {
        return { status: "completed", sessionCount, activeAtStart };
    }

    return new Promise((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
            settled = true;
            resolve({ status: "timed_out", sessionCount, activeAtStart });
        }, timeoutMs);

        void Promise.all(sessions.map((session) => session.flushPending()))
            .then(() => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                resolve({ status: "completed", sessionCount, activeAtStart });
            })
            .catch((error: unknown) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                resolve({
                    status: "failed",
                    sessionCount,
                    activeAtStart,
                    errorMessage: getErrorMessage(error),
                });
            });
    });
}

/**
 * Normalize an unknown thrown value into a readable string.
 */
function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
