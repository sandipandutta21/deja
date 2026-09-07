// Labeled benchmark corpus for deja's matching tier ladder.
//
// Each case is a (recorded, incoming) pair of JSON-RPC messages plus a ground-truth
// `expected` label -- MATCH or REJECT -- authored by hand, independently of what any
// matcher actually returns. That independence is the whole point: this is a benchmark,
// not a snapshot test, so a matcher disagreeing with a label here is a real finding, not
// a bug in the corpus to be quietly "fixed" by relabeling.
//
// MATCH means: it would be both correct and safe for deja to replay the recorded
// response for this incoming request. REJECT means: doing so would either answer the
// wrong thing or, worse, silently take a different real-world action.
//
// See run.mjs for how these are scored, and ../../README.md#benchmark for the results.

let nextId = 1;
const id = () => nextId++;

/** @param {string} method @param {Record<string, unknown>} [params] */
function req(method, params) {
    return { jsonrpc: "2.0", id: id(), method, ...(params !== undefined ? { params } : {}) };
}

/** @param {string} name @param {Record<string, unknown>} args */
function toolCall(name, args) {
    return req("tools/call", { name, arguments: args });
}

/**
 * @typedef {{
 *   id: string,
 *   category: string,
 *   expected: "MATCH" | "REJECT",
 *   rationale: string,
 *   recorded: import("../src/core/types.js").JsonRpcMessage,
 *   incoming: import("../src/core/types.js").JsonRpcMessage,
 * }} BenchmarkCase
 */

/** @type {BenchmarkCase[]} */
export const corpus = [
    // ---- identical: sanity control, every matcher must pass these ----
    {
        id: "identical-001",
        category: "identical",
        expected: "MATCH",
        rationale: "Byte-identical params (only id differs) is the floor every tier must clear.",
        recorded: toolCall("search_users", { query: "John Smith", limit: 10 }),
        incoming: toolCall("search_users", { query: "John Smith", limit: 10 }),
    },
    {
        id: "identical-002",
        category: "identical",
        expected: "MATCH",
        rationale: "Same, for a no-arguments tool call.",
        recorded: toolCall("list_repositories", {}),
        incoming: toolCall("list_repositories", {}),
    },
    {
        id: "identical-003",
        category: "identical",
        expected: "MATCH",
        rationale: "Same, for a non-tools/call method.",
        recorded: req("resources/list"),
        incoming: req("resources/list"),
    },
    {
        id: "identical-004",
        category: "identical",
        expected: "MATCH",
        rationale: "Same, with a nested object argument.",
        recorded: toolCall("create_issue", { repo: "org/repo", fields: { title: "Bug", labels: ["bug", "p1"] } }),
        incoming: toolCall("create_issue", { repo: "org/repo", fields: { title: "Bug", labels: ["bug", "p1"] } }),
    },

    // ---- key_order: object key order must never carry meaning ----
    {
        id: "key-order-001",
        category: "key_order",
        expected: "MATCH",
        rationale: "Top-level argument keys reordered.",
        recorded: toolCall("search_users", { query: "John Smith", limit: 10 }),
        incoming: { jsonrpc: "2.0", id: id(), method: "tools/call", params: { arguments: { limit: 10, query: "John Smith" }, name: "search_users" } },
    },
    {
        id: "key-order-002",
        category: "key_order",
        expected: "MATCH",
        rationale: "Nested object keys reordered.",
        recorded: toolCall("create_issue", { repo: "org/repo", fields: { title: "Bug", labels: ["bug", "p1"] } }),
        incoming: toolCall("create_issue", { fields: { labels: ["bug", "p1"], title: "Bug" }, repo: "org/repo" }),
    },
    {
        id: "key-order-003",
        category: "key_order",
        expected: "MATCH",
        rationale: "Reordered keys plus a different id, the realistic replay case.",
        recorded: toolCall("get_weather", { city: "Austin", units: "imperial" }),
        incoming: toolCall("get_weather", { units: "imperial", city: "Austin" }),
    },
    {
        id: "key-order-004",
        category: "key_order",
        expected: "MATCH",
        rationale: "Reordered keys on a request with no tool envelope.",
        recorded: req("tools/list", { cursor: "abc", _unused: 1 }),
        incoming: req("tools/list", { _unused: 1, cursor: "abc" }),
    },
    {
        id: "key-order-005",
        category: "key_order",
        expected: "MATCH",
        rationale: "Array of objects, each object's keys reordered (order of the array itself preserved).",
        recorded: toolCall("bulk_update", { items: [{ id: 1, status: "done" }, { id: 2, status: "open" }] }),
        incoming: toolCall("bulk_update", { items: [{ status: "done", id: 1 }, { status: "open", id: 2 }] }),
    },
    {
        id: "key-order-006",
        category: "key_order",
        expected: "MATCH",
        rationale: "Deeply nested key reordering, three levels down.",
        recorded: toolCall("configure", { section: "network", options: { retry: { count: 3, backoffMs: 100 } } }),
        incoming: toolCall("configure", { section: "network", options: { retry: { backoffMs: 100, count: 3 } } }),
    },

    // ---- meta_param: MCP's _meta envelope must never affect identity ----
    {
        id: "meta-param-001",
        category: "meta_param",
        expected: "MATCH",
        rationale: "Incoming carries a progress token the recorded call never had.",
        recorded: toolCall("search_users", { query: "John Smith" }),
        incoming: toolCall("search_users", { query: "John Smith", _meta: { progressToken: "tok-123" } }),
    },
    {
        id: "meta-param-002",
        category: "meta_param",
        expected: "MATCH",
        rationale: "Both sides carry different _meta values -- still irrelevant to identity.",
        recorded: toolCall("get_weather", { city: "Austin" }),
        incoming: toolCall("get_weather", { city: "Austin", _meta: { progressToken: "tok-999", traceId: "xyz" } }),
    },
    {
        id: "meta-param-003",
        category: "meta_param",
        expected: "MATCH",
        rationale: "_meta present at the top-level params, not nested under arguments.",
        recorded: req("resources/read", { uri: "config://app.json" }),
        incoming: req("resources/read", { uri: "config://app.json", _meta: { progressToken: "1" } }),
    },

    // ---- empty_vs_missing_params: absent params and {} are the same request ----
    {
        id: "empty-params-001",
        category: "empty_vs_missing_params",
        expected: "MATCH",
        rationale: "No params object at all vs. an explicit empty object.",
        recorded: req("resources/list"),
        incoming: req("resources/list", {}),
    },
    {
        id: "empty-params-002",
        category: "empty_vs_missing_params",
        expected: "MATCH",
        rationale: "Same, reversed direction.",
        recorded: req("tools/list", {}),
        incoming: req("tools/list"),
    },
    {
        id: "empty-params-003",
        category: "empty_vs_missing_params",
        expected: "MATCH",
        rationale: "A tool call with no arguments, spelled two ways.",
        recorded: toolCall("ping", {}),
        incoming: { jsonrpc: "2.0", id: id(), method: "tools/call", params: { name: "ping" } },
    },

    // ---- whitespace_prose: incidental whitespace in free text is not a new request ----
    {
        id: "whitespace-001",
        category: "whitespace_prose",
        expected: "MATCH",
        rationale: "Leading/trailing whitespace around a free-text query.",
        recorded: toolCall("search_users", { query: "John Smith" }),
        incoming: toolCall("search_users", { query: " John Smith " }),
    },
    {
        id: "whitespace-002",
        category: "whitespace_prose",
        expected: "MATCH",
        rationale: "Double space collapsed to single space is still the same intent.",
        recorded: toolCall("echo", { message: "please say hello" }),
        incoming: toolCall("echo", { message: "please  say hello" }),
    },
    {
        id: "whitespace-003",
        category: "whitespace_prose",
        expected: "MATCH",
        rationale: "Trailing newline appended by a client that always terminates input.",
        recorded: toolCall("summarize", { text: "Ship the v2 API by Friday" }),
        incoming: toolCall("summarize", { text: "Ship the v2 API by Friday\n" }),
    },
    {
        id: "whitespace-004",
        category: "whitespace_prose",
        expected: "MATCH",
        rationale: "Tabs vs. spaces in a free-text argument.",
        recorded: toolCall("echo", { message: "alpha beta gamma" }),
        incoming: toolCall("echo", { message: "alpha\tbeta\tgamma" }),
    },
    {
        id: "whitespace-005",
        category: "whitespace_prose",
        expected: "MATCH",
        rationale: "Whitespace variation combined with unrelated key reordering.",
        recorded: toolCall("search_users", { query: "John Smith", limit: 10 }),
        incoming: toolCall("search_users", { limit: 10, query: "John Smith  " }),
    },

    // ---- case_variation_prose: a single character's case is not a new request ----
    {
        id: "case-variation-001",
        category: "case_variation_prose",
        expected: "MATCH",
        rationale: "One letter's case flipped in an otherwise identical sentence.",
        recorded: toolCall("echo", { message: "please say hello" }),
        incoming: toolCall("echo", { message: "please say hellO" }),
    },
    {
        id: "case-variation-002",
        category: "case_variation_prose",
        expected: "MATCH",
        rationale: "A proper noun's casing normalized differently by the client.",
        recorded: toolCall("search_users", { query: "john smith" }),
        incoming: toolCall("search_users", { query: "John Smith" }),
    },
    {
        id: "case-variation-003",
        category: "case_variation_prose",
        expected: "MATCH",
        rationale: "All-caps vs. sentence case for the same short phrase.",
        recorded: toolCall("echo", { message: "hello world" }),
        incoming: toolCall("echo", { message: "HELLO WORLD" }),
    },
    {
        id: "case-variation-004",
        category: "case_variation_prose",
        expected: "MATCH",
        rationale: "Mixed casing drift across several words.",
        recorded: toolCall("summarize", { text: "the quick brown fox" }),
        incoming: toolCall("summarize", { text: "The Quick Brown Fox" }),
    },

    // ---- typo_prose: this is the tier semantic matching exists for ----
    {
        id: "typo-001",
        category: "typo_prose",
        expected: "MATCH",
        rationale: "Single-character typo in a search query -- exactly the case exact/structural can't handle.",
        recorded: toolCall("search", { query: "best pizza near me" }),
        incoming: toolCall("search", { query: "best pizza near mee" }),
    },
    {
        id: "typo-002",
        category: "typo_prose",
        expected: "MATCH",
        rationale: "A transposed letter pair.",
        recorded: toolCall("search", { query: "quarterly revenue report" }),
        incoming: toolCall("search", { query: "quarterly revneue report" }),
    },
    {
        id: "typo-003",
        category: "typo_prose",
        expected: "MATCH",
        rationale: "A dropped letter in a longer phrase.",
        recorded: toolCall("summarize", { text: "Please summarize the attached document" }),
        incoming: toolCall("summarize", { text: "Please summarize the atached document" }),
    },
    {
        id: "typo-004",
        category: "typo_prose",
        expected: "MATCH",
        rationale: "Comma dropped, otherwise identical phrasing.",
        recorded: toolCall("echo", { message: "yes, that works" }),
        incoming: toolCall("echo", { message: "yes that works" }),
    },
    {
        id: "typo-005",
        category: "typo_prose",
        expected: "MATCH",
        rationale: "Two agent runs phrasing the same request with minor wording drift, no typo per se.",
        recorded: toolCall("search", { query: "how many users signed up last month" }),
        incoming: toolCall("search", { query: "how many users signed up in the last month" }),
    },

    // ---- optional_param_added: an extra, additive argument on the incoming side ----
    {
        id: "optional-param-001",
        category: "optional_param_added",
        expected: "MATCH",
        rationale: "Incoming adds a param that matches the tool's documented default -- same effective request.",
        recorded: toolCall("search", { query: "coffee" }),
        incoming: toolCall("search", { query: "coffee", limit: 10 }),
    },
    {
        id: "optional-param-002",
        category: "optional_param_added",
        expected: "MATCH",
        rationale: "Same, with the addition on the recorded side instead (client omitted a default this time).",
        recorded: toolCall("list_files", { dir: "/repo", recursive: false }),
        incoming: toolCall("list_files", { dir: "/repo" }),
    },
    {
        id: "optional-param-003",
        category: "optional_param_added",
        expected: "MATCH",
        rationale: "An additive, non-identifying flag (verbose output) shouldn't gate replay.",
        recorded: toolCall("run_tests", { suite: "unit" }),
        incoming: toolCall("run_tests", { suite: "unit", verbose: true }),
    },
    {
        id: "optional-param-004",
        category: "optional_param_added",
        expected: "MATCH",
        rationale: "Two additive params at once.",
        recorded: toolCall("search", { query: "coffee shops" }),
        incoming: toolCall("search", { query: "coffee shops", limit: 5, sort: "distance" }),
    },
    {
        id: "optional-param-005",
        category: "optional_param_added",
        expected: "MATCH",
        rationale: "Additive param combined with whitespace drift in the shared field.",
        recorded: toolCall("search", { query: "best pizza" }),
        incoming: toolCall("search", { query: "best pizza ", limit: 10 }),
    },

    // ---- tool_name_mismatch: the sharpest hard gate -- different tool, never match ----
    {
        id: "tool-mismatch-001",
        category: "tool_name_mismatch",
        expected: "REJECT",
        rationale: "delete_user must never satisfy a get_user request, however similar the arguments.",
        recorded: toolCall("get_user", { user_id: "123" }),
        incoming: toolCall("delete_user", { user_id: "123" }),
    },
    {
        id: "tool-mismatch-002",
        category: "tool_name_mismatch",
        expected: "REJECT",
        rationale: "read vs. write on the same identifier is the single most dangerous confusion to allow.",
        recorded: toolCall("write_file", { path: "/tmp/report.txt", content: "done" }),
        incoming: toolCall("read_file", { path: "/tmp/report.txt" }),
    },
    {
        id: "tool-mismatch-003",
        category: "tool_name_mismatch",
        expected: "REJECT",
        rationale: "Same arguments, similarly-named but distinct tools.",
        recorded: toolCall("archive_issue", { repo: "org/repo", issue: 42 }),
        incoming: toolCall("close_issue", { repo: "org/repo", issue: 42 }),
    },
    {
        id: "tool-mismatch-004",
        category: "tool_name_mismatch",
        expected: "REJECT",
        rationale: "Approve vs. reject on an identical payload -- opposite real-world effects.",
        recorded: toolCall("approve_request", { request_id: "r-1" }),
        incoming: toolCall("reject_request", { request_id: "r-1" }),
    },
    {
        id: "tool-mismatch-005",
        category: "tool_name_mismatch",
        expected: "REJECT",
        rationale: "Tool names differ by one character -- must not be treated as a typo of each other.",
        recorded: toolCall("get_repo", { name: "deja" }),
        incoming: toolCall("get_repos", { name: "deja" }),
    },
    {
        id: "tool-mismatch-006",
        category: "tool_name_mismatch",
        expected: "REJECT",
        rationale: "Transfer vs. refund with identical amount/recipient.",
        recorded: toolCall("transfer_money", { amount: 100, recipient: "Alice" }),
        incoming: toolCall("refund_money", { amount: 100, recipient: "Alice" }),
    },
    {
        id: "tool-mismatch-007",
        category: "tool_name_mismatch",
        expected: "REJECT",
        rationale: "No arguments at all on either side -- tool identity alone must still gate.",
        recorded: toolCall("start_server", {}),
        incoming: toolCall("stop_server", {}),
    },
    {
        id: "tool-mismatch-008",
        category: "tool_name_mismatch",
        expected: "REJECT",
        rationale: "Singular vs. plural resource tool, easy to phrase-confuse, must not fuzzy-match.",
        recorded: toolCall("delete_file", { path: "/tmp/x" }),
        incoming: toolCall("delete_files", { path: "/tmp/x" }),
    },

    // ---- path_near_miss: path/URI-shaped strings are opaque identifiers, never fuzzy ----
    {
        id: "path-near-miss-001",
        category: "path_near_miss",
        expected: "REJECT",
        rationale: "Two different files sharing a long directory prefix must never fuzzy-match.",
        recorded: toolCall("read_text_file", { path: "/home/user/projects/deja/data/config.txt" }),
        incoming: toolCall("read_text_file", { path: "/home/user/projects/deja/data/other.txt" }),
    },
    {
        id: "path-near-miss-002",
        category: "path_near_miss",
        expected: "REJECT",
        rationale: "A single path segment (record id) differs -- classic off-by-one resource confusion.",
        recorded: toolCall("get_record", { path: "/read/users/123/profile" }),
        incoming: toolCall("get_record", { path: "/read/users/124/profile" }),
    },
    {
        id: "path-near-miss-003",
        category: "path_near_miss",
        expected: "REJECT",
        rationale: "URL differing only in its final path segment.",
        recorded: toolCall("fetch", { url: "https://example.com/api/v1/orders/1001" }),
        incoming: toolCall("fetch", { url: "https://example.com/api/v1/orders/1002" }),
    },
    {
        id: "path-near-miss-004",
        category: "path_near_miss",
        expected: "REJECT",
        rationale: "Windows-style path, one directory component changed.",
        recorded: toolCall("read_text_file", { path: "C:\\repo\\src\\core\\match.ts" }),
        incoming: toolCall("read_text_file", { path: "C:\\repo\\src\\core\\redact.ts" }),
    },
    {
        id: "path-near-miss-005",
        category: "path_near_miss",
        expected: "REJECT",
        rationale: "Same directory, extension changed -- still a different file.",
        recorded: toolCall("read_text_file", { path: "/data/report.json" }),
        incoming: toolCall("read_text_file", { path: "/data/report.csv" }),
    },
    {
        id: "path-near-miss-006",
        category: "path_near_miss",
        expected: "REJECT",
        rationale: "A path buried inside a nested object, not a top-level argument.",
        recorded: toolCall("copy_file", { options: { source: "/a/b/c.txt", overwrite: true } }),
        incoming: toolCall("copy_file", { options: { source: "/a/b/d.txt", overwrite: true } }),
    },
    {
        id: "path-near-miss-007",
        category: "path_near_miss",
        expected: "REJECT",
        rationale: "Query-string-bearing URL differing only in an id parameter.",
        recorded: toolCall("fetch", { url: "https://api.example.com/user?id=42" }),
        incoming: toolCall("fetch", { url: "https://api.example.com/user?id=43" }),
    },
    {
        id: "path-near-miss-008",
        category: "path_near_miss",
        expected: "REJECT",
        rationale: "One path inside an array of paths differs from the rest.",
        recorded: toolCall("read_many", { paths: ["/a/1.txt", "/a/2.txt"] }),
        incoming: toolCall("read_many", { paths: ["/a/1.txt", "/a/3.txt"] }),
    },

    // ---- numeric_value_changed_dangerous: side-effecting numeric args must not fuzzy-match ----
    {
        id: "numeric-dangerous-001",
        category: "numeric_value_changed_dangerous",
        expected: "REJECT",
        rationale: "A 10x change in a money-transfer amount is the canonical case this project exists to prevent.",
        recorded: toolCall("transfer_money", { amount: 100, recipient: "Alice" }),
        incoming: toolCall("transfer_money", { amount: 1000, recipient: "Alice" }),
    },
    {
        id: "numeric-dangerous-002",
        category: "numeric_value_changed_dangerous",
        expected: "REJECT",
        rationale: "Same recipient, a smaller but still materially different amount.",
        recorded: toolCall("transfer_money", { amount: 50, recipient: "Bob" }),
        incoming: toolCall("transfer_money", { amount: 55, recipient: "Bob" }),
    },
    {
        id: "numeric-dangerous-003",
        category: "numeric_value_changed_dangerous",
        expected: "REJECT",
        rationale: "Quantity change on a purchase/order tool.",
        recorded: toolCall("place_order", { sku: "WIDGET-1", quantity: 1 }),
        incoming: toolCall("place_order", { sku: "WIDGET-1", quantity: 100 }),
    },
    {
        id: "numeric-dangerous-004",
        category: "numeric_value_changed_dangerous",
        expected: "REJECT",
        rationale: "Off-by-one on a destructive range operation (delete rows 1-10 vs 1-11).",
        recorded: toolCall("delete_rows", { table: "users", from: 1, to: 10 }),
        incoming: toolCall("delete_rows", { table: "users", from: 1, to: 11 }),
    },
    {
        id: "numeric-dangerous-005",
        category: "numeric_value_changed_dangerous",
        expected: "REJECT",
        rationale: "Permission/access-level numeric change.",
        recorded: toolCall("set_permission", { user: "bob", level: 1 }),
        incoming: toolCall("set_permission", { user: "bob", level: 9 }),
    },
    {
        id: "numeric-dangerous-006",
        category: "numeric_value_changed_dangerous",
        expected: "REJECT",
        rationale: "Negative vs. positive amount -- opposite direction of money movement.",
        recorded: toolCall("adjust_balance", { account: "acc-1", delta: 100 }),
        incoming: toolCall("adjust_balance", { account: "acc-1", delta: -100 }),
    },
    {
        id: "numeric-dangerous-007",
        category: "numeric_value_changed_dangerous",
        expected: "REJECT",
        rationale: "A dangerous numeric change mixed in with an otherwise-benign key reorder and whitespace tweak.",
        recorded: toolCall("transfer_money", { amount: 100, recipient: "Alice", note: "rent" }),
        incoming: toolCall("transfer_money", { note: "rent ", recipient: "Alice", amount: 100000 }),
    },
    {
        id: "numeric-dangerous-008",
        category: "numeric_value_changed_dangerous",
        expected: "REJECT",
        rationale: "Small absolute change but large relative change on a low-magnitude value.",
        recorded: toolCall("set_retry_count", { value: 1 }),
        incoming: toolCall("set_retry_count", { value: 10 }),
    },

    // ---- method_mismatch: different JSON-RPC method entirely ----
    {
        id: "method-mismatch-001",
        category: "method_mismatch",
        expected: "REJECT",
        rationale: "resources/list must never satisfy a tools/list request.",
        recorded: req("tools/list"),
        incoming: req("resources/list"),
    },
    {
        id: "method-mismatch-002",
        category: "method_mismatch",
        expected: "REJECT",
        rationale: "A notification must never satisfy a request expecting a response.",
        recorded: { jsonrpc: "2.0", method: "notifications/progress", params: { progress: 50 } },
        incoming: req("tools/call", { name: "long_task", arguments: {} }),
    },
    {
        id: "method-mismatch-003",
        category: "method_mismatch",
        expected: "REJECT",
        rationale: "prompts/get vs. resources/read -- different subsystems entirely.",
        recorded: req("prompts/get", { name: "greeting" }),
        incoming: req("resources/read", { uri: "greeting://default" }),
    },
    {
        id: "method-mismatch-004",
        category: "method_mismatch",
        expected: "REJECT",
        rationale: "initialize vs. tools/list -- lifecycle method confused with a data method.",
        recorded: req("initialize", { protocolVersion: "2025-06-18" }),
        incoming: req("tools/list"),
    },
    {
        id: "method-mismatch-005",
        category: "method_mismatch",
        expected: "REJECT",
        rationale: "Same params shape, different method name only.",
        recorded: req("tools/call", { name: "search", arguments: { query: "x" } }),
        incoming: req("sampling/createMessage", { name: "search", arguments: { query: "x" } }),
    },

    // ---- completely_unrelated: low-similarity control cases ----
    {
        id: "unrelated-001",
        category: "completely_unrelated",
        expected: "REJECT",
        rationale: "Same tool, wholly unrelated query text -- a clean low-similarity control.",
        recorded: toolCall("search", { query: "aaaaaaaaaa" }),
        incoming: toolCall("search", { query: "zzzzzzzzzz completely unrelated" }),
    },
    {
        id: "unrelated-002",
        category: "completely_unrelated",
        expected: "REJECT",
        rationale: "Different tool, different arguments, nothing in common.",
        recorded: toolCall("get_weather", { city: "Austin" }),
        incoming: toolCall("send_email", { to: "a@example.com", subject: "hi" }),
    },
    {
        id: "unrelated-003",
        category: "completely_unrelated",
        expected: "REJECT",
        rationale: "Same tool family, entirely different subject matter in free text.",
        recorded: toolCall("summarize", { text: "Quarterly earnings exceeded expectations" }),
        incoming: toolCall("summarize", { text: "The cat sat on the mat all afternoon" }),
    },
    {
        id: "unrelated-004",
        category: "completely_unrelated",
        expected: "REJECT",
        rationale: "Structurally similar shape (one string field) but unrelated content and unrelated tool.",
        recorded: toolCall("translate", { text: "hello" }),
        incoming: toolCall("classify_sentiment", { text: "hello" }),
    },
    {
        id: "unrelated-005",
        category: "completely_unrelated",
        expected: "REJECT",
        rationale: "Numeric arguments with nothing else in common.",
        recorded: toolCall("compute_area", { width: 3, height: 4 }),
        incoming: toolCall("compute_area", { width: 9000, height: 1 }),
    },
    {
        id: "unrelated-006",
        category: "completely_unrelated",
        expected: "REJECT",
        rationale: "Empty-argument tool call vs. a heavily-parameterized different tool.",
        recorded: toolCall("ping", {}),
        incoming: toolCall("create_issue", { repo: "org/repo", fields: { title: "Bug" } }),
    },

    // ---- identifier_changed_non_path: opaque identifiers that don't look like paths/URIs ----
    // These deliberately probe the edge of the hard gate, which only recognizes slash- or
    // backslash-shaped strings as opaque identifiers. A bare numeric-looking id string is a
    // real stress test of the semantic tier's own judgment, not the hard gate's.
    {
        id: "identifier-non-path-001",
        category: "identifier_changed_non_path",
        expected: "REJECT",
        rationale: "A single-digit-different user id with no path separators -- must not fuzzy-match on string similarity alone.",
        recorded: toolCall("get_user", { user_id: "1234567" }),
        incoming: toolCall("get_user", { user_id: "1234568" }),
    },
    {
        id: "identifier-non-path-002",
        category: "identifier_changed_non_path",
        expected: "REJECT",
        rationale: "UUID-shaped identifiers differing in one character block.",
        recorded: toolCall("get_order", { order_id: "a1b2c3d4-e5f6-0000-0000-000000000001" }),
        incoming: toolCall("get_order", { order_id: "a1b2c3d4-e5f6-0000-0000-000000000002" }),
    },
    {
        id: "identifier-non-path-003",
        category: "identifier_changed_non_path",
        expected: "REJECT",
        rationale: "Email address identifying a different recipient, high character overlap.",
        recorded: toolCall("send_invite", { email: "alice@example.com" }),
        incoming: toolCall("send_invite", { email: "alicia@example.com" }),
    },
    {
        id: "identifier-non-path-004",
        category: "identifier_changed_non_path",
        expected: "REJECT",
        rationale: "Account number differing in a middle digit.",
        recorded: toolCall("close_account", { account_number: "000123456789" }),
        incoming: toolCall("close_account", { account_number: "000123956789" }),
    },
    {
        id: "identifier-non-path-005",
        category: "identifier_changed_non_path",
        expected: "REJECT",
        rationale: "Short numeric identifier, single-tool, no other params to anchor similarity.",
        recorded: toolCall("delete_record", { id: 501 }),
        incoming: toolCall("delete_record", { id: 502 }),
    },
    {
        id: "identifier-non-path-006",
        category: "identifier_changed_non_path",
        expected: "REJECT",
        rationale: "Git commit-SHA-shaped identifier, one character different.",
        recorded: toolCall("get_commit", { sha: "8f14e45fceea167a5a36dedd4bea2543" }),
        incoming: toolCall("get_commit", { sha: "8f14e45fceea167a5a36dedd4bea2544" }),
    },
];
