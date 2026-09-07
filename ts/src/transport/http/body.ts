import { IncomingMessage } from "node:http";

/** Buffers a request/response body in full. JSON-RPC payloads are small enough that streaming
 *  parsing isn't worth the complexity it would add to every caller. */
export function readRawBody(stream: IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () => resolve(Buffer.concat(chunks)));
        stream.on("error", reject);
    });
}