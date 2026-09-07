/** Recursively sorts object keys so structurally-identical payloads compare equal regardless of key order. */
export function sortKeysDeep<T>(value: T): T {
    if (Array.isArray(value)) {
        return value.map((item) => sortKeysDeep(item)) as unknown as T;
    }

    if (value !== null && typeof value === "object") {
        const sorted: Record<string, unknown> = {};
        for (const key of Object.keys(value as Record<string, unknown>).sort()) {
            sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
        }
        return sorted as T;
    }

    return value;
}

/** Order-independent JSON serialization -- used everywhere structural equality matters (matching, verify, diff). */
export function stableStringify(value: unknown): string {
    return JSON.stringify(sortKeysDeep(value));
}