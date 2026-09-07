import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

/** Resolves with the next line written to `stream`. */
export function readOneLine(stream: NodeJS.ReadableStream): Promise<string> {
    return new Promise((resolvePromise) => {
        const rl = createInterface({ input: stream });
        rl.once("line", (line) => {
            rl.close();
            resolvePromise(line);
        });
    });
}

/** Resolves once `count` lines have arrived, in arrival order -- for servers that interleave
 *  unsolicited notifications with actual responses. */
export function readLines(stream: NodeJS.ReadableStream, count: number): Promise<string[]> {
    return new Promise((resolvePromise) => {
        const rl = createInterface({ input: stream });
        const lines: string[] = [];
        const onLine = (line: string): void => {
            lines.push(line);
            if (lines.length >= count) {
                rl.off("line", onLine);
                rl.close();
                resolvePromise(lines);
            }
        };
        rl.on("line", onLine);
    });
}

export function waitForExit(child: ReturnType<typeof spawn>): Promise<number | null> {
    return new Promise((resolvePromise) => child.on("close", (code) => resolvePromise(code)));
}

/** Reads lines until one parses with `id` matching the given value, stashing everything else
 *  (e.g. unsolicited notifications a real server interleaves) into `skipped` instead of
 *  assuming the very next line is always the answer. */
export function readUntilId(stream: NodeJS.ReadableStream, id: number | string): Promise<{ match: any; skipped: any[] }> {
    return new Promise((resolvePromise) => {
        const rl = createInterface({ input: stream });
        const skipped: any[] = [];
        const onLine = (line: string): void => {
            const parsed = JSON.parse(line);
            if (parsed.id === id) {
                rl.off("line", onLine);
                rl.close();
                resolvePromise({ match: parsed, skipped });
            } else {
                skipped.push(parsed);
            }
        };
        rl.on("line", onLine);
    });
}
