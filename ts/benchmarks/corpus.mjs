// Labeled benchmark corpus for deja's matching tier ladder -- generated, not hand-typed.
//
// v1 (76 cases) was hand-authored, one JS object literal per case. Reaching four figures that
// way would mean typing the same handful of ideas hundreds of times with cosmetic variation --
// exactly the kind of padding that makes a "1,000 cases" claim meaningless. Instead: a set of
// realistic base interactions across several tool families, each tagged with which of its
// argument keys are safe to fuzz (prose) vs. opaque (path, identifier, dangerous-numeric), run
// through a set of transforms that only fire where a suitable argument actually exists. Every
// generated case still carries an explicit, human-authored ground-truth label and rationale --
// see buildCases() below for exactly how each category's expectation is justified.
//
// See run.mjs for how these are scored, and ../../README.md#benchmark for the results.

// ---------------------------------------------------------------------------
// Value pools -- deterministic index-based picks (no RNG), so regenerating the corpus is
// perfectly reproducible.
// ---------------------------------------------------------------------------

const PATHS = [
    "/home/user/projects/deja/data/config.txt",
    "/var/log/app/output.log",
    "/etc/nginx/nginx.conf",
    "/home/alice/reports/q3-summary.pdf",
    "/data/exports/users.csv",
    "/srv/www/static/index.html",
    "/tmp/build/output.bin",
    "C:\\Users\\bob\\Documents\\notes.txt",
    "/opt/app/config/settings.yaml",
    "/home/user/.ssh/known_hosts",
    "/mnt/backup/2026-01-01/db.sql",
    "/repo/src/core/match.ts",
    "/repo/src/core/redact.ts",
    "/data/uploads/image-42.png",
    "/var/data/cache/session-9.bin",
];

const QUERIES = [
    "best pizza near me",
    "quarterly revenue report",
    "how many users signed up last month",
    "top rated coffee shops downtown",
    "latest security advisories",
    "open source license comparison",
    "weather forecast for the weekend",
    "convert celsius to fahrenheit",
    "top contributors this quarter",
    "unresolved customer complaints",
    "average response time last week",
    "most active repositories",
    "recent deployment failures",
    "flights from Austin to Denver",
    "cheapest hotels near the venue",
];

const NAMES = ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace", "Heidi", "Ivan", "Judy", "Mallory", "Niaj", "Olivia", "Peggy", "Sybil"];

const IDENTIFIERS = [
    "1234567", "9876543", "a1b2c3d4-e5f6-0000-0000-000000000001",
    "8f14e45fceea167a5a36dedd4bea2543", "acc-000123456789", "user-501",
    "order-77821", "req-4471193", "sess-802234", "tok-556621",
];

const REPOS = ["org/repo", "acme/widgets", "octo/cli", "data/pipeline", "team/service-a"];
const TABLES = ["users", "orders", "events", "sessions", "payments"];
const CITIES = ["Austin", "Denver", "Seattle", "Chicago", "Miami", "Boston", "Phoenix", "Portland"];

function pick(pool, i, salt = 0) {
    return pool[(i * 7 + salt) % pool.length];
}

// ---------------------------------------------------------------------------
// Base interaction builders -- each returns { id, family, method, tool, args, roles }.
// `roles` maps each argument key to what kind of value it holds, so transforms below know
// what they're allowed to touch: "prose" (free text, safe to fuzz), "path" (opaque, gated by
// the path/URI hard gate), "identifier" (opaque, no hard gate covers it -- a known limitation),
// "numeric-dangerous" (a quantity where a large change is a different real-world action).
// ---------------------------------------------------------------------------

