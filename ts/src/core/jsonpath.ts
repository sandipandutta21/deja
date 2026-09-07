/** Sentinel swapped in wherever an ignored path points, so masked locations always compare
 *  equal regardless of their original type or shape (string, number, object, array). Using a
 *  sentinel rather than `delete` means array-index paths don't shift sibling indices and
 *  don't change the compared structure's shape -- only its value at that one location. */
export const IGNORED_SENTINEL = "\u0000__DEJA_IGNORED__\u0000";

type PathSegment = string | number | "*";

/** Parses a minimal JSONPath subset: `$.a.b`, `$.a[0].b`, `$.a[*].b`. Enough to point at one
 *  field inside an MCP JSON-RPC payload without pulling in a full JSONPath engine. */
function parsePath(path: string): PathSegment[] {
    const segments: PathSegment[] = [];
    const pattern = /\.([^.[]+)|\[(\*|\d+)\]/g;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(path)) !== null) {
        if (match[1] !== undefined) segments.push(match[1]);
        else if (match[2] === "*") segments.push("*");
        else segments.push(Number(match[2]));
    }

    return segments;
}

function maskSegments(node: unknown, segments: PathSegment[], index: number): void {
    if (node === null || typeof node !== "object") return;
    const segment = segments[index];
    const isLast = index === segments.length - 1;

    if (segment === "*") {
        if (!Array.isArray(node)) return;
        node.forEach((item, i) => {
            if (isLast) node[i] = IGNORED_SENTINEL;
            else maskSegments(item, segments, index + 1);
        });
        return;
    }

    if (Array.isArray(node) && typeof segment === "number") {
        if (segment < 0 || segment >= node.length) return;
        if (isLast) node[segment] = IGNORED_SENTINEL;
        else maskSegments(node[segment], segments, index + 1);
        return;
    }

    if (!Array.isArray(node) && typeof segment === "string") {
        const obj = node as Record<string, unknown>;
        if (!(segment in obj)) return;
        if (isLast) obj[segment] = IGNORED_SENTINEL;
        else maskSegments(obj[segment], segments, index + 1);
    }
}

/** Mutates `root` in place, replacing whatever `path` resolves to with the sentinel. A path
 *  that doesn't resolve (typo, an absent optional field) is silently a no-op -- ignore rules
 *  shouldn't fail verify just because one recorded response happened not to have that field. */
export function maskPath(root: unknown, path: string): void {
    const segments = parsePath(path);
    if (segments.length > 0) maskSegments(root, segments, 0);
}