import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Writes a Node script to a real file and returns a spawnable command for it.
 *
 * On Windows, passing a multi-line script inline as a `node -e "..."` argument is fragile:
 * CreateProcess's command-line reconstruction can corrupt escape sequences that straddle
 * embedded newlines. A real script file sidesteps that entirely -- and it's also what every
 * real MCP server actually is, so it's a more realistic fixture regardless of platform.
 */
export async function writeScriptFile(dir: string, name: string, source: string): Promise<string[]> {
    const path = resolve(dir, name);
    await writeFile(path, source, "utf8");
    return [process.execPath, path];
}