function fsRead(i) {
    return { id: `fs-read-${i}`, family: "filesystem", method: "tools/call", tool: "read_text_file", args: { path: pick(PATHS, i) }, roles: { path: "path" } };
}
function fsWrite(i) {
    return { id: `fs-write-${i}`, family: "filesystem", method: "tools/call", tool: "write_file", args: { path: pick(PATHS, i, 3), content: pick(QUERIES, i, 5) }, roles: { path: "path", content: "prose" } };
}
function fsDelete(i) {
    return { id: `fs-delete-${i}`, family: "filesystem", method: "tools/call", tool: "delete_file", args: { path: pick(PATHS, i, 8) }, roles: { path: "path" } };
}
function fsList(i) {
    const p = pick(PATHS, i, 2);
    return { id: `fs-list-${i}`, family: "filesystem", method: "tools/call", tool: "list_files", args: { dir: p.slice(0, p.lastIndexOf("/")) || "/" }, roles: { dir: "path" } };
}
function dbQuery(i) {
    return { id: `db-query-${i}`, family: "database", method: "tools/call", tool: "query_rows", args: { table: pick(TABLES, i), filter: pick(QUERIES, i, 4) }, roles: { table: "identifier", filter: "prose" } };
}
function dbDeleteRows(i) {
    return { id: `db-delete-rows-${i}`, family: "database", method: "tools/call", tool: "delete_rows", args: { table: pick(TABLES, i, 2), from: 1 + (i % 5), to: 10 + (i % 5) }, roles: { table: "identifier", from: "numeric-dangerous", to: "numeric-dangerous" } };
}
function dbUpdateRow(i) {
    return { id: `db-update-row-${i}`, family: "database", method: "tools/call", tool: "update_row", args: { table: pick(TABLES, i, 1), id: pick(IDENTIFIERS, i), note: pick(QUERIES, i, 6) }, roles: { table: "identifier", id: "identifier", note: "prose" } };
}
function ghGetIssue(i) {
    return { id: `gh-get-issue-${i}`, family: "github", method: "tools/call", tool: "get_issue", args: { repo: pick(REPOS, i), issue: 1 + (i % 500) }, roles: { repo: "identifier", issue: "numeric-dangerous" } };
}
function ghCloseIssue(i) {
    return { id: `gh-close-issue-${i}`, family: "github", method: "tools/call", tool: "close_issue", args: { repo: pick(REPOS, i, 2), issue: 1 + (i % 300) }, roles: { repo: "identifier", issue: "numeric-dangerous" } };
}
function ghSearchCode(i) {
    return { id: `gh-search-code-${i}`, family: "github", method: "tools/call", tool: "search_code", args: { repo: pick(REPOS, i, 4), query: pick(QUERIES, i, 7) }, roles: { repo: "identifier", query: "prose" } };
}
function ghGetCommit(i) {
    return { id: `gh-get-commit-${i}`, family: "github", method: "tools/call", tool: "get_commit", args: { repo: pick(REPOS, i, 1), sha: pick(IDENTIFIERS, i, 3) }, roles: { repo: "identifier", sha: "identifier" } };
}
function finTransfer(i) {
    return { id: `fin-transfer-${i}`, family: "financial", method: "tools/call", tool: "transfer_money", args: { amount: 10 * (1 + (i % 50)), recipient: pick(NAMES, i) }, roles: { amount: "numeric-dangerous", recipient: "prose" } };
}
function finPlaceOrder(i) {
    return { id: `fin-order-${i}`, family: "financial", method: "tools/call", tool: "place_order", args: { sku: `SKU-${100 + i}`, quantity: 1 + (i % 20) }, roles: { sku: "identifier", quantity: "numeric-dangerous" } };
}
function finSetPermission(i) {
    return { id: `fin-permission-${i}`, family: "financial", method: "tools/call", tool: "set_permission", args: { user: pick(NAMES, i, 2), level: 1 + (i % 9) }, roles: { user: "prose", level: "numeric-dangerous" } };
}
function finRefund(i) {
    return { id: `fin-refund-${i}`, family: "financial", method: "tools/call", tool: "refund_money", args: { amount: 5 * (1 + (i % 80)), recipient: pick(NAMES, i, 4) }, roles: { amount: "numeric-dangerous", recipient: "prose" } };
}
function apiSearch(i) {
    return { id: `api-search-${i}`, family: "generic_api", method: "tools/call", tool: "search", args: { query: pick(QUERIES, i) }, roles: { query: "prose" } };
}
function apiEcho(i) {
    return { id: `api-echo-${i}`, family: "generic_api", method: "tools/call", tool: "echo", args: { message: pick(QUERIES, i, 9) }, roles: { message: "prose" } };
}
function apiSummarize(i) {
    return { id: `api-summarize-${i}`, family: "generic_api", method: "tools/call", tool: "summarize", args: { text: pick(QUERIES, i, 11) }, roles: { text: "prose" } };
}
function apiWeather(i) {
    return { id: `api-weather-${i}`, family: "generic_api", method: "tools/call", tool: "get_weather", args: { city: pick(CITIES, i) }, roles: { city: "prose" } };
}
function protoResourcesRead(i) {
    return { id: `proto-resources-read-${i}`, family: "protocol", method: "resources/read", tool: null, args: { uri: pick(PATHS, i, 6) }, roles: { uri: "path" } };
}
function protoToolsList(i) {
    return { id: `proto-tools-list-${i}`, family: "protocol", method: "tools/list", tool: null, args: {}, roles: {} };
}
function protoPromptsGet(i) {
    return { id: `proto-prompts-get-${i}`, family: "protocol", method: "prompts/get", tool: null, args: { name: pick(["greeting", "summary-template", "onboarding"], i) }, roles: { name: "identifier" } };
}

