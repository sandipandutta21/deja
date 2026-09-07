import { resolve } from "node:path";

/** Command to launch the real MCP Everything reference server over stdio. Installed as a
 *  devDependency (@modelcontextprotocol/server-everything) specifically so these tests can
 *  validate deja against genuine MCP traffic, not just hand-crafted fixtures. */
export function everythingServerCommand(): string[] {
    const scriptPath = resolve(process.cwd(), "node_modules/@modelcontextprotocol/server-everything/dist/index.js");
    return [process.execPath, scriptPath, "stdio"];
}

/** Command to launch the real MCP Filesystem reference server, scoped to `allowedDir`. */
export function filesystemServerCommand(allowedDir: string): string[] {
    const scriptPath = resolve(process.cwd(), "node_modules/@modelcontextprotocol/server-filesystem/dist/index.js");
    return [process.execPath, scriptPath, allowedDir];
}

export const CLI_PATH = resolve(process.cwd(), "dist/cli.js");

export function initializeRequest(id: number) {
    return {
        jsonrpc: "2.0" as const,
        id,
        method: "initialize",
        params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "deja-real-server-test", version: "1.0.0" },
        },
    };
}

export const INITIALIZED_NOTIFICATION = { jsonrpc: "2.0" as const, method: "notifications/initialized" };
