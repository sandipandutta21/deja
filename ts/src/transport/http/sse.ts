import { JsonRpcMessage } from "../../core/types.js";

export interface SseEvent {
    event?: string;
    data: string;
    id?: string;
}

const FIELD_SEPARATOR = ":";

function parseEventBlock(block: string): SseEvent | null {
    const dataLines: string[] = [];
    let event: string | undefined;
    let id: string | undefined;

    for (const line of block.split("\n")) {
        if (line === "" || line.startsWith(":")) continue; // blank/comment lines carry no field

        const sepIndex = line.indexOf(FIELD_SEPARATOR);
        const field = sepIndex === -1 ? line : line.slice(0, sepIndex);
        let value = sepIndex === -1 ? "" : line.slice(sepIndex + 1);
        if (value.startsWith(" ")) value = value.slice(1);

        switch (field) {
            case "data":
                dataLines.push(value);
                break;
            case "event":
                event = value;
                break;
            case "id":
                id = value;
                break;
            // "retry" and unrecognized fields carry no JSON-RPC payload -- deja doesn't need them
        }
    }

    if (dataLines.length === 0) return null;
    return { event, data: dataLines.join("\n"), id };
}

/**
 * Incremental SSE decoder. Network chunks never align with event boundaries, so this holds a
 * buffer across `feed()` calls rather than assuming one chunk is one event.
 */
export class SseParser {
    private buffer = "";

    feed(chunk: string): SseEvent[] {
        this.buffer += chunk.replace(/\r\n/g, "\n");
        const events: SseEvent[] = [];

        let boundary: number;
        while ((boundary = this.buffer.indexOf("\n\n")) !== -1) {
            const rawEvent = this.buffer.slice(0, boundary);
            this.buffer = this.buffer.slice(boundary + 2);
            const parsed = parseEventBlock(rawEvent);
            if (parsed) events.push(parsed);
        }

        return events;
    }

    /** Recovers a trailing event that never got a closing blank line (e.g. the stream just ended). */
    flush(): SseEvent[] {
        if (!this.buffer.trim()) return [];
        const parsed = parseEventBlock(this.buffer);
        this.buffer = "";
        return parsed ? [parsed] : [];
    }
}

/** Formats one SSE event carrying a JSON-RPC payload -- what deja's HTTP replay server emits. */
export function formatSseEvent(payload: unknown, options: { event?: string; id?: string } = {}): string {
    const lines: string[] = [];
    if (options.event) lines.push(`event: ${options.event}`);
    if (options.id !== undefined) lines.push(`id: ${options.id}`);

    for (const dataLine of JSON.stringify(payload).split("\n")) {
        lines.push(`data: ${dataLine}`);
    }

    return lines.join("\n") + "\n\n";
}

/** Extracts every JSON-RPC message from a complete SSE-formatted string. */
export function extractJsonRpcFromSse(sseText: string): JsonRpcMessage[] {
    const parser = new SseParser();
    const events = [...parser.feed(sseText), ...parser.flush()];
    const messages: JsonRpcMessage[] = [];

    for (const evt of events) {
        try {
            messages.push(JSON.parse(evt.data) as JsonRpcMessage);
        } catch {
            // Non-JSON-RPC SSE payload (comment/keepalive) -- nothing to extract
        }
    }

    return messages;
}
