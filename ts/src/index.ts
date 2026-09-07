export * from "./core/types.js";

export { CassetteReader, CassetteWriter } from "./core/cassette.js";
export { sortKeysDeep, stableStringify } from "./core/canon.js";

export {
    calculateSimilarity,
    findSemanticMatch,
    matchStructural,
    normalizeMessage,
    numericCloseness,
    tokenJaccard,
    trigramDice,
} from "./core/match.js";

export {
    containsSecret,
    createPlaceholder,
    redactCommand,
    redactObject,
    redactString,
    scanForSecrets,
    toOriginOnly,
} from "./core/redact.js";

export { IGNORED_SENTINEL, maskPath } from "./core/jsonpath.js";

export { buildNoMatchError, normalizeIncoming, pairInteractions, ReplayEngine, resolveBatch } from "./core/replayEngine.js";
export type { ReplayEngineOptions } from "./core/replayEngine.js";

export { extractJsonRpcFromSse, formatSseEvent, SseParser } from "./transport/http/sse.js";
export type { SseEvent } from "./transport/http/sse.js";

export { recordHttp, recordStdio } from "./command/record.js";
export type { RecordHttpOptions } from "./command/record.js";

export { replayHttp, replayStdio } from "./command/replay.js";

export { startHttpRecordProxy } from "./transport/http/proxy.js";
export type { HttpProxyHandle } from "./transport/http/proxy.js";

export { startHttpReplayServer } from "./transport/http/server.js";
export type { HttpReplayHandle } from "./transport/http/server.js";

export { cleanCassette, runClean, runScan, scanCassette } from "./command/redact.js";

export { diffCassettes } from "./command/diff.js";
export { verifyCassette } from "./command/verify.js";

