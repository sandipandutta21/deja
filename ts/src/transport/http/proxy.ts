import { StringDecoder } from "node:string_decoder";
import { createServer, IncomingMessage, request as httpRequest, ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import { URL } from "node:url";
import { CassetteWriter } from "../../core/cassette.js";
import { readRawBody } from "./body.js";
import { redactObject } from "../../core/redact.js";
import { SseParser } from "./sse.js";
import { JsonRpcMessage } from "../../core/types.js";

export interface HttpProxyHandle {
    port: number;
    close(): Promise<void>;
}

/** Headers that describe *this hop* of the connection, not the end-to-end payload -- these
 *  are recomputed or dropped rather than forwarded. Deliberately excludes content-length:
 *  since the proxy fully buffers request bodies, it recomputes that one explicitly instead. */
const HOP_BY_HOP_HEADERS = new Set([
    "host",
    "connection",
    "transfer-encoding",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "upgrade",
]);

function forwardableHeaders(headers: IncomingMessage["headers"]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
        if (value === undefined || HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
        out[key] = Array.isArray(value) ? value.join(", ") : value;
    }
    return out;
}

function parseJsonRpcPayload(raw: string): JsonRpcMessage[] {
    if (!raw.trim()) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
        return []; // non-JSON-RPC body (e.g. an error page) -- nothing to record
    }
}

/**
 * A transparent reverse proxy in front of a real Streamable HTTP MCP server. Every header --
 * auth, session id, protocol version -- crosses untouched in both directions; JSON-RPC
 * payloads, whether delivered as a JSON body or a text/event-stream, are extracted and tee'd
 * into a cassette. Redaction only affects what's written to disk, never the bytes the client
 * actually receives.
 *
 * Known limitation: bodies with `content-encoding` (gzip, br, ...) are recorded as opaque,
 * unparseable bytes -- decompression isn't implemented yet, so compressed upstreams won't
 * produce cassette frames (the live proxying itself is unaffected).
 */
export async function startHttpRecordProxy(
    target: string,
    outputPath: string,
    options: { port?: number; noRedact?: boolean } = {}
): Promise<HttpProxyHandle> {
    const writer = new CassetteWriter(outputPath);
    const targetUrl = new URL(target);
    const startTime = Date.now();
    const noRedact = !!options.noRedact;

    writer.write({
        type: "header",
        version: 1,
        recorded_at: new Date().toISOString(),
        transport: "http",
        target: `${targetUrl.protocol}//${targetUrl.host}`,
    });

    function record(dir: "c2s" | "s2c", msg: JsonRpcMessage): void {
        writer.write({
            type: "frame",
            dir,
            t_ms: Date.now() - startTime,
            msg: noRedact ? msg : (redactObject(msg) as JsonRpcMessage),
        });
    }

    const server = createServer(async (clientReq, clientRes) => {
        try {
            await proxyOne(clientReq, clientRes);
        } catch (err) {
            clientRes.writeHead(502, { "content-type": "application/json" });
            clientRes.end(JSON.stringify({ jsonrpc: "2.0",
                error: { code: -32000, message: `Deja: proxy error: ${(err as Error).message}` } }));
        }
    });

    async function proxyOne(clientReq: IncomingMessage, clientRes: ServerResponse): Promise<void> {
        const bodyBuffer = await readRawBody(clientReq);
        for (const msg of parseJsonRpcPayload(bodyBuffer.toString("utf8"))) {
            record("c2s", msg);
        }

        const upstreamUrl = new URL(clientReq.url ?? "/", targetUrl);
        const send = upstreamUrl.protocol === "https:" ? httpsRequest : httpRequest;

        await new Promise<void>((resolve, reject) => {
            const upstreamReq = send(
                upstreamUrl,
                {
                    method: clientReq.method,
                    headers: {
                        ...forwardableHeaders(clientReq.headers),
                        host: upstreamUrl.host,
                        "content-length": String(bodyBuffer.length),
                    },
                },
                (upstreamRes) => {
                    clientRes.writeHead(upstreamRes.statusCode ?? 502, forwardableHeaders(upstreamRes.headers));

                    const contentType = upstreamRes.headers["content-type"] ?? "";
                    if (contentType.includes("text/event-stream")) {
                        streamSse(upstreamRes, clientRes, resolve, reject);
                    } else {
                        bufferAndForward(upstreamRes, clientRes, resolve, reject);
                    }
                }
            );

            upstreamReq.on("error", reject);
            if (bodyBuffer.length > 0) upstreamReq.write(bodyBuffer);
            upstreamReq.end();
        });
    }

    function streamSse(
        upstreamRes: IncomingMessage,
        clientRes: ServerResponse,
        resolve: () => void,
        reject: (err: Error) => void
    ): void {
        const parser = new SseParser();
        const decoder = new StringDecoder("utf8"); // handles multi-byte UTF-8 split across chunk boundaries

        upstreamRes.on("data", (chunk: Buffer) => {
            clientRes.write(chunk); // forward raw bytes untouched, regardless of parse outcome
            for (const evt of parser.feed(decoder.write(chunk))) {
                recordSseEvent(evt.data);
            }
        });

        upstreamRes.on("end", () => {
            for (const evt of [...parser.feed(decoder.end()), ...parser.flush()]) {
                recordSseEvent(evt.data);
            }
            clientRes.end();
            resolve();
        });

        upstreamRes.on("error", reject);
    }

    function recordSseEvent(data: string): void {
        try {
            record("s2c", JSON.parse(data));
        } catch {
            // Non-JSON-RPC SSE payload (comment/keepalive) -- nothing to record
        }
    }

    function bufferAndForward(
        upstreamRes: IncomingMessage,
        clientRes: ServerResponse,
        resolve: () => void,
        reject: (err: Error) => void
    ): void {
        const chunks: Buffer[] = [];
        upstreamRes.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
            clientRes.write(chunk);
        });
        upstreamRes.on("end", () => {
            clientRes.end();
            for (const msg of parseJsonRpcPayload(Buffer.concat(chunks).toString("utf8"))) {
                record("s2c", msg);
            }
            resolve();
        });
        upstreamRes.on("error", reject);
    }

    return new Promise((resolve, reject) => {
        server.on("error", reject);
        server.listen(options.port ?? 0, () => {
            const address = server.address();
            const port = typeof address === "object" && address ? address.port : options.port ?? 0;
            resolve({
                port,
                close: async () => {
                    await new Promise<void>((r) => server.close(() => r()));
                    await writer.close();
                },
            });
        });
    });
}