const BUILDERS = [
    [fsRead, 14], [fsWrite, 10], [fsDelete, 10], [fsList, 8],
    [dbQuery, 10], [dbDeleteRows, 10], [dbUpdateRow, 10],
    [ghGetIssue, 10], [ghCloseIssue, 8], [ghSearchCode, 10], [ghGetCommit, 8],
    [finTransfer, 10], [finPlaceOrder, 8], [finSetPermission, 8], [finRefund, 8],
    [apiSearch, 10], [apiEcho, 8], [apiSummarize, 8], [apiWeather, 8],
    [protoResourcesRead, 8], [protoToolsList, 4], [protoPromptsGet, 6],
];

const baseInteractions = [];
for (const [builder, count] of BUILDERS) {
    for (let i = 0; i < count; i++) baseInteractions.push(builder(i));
}

// ---------------------------------------------------------------------------
// Wire-shape helper: assembles an actual JSON-RPC message from an interaction, matching MCP's
// real tools/call envelope -- params = { name, arguments, _meta? }, with `_meta` a sibling of
// `arguments`, never nested inside it (that placement is what normalizeMessage in match.ts
// actually strips).
// ---------------------------------------------------------------------------

let nextId = 1;

function toMessage(it, { args, method, meta } = {}) {
    const effectiveArgs = args ?? it.args;
    const effectiveMethod = method ?? it.method;
    if (it.tool) {
        const params = { name: it.tool, arguments: effectiveArgs };
        if (meta) params._meta = meta;
        return { jsonrpc: "2.0", id: nextId++, method: effectiveMethod, params };
    }
    const hasArgs = Object.keys(effectiveArgs).length > 0;
    const params = hasArgs ? { ...effectiveArgs } : undefined;
    if (meta) return { jsonrpc: "2.0", id: nextId++, method: effectiveMethod, params: { ...(params ?? {}), _meta: meta } };
    return params !== undefined
        ? { jsonrpc: "2.0", id: nextId++, method: effectiveMethod, params }
        : { jsonrpc: "2.0", id: nextId++, method: effectiveMethod };
}

/** Returns the first argument key with the given role, optionally filtered by a predicate on
 *  its value -- e.g. tIdentifierChanged needs a key that not only has role "identifier" but
 *  actually contains a digit to increment. Without the predicate, a base interaction with
 *  multiple identifier-role keys (a plain-word "table" name AND a numeric "id") would always
 *  resolve to whichever key iterates first, even when it's unusable for this transform. */
function findRoleKey(it, role, predicate = () => true) {
    for (const [key, r] of Object.entries(it.roles)) {
        if (r === role && predicate(it.args[key])) return key;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Transforms: each takes a base interaction (+ its index, for deterministic variety) and
// returns a case descriptor, or null if this interaction has no argument the transform needs.
// ---------------------------------------------------------------------------

const TOOL_SIBLINGS = {
    read_text_file: "write_file", write_file: "delete_file", delete_file: "read_text_file", list_files: "delete_file",
    query_rows: "delete_rows", delete_rows: "update_row", update_row: "query_rows",
    get_issue: "close_issue", close_issue: "get_issue", search_code: "get_commit", get_commit: "get_issue",
    transfer_money: "refund_money", refund_money: "transfer_money", place_order: "set_permission", set_permission: "place_order",
    search: "echo", echo: "summarize", summarize: "get_weather", get_weather: "search",
};

const OPTIONAL_PARAM_BY_FAMILY = {
    filesystem: ["recursive", true],
    database: ["limit", 50],
    github: ["per_page", 20],
    financial: ["note", "thanks"],
    generic_api: ["limit", 10],
    protocol: ["verbose", true],
};

const OTHER_METHODS = ["resources/list", "prompts/get", "notifications/progress", "initialize"];

function tIdentical(it) {
    return { category: "identical", expected: "MATCH", rationale: "Byte-identical params (only id differs) is the floor every tier must clear.", incomingArgs: it.args };
}
function tKeyOrder(it) {
    const keys = Object.keys(it.args);
    if (keys.length < 2) return null;
    const reversed = {};
    for (const k of [...keys].reverse()) reversed[k] = it.args[k];
    return { category: "key_order", expected: "MATCH", rationale: "Object key order must never carry meaning.", incomingArgs: reversed };
}
function tMetaParam(it) {
    return { category: "meta_param", expected: "MATCH", rationale: "MCP's _meta envelope (a sibling of name/arguments) must never affect request identity.", incomingArgs: it.args, incomingMeta: { progressToken: "tok-" + it.id } };
}
function tEmptyVsMissingParams(it) {
    if (Object.keys(it.args).length !== 0) return null;
    return { category: "empty_vs_missing_params", expected: "MATCH", rationale: "No params object at all vs. an explicit empty object is the same request.", recordedArgsAbsent: true, incomingParamsForceEmpty: true };
}
function tWhitespaceProse(it) {
    const key = findRoleKey(it, "prose");
    if (!key) return null;
    return { category: "whitespace_prose", expected: "MATCH", rationale: "Incidental whitespace around free text is not a new request.", incomingArgs: { ...it.args, [key]: ` ${it.args[key]} ` } };
}
function tCaseVariationProse(it) {
    const key = findRoleKey(it, "prose");
    if (!key) return null;
    const val = it.args[key];
    const flipped = /[a-z]/.test(val[0]) ? val[0].toUpperCase() + val.slice(1) : val[0].toLowerCase() + val.slice(1);
    return { category: "case_variation_prose", expected: "MATCH", rationale: "A single character's case is not a new request.", incomingArgs: { ...it.args, [key]: flipped } };
}
function tTypoProse(it) {
    const key = findRoleKey(it, "prose");
    if (!key) return null;
    const val = it.args[key];
    if (val.length < 6) return null;
    const mid = Math.floor(val.length / 2);
    const typoed = val.slice(0, mid) + val[mid] + val.slice(mid);
    return { category: "typo_prose", expected: "MATCH", rationale: "This tier exists precisely for a single-character typo in free text.", incomingArgs: { ...it.args, [key]: typoed } };
}
function tOptionalParamAdded(it) {
    const entry = OPTIONAL_PARAM_BY_FAMILY[it.family];
    if (!entry) return null;
    const [key, value] = entry;
    if (key in it.args) return null;
    return { category: "optional_param_added", expected: "MATCH", rationale: "An additive, non-identifying argument shouldn't gate replay.", incomingArgs: { ...it.args, [key]: value } };
}
function tToolNameMismatch(it) {
    if (!it.tool) return null;
    const sibling = TOOL_SIBLINGS[it.tool];
    if (!sibling) return null;
    return { category: "tool_name_mismatch", expected: "REJECT", rationale: `${sibling} must never satisfy a ${it.tool} request, however similar the arguments.`, incomingTool: sibling, incomingArgs: it.args };
}
function tPathNearMiss(it) {
    const key = findRoleKey(it, "path");
    if (!key) return null;
    const val = it.args[key];
    const sep = val.includes("\\") ? "\\" : "/";
    const parts = val.split(sep);
    parts[parts.length - 1] = "OTHER-" + parts[parts.length - 1];
    return { category: "path_near_miss", expected: "REJECT", rationale: "Two different paths sharing a long prefix must never fuzzy-match.", incomingArgs: { ...it.args, [key]: parts.join(sep) } };
}
function tNumericDangerousLarge(it) {
    const key = findRoleKey(it, "numeric-dangerous");
    if (!key) return null;
    return { category: "numeric_value_changed_dangerous", expected: "REJECT", rationale: "A large relative change in a safety-critical quantity is a different real-world action.", incomingArgs: { ...it.args, [key]: it.args[key] * 10 + 1 } };
}
function tNumericDangerousSmall(it) {
    const key = findRoleKey(it, "numeric-dangerous");
    if (!key) return null;
    return { category: "numeric_value_changed_dangerous", expected: "REJECT", rationale: "A small but still materially different change (known limitation: the hard gate only fires on large relative changes).", incomingArgs: { ...it.args, [key]: it.args[key] + Math.max(1, Math.round(it.args[key] * 0.15)) } };
}
function tIdentifierChanged(it) {
    const key = findRoleKey(it, "identifier", (v) => /[0-9]/.test(String(v)));
    if (!key) return null;
    const val = String(it.args[key]);
    const lastDigit = [...val].reverse().find((c) => /[0-9]/.test(c));
    if (!lastDigit) return null;
    const changed = val.replace(new RegExp(lastDigit + "(?!.*[0-9])"), String((Number(lastDigit) + 1) % 10));
    return { category: "identifier_changed_non_path", expected: "REJECT", rationale: "An opaque identifier one character off is a different resource, however high the character-level similarity.", incomingArgs: { ...it.args, [key]: changed } };
}
function tMethodMismatch(it, idx) {
    const other = OTHER_METHODS[idx % OTHER_METHODS.length];
    if (other === it.method) return null;
    return { category: "method_mismatch", expected: "REJECT", rationale: "A different JSON-RPC method must never satisfy this request.", incomingMethodOverride: other, incomingArgs: it.args };
}
function tCompletelyUnrelated(it, idx, all) {
    const other = all[(idx + 41) % all.length];
    if (other.id === it.id) return null;
    return { category: "completely_unrelated", expected: "REJECT", rationale: "Wholly unrelated tool and arguments -- a clean low-similarity control.", incomingOther: other };
}

const TRANSFORMS = [
    tIdentical, tKeyOrder, tMetaParam, tEmptyVsMissingParams, tWhitespaceProse, tCaseVariationProse, tTypoProse, tOptionalParamAdded,
    tToolNameMismatch, tPathNearMiss, tNumericDangerousLarge, tNumericDangerousSmall, tIdentifierChanged, tMethodMismatch, tCompletelyUnrelated,
];

function buildCases() {
    const cases = [];
    baseInteractions.forEach((it, idx) => {
        for (const transform of TRANSFORMS) {
            const t = transform(it, idx, baseInteractions);
            if (!t) continue;

            const recorded = t.recordedArgsAbsent
                ? { jsonrpc: "2.0", id: nextId++, method: it.method }
                : toMessage(it);

            let incoming;
            if (t.incomingOther) {
                incoming = toMessage(t.incomingOther);
            } else if (t.incomingParamsForceEmpty) {
                incoming = { jsonrpc: "2.0", id: nextId++, method: it.method, params: {} };
            } else {
                incoming = toMessage(it, {
                    args: t.incomingArgs,
                    method: t.incomingMethodOverride,
                    meta: t.incomingMeta,
                });
                if (t.incomingTool) incoming.params.name = t.incomingTool;
            }

            cases.push({
                id: `${it.id}__${transform.name}`,
                category: t.category,
                expected: t.expected,
                rationale: t.rationale,
                recorded,
                incoming,
            });
        }
    });
    return cases;
}

export const corpus = buildCases();
