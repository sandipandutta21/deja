import { createHash } from "node:crypto";
import { URL } from "node:url";

const SENSITIVE_KEYS = new Set([
    "token",
    "apikey",
    "api_key",
    "access_token",
    "refresh_token",
    "client_secret",
    "authorization",
    "password",
    "secret",
    "private_key",
    "session_token",
    "aws_secret_access_key",
    "cookie",
]);

const SECRET_PATTERNS = [
    { rule: "github", regex: /(gh[pousr]_[A-Za-z0-9_]{36,255})/g },
    { rule: "sk", regex: /(sk-[a-zA-Z0-9]{20,})/g },
    { rule: "slack", regex: /(xox[baprs]-[A-Za-z0-9-]{10,72})/g },
    { rule: "aws-access-key", regex: /(AKIA[0-9A-Z]{16})/g },
    { rule: "bearer", regex: /(?<=Bearer\s+)[A-Za-z0-9\-._~+/]+=*/g },
    { rule: "jwt", regex: /(eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)/g },
    { rule: "url-creds", regex: /(?<=:\/\/)[^/\s:@]+:[^/\s@]+(?=@)/g },
];

const PLACEHOLDER_PATTERN = /^\[REDACTED:[a-z0-9_-]+:[0-9a-f]{8}\]$/i;

function isPlaceholder(value: string): boolean {
    return PLACEHOLDER_PATTERN.test(value);
}

export function createPlaceholder(rule: string, secret: string): string {
    const hash = createHash("sha256").update(secret).digest("hex").slice(0, 8);
    return `[REDACTED:${rule}:${hash}]`;
}

export function redactString(value: string): string {
    let redactedValue = value;
    for (const { rule, regex } of SECRET_PATTERNS) {
        redactedValue = redactedValue.replace(regex, (match) => createPlaceholder(rule, match));
    }
    return redactedValue;
}

export function redactObject(obj: unknown): unknown {
    if (typeof obj === "string") {
        return redactString(obj);
    }

    if (Array.isArray(obj)) {
        return obj.map(redactObject);
    }

    if (obj !== null && typeof obj === "object") {
        const redacted: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj)) {
            if (SENSITIVE_KEYS.has(key.toLowerCase()) && typeof value === "string") {
                redacted[key] = isPlaceholder(value) ? value : createPlaceholder("key_match", value);
            } else {
                redacted[key] = redactObject(value);
            }
        }
        return redacted;
    }

    return obj;
}

export function redactCommand(command: string[]): string[] {
    return command.map((arg) => {
        if (arg.includes("=")) {
            const [key, val] = arg.split("=", 2);
            // CLI flags carry a leading "-"/"--" that a bare key name like "token" never has --
            // strip it before comparing, or "--token=..." and "--api-key=..." would never match.
            const normalizedKey = key.replace(/^--?/, "").toLowerCase();
            if (SENSITIVE_KEYS.has(normalizedKey)) {
                return `${key}=${isPlaceholder(val) ? val : createPlaceholder("key_match", val)}`;
            }
        }
        return redactString(arg);
    });
}

/** Reduces a URL to scheme+host so cassette headers never retain paths, query strings, or embedded credentials. */
export function toOriginOnly(rawUrl: string): string {
    const url = new URL(rawUrl);
    return `${url.protocol}//${url.host}`;
}

/** True if `value` still contains an unredacted secret pattern -- the primitive behind `deja redact --scan`. */
export function containsSecret(value: string): { rule: string } | null {
    for (const { rule, regex } of SECRET_PATTERNS) {
        regex.lastIndex = 0; // regexes carry `g` flag state across calls -- must reset before reuse
        if (regex.test(value)) return { rule };
    }
    return null;
}

function scanValue(value: unknown, hits: Set<string>): void {
    if (typeof value === "string") {
        const hit = containsSecret(value);
        if (hit) hits.add(hit.rule);
        return;
    }

    if (Array.isArray(value)) {
        value.forEach((item) => scanValue(item, hits));
        return;
    }

    if (value !== null && typeof value === "object") {
        for (const [key, val] of Object.entries(value)) {
            if (SENSITIVE_KEYS.has(key.toLowerCase()) && typeof val === "string" && val.length > 0 &&
                !isPlaceholder(val)) {
                hits.add("key_match");
                continue;
            }
            scanValue(val, hits);
        }
    }
}

/** Every redaction rule that still has a raw, unredacted match inside `value`. */
export function scanForSecrets(value: unknown): string[] {
    const hits = new Set<string>();
    scanValue(value, hits);
    return [...hits];
}