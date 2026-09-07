import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { CassetteWriter } from "../core/cassette.js";
import { startHttpRecordProxy } from "../transport/http/proxy.js";
import { redactCommand, redactObject } from "../core/redact.js";
import { JsonRpcMessage } from "../core/types.js";

/**
 * Records a stdio MCP session by sitting transparently between the real client (this
 * process's own stdin/stdout) and a spawned server: every byte is forwarded verbatim in both
 * directions, and JSON-RPC lines are additionally parsed and tee'd into a cassette.
 *
 * Deliberately calls `process.exit` on the child's close rather than letting the promise
 * resolve naturally: this process's stdin is a pipe from whatever launched `deja record`
 * (an agent client, a shell), which has no reason to close it just because the *child*
 * server exited -- without an explicit exit, deja would hang waiting on stdin forever.
 */
export async function recordStdio(command: string[], outputPath: string, noRedact: boolean): Promise<void> {
    const writer = new CassetteWriter(outputPath);
    const headerCommand = noRedact ? command : redactCommand(command);

    writer.write({
        type: "header",
        version: 1,
        recorded_at: new Date().toISOString(),
        transport: "stdio",
        server_command: headerCommand,
    });

    const child = spawn(command[0], command.slice(1), {
        stdio: ["pipe", "pipe", "inherit"],
    });

    const rlIn = createInterface({ input: process.stdin });
    const rlOut = createInterface({ input: child.stdout });
    const startTime = Date.now();

    const record = (dir: "c2s" | "s2c", raw: string): void => {
        try {
            let msg = JSON.parse(raw) as JsonRpcMessage;
            if (!noRedact) msg = redactObject(msg) as JsonRpcMessage;
            writer.write({ type: "frame", dir, t_ms: Date.now() - startTime, msg });
        } catch {
            // Pass-through non-JSON payloads silently -- they were already forwarded verbatim above
        }
    };

    rlIn.on("line", (line) => {
        if (!line.trim()) return;
        child.stdin.write(line + "\n");
        record("c2s", line);
    });

    // Propagate EOF to the server: without this, a well-behaved server waiting on stdin to
    // close (the normal way an MCP client signals "done") never finds out the client
    // disconnected, and this process hangs waiting for a child that's still running.
    rlIn.on("close", () => child.stdin.end());

    rlOut.on("line", (line) => {
        if (!line.trim()) return;
        process.stdout.write(line + "\n");
        record("s2c", line);
    });

    child.on("close", async (code) => {
        await writer.close();
        process.exit(code ?? 0);
    });
}

export interface RecordHttpOptions {
    port?: number;
    noRedact?: boolean;
}

/** Runs the HTTP recording proxy until interrupted (SIGINT/SIGTERM), then flushes the cassette. */
export async function recordHttp(target: string, outputPath: string, options: RecordHttpOptions = {}): Promise<void> {
    const handle = await startHttpRecordProxy(target, outputPath, options);
    console.error(`Deja: recording proxy listening on http://localhost:${handle.port} -> ${target}`);
    console.error(`Deja: writing cassette to ${outputPath}`);

    await new Promise<void>((resolve) => {
        const shutdown = async (): Promise<void> => {
            process.off("SIGINT", shutdown);
            process.off("SIGTERM", shutdown);
            await handle.close();
            resolve();
        };
        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);
    });
}