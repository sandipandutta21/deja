# deja

**Record/replay for MCP that survives non-deterministic agent clients.**

`deja` is a VCR for the [Model Context Protocol](https://modelcontextprotocol.io): it records a
real MCP session (stdio or Streamable HTTP) to a plain JSONL cassette, then replays it later —
offline, deterministic, in CI — even though the client replaying it will never send byte-for-byte
identical requests twice. That gap is closed by a tiered matcher (exact → structural →
deterministic semantic similarity) instead of a naive request/response recording.

One open cassette format, two independent language implementations (TypeScript and Java) that
read and write byte-compatible files, and native test integrations for both ecosystems.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![Java](https://img.shields.io/badge/java-17%2B-orange)
[![Maven Central](https://img.shields.io/maven-central/v/io.github.sandipandutta21/deja-core)](https://central.sonatype.com/artifact/io.github.sandipandutta21/deja-core)

## Why

Record/replay testing tools assume a deterministic client: same request in, same request out,
every time. An LLM-driven agent breaks that assumption — the same *intent* ("read this file")
can arrive as structurally different JSON-RPC calls between runs. A naive VCR either matches too
strictly (the recording rots the moment an agent phrases a call slightly differently) or too
loosely (a fuzzy matcher risks confidently returning the wrong tool's content for a request that
only looks similar). `deja`'s matching tier ladder — with hard safety gates against exactly that
failure mode — is the part of this project that isn't "MCP nock."

## Highlights

- **Recording** — transparent stdio proxy or Streamable HTTP proxy (SSE and pre-2025 batch
  arrays included); captures the full wire, including server-initiated traffic (notifications,
  sampling, elicitation); secret redaction on by default (GitHub/`sk-`/Slack/AWS/JWT/Bearer/
  URL-embedded credentials → deterministic, hashed placeholders).
- **Replay** — the cassette *is* the server, over stdio or HTTP; cross-transport (record over
  HTTP, replay over stdio, or vice versa); a matcher failure answers a clean JSON-RPC error for
  that one request instead of poisoning the whole session.
- **Matching, the differentiator** — exact → structural (key-order independent) → deterministic
  semantic (token Jaccard + trigram Dice + numeric closeness + recursive structural weighting) →
  optional bring-your-own LLM judge for the uncertain band only. Hard gates: `tools/call` never
  matches across different tool names, and path/URI-shaped parameters never fuzzy-match each
  other, however much of the string they share.
- **Contract gating** — `deja verify` replays a cassette against a *live* server and diffs
  responses field-by-field to catch drift; `deja diff` classifies breaking vs. minor changes
  between two cassettes (removed tools, newly-required params, result↔error flips, removed
  fields); `deja redact --scan` is a CI tripwire against committing an unredacted fixture.
- **Native test integrations** — a zero-config `useCassette()` Vitest fixture on the TS side; a
  JUnit 5 `@Cassette` extension on the Java side that lets the official MCP Java SDK's
  `McpClient` run **unmodified** against a cassette, with `DEJA_MODE=record` re-recording the
  identical test code against a real server.
- **Validated against real servers**, not just fixtures — both implementations are tested
  directly against the official MCP reference servers (`server-everything`,
  `server-filesystem`), which is how several of the correctness fixes in this codebase were
  actually found.

## Repository layout

```
deja/
├── ts/            TypeScript implementation — CLI (deja record/replay/verify/diff/redact)
│                  + library + Vitest integration
├── java/          Java implementation — deja-core (native engine) + deja-junit5
│                  (JUnit 5 @Cassette extension), a Gradle multi-module build
├── conformance/   Cassette fixtures shared by both test suites, proving the two
│                  implementations read and write byte-compatible files
├── LICENSE
└── README.md      you are here
```

## Quick start — TypeScript

```bash
cd ts
npm install
npm run build

# Record a real session
npx deja record -o session.cassette.jsonl -- node your-mcp-server.js

# Replay it later, offline
npx deja replay session.cassette.jsonl
```

Or from a test suite, with zero subprocess in CI:

```ts
import { useCassette } from "deja-mcp/vitest";

const mcp = useCassette("fixtures/session.jsonl", {
  record: { command: ["node", "your-mcp-server.js"] },
});

test("lists tools", async () => {
  const client = await mcp.connect();
  const { tools } = await client.listTools();
  expect(tools).toContainEqual(expect.objectContaining({ name: "search" }));
});
```

See [`ts/`](ts/) for the full CLI reference.

## Quick start — Java

Published on Maven Central as `io.github.sandipandutta21:deja-core` (the engine, zero test-framework
dependency) and `io.github.sandipandutta21:deja-junit5` (adds the JUnit 5 `@Cassette` extension;
depends on `deja-core` transitively):

```kotlin
// your project's build.gradle.kts
dependencies {
    testImplementation("io.github.sandipandutta21:deja-junit5:0.1.1")
}
```

```java
@Cassette(
        value = "src/test/resources/fixtures/session.jsonl",
        record = {"node", "your-mcp-server.js"})
class YourServerTest {

    @Test
    void listsTools(McpSession session) {
        McpSyncClient client = session.connect(); // the real MCP Java SDK client, unmodified
        var tools = client.listTools();
        assertThat(tools.tools()).extracting(Tool::name).contains("search");
    }
}
```

See [`java/`](java/) for the module breakdown.

## The cassette format

A cassette is a JSONL file: one header line, then one line per captured frame.

```jsonl
{"type":"header","version":1,"recorded_at":"2026-01-01T00:00:00Z","transport":"stdio","server_command":["node","server.js"]}
{"type":"frame","dir":"c2s","t_ms":0,"msg":{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"fetch","url":"https://example.com"}}}
{"type":"frame","dir":"s2c","t_ms":12,"msg":{"jsonrpc":"2.0","id":1,"result":{"ok":true}}}
```

It's a plain, versioned, language-agnostic format on purpose: [`conformance/`](conformance/)
holds fixtures written by one implementation and read by the other, including a proof that both
languages compute the *identical* redaction hash for the same secret.

## Benchmark

The matching tier ladder's actual claim — replay semantically-equivalent-but-different requests
without introducing dangerous false matches — is backed by a hand-labeled corpus of 76 JSON-RPC
(recorded, incoming) pairs, scored against three matchers: naive exact JSON equality, deja's
structural tier alone, and deja's full pipeline.

| Matcher | Precision | Recall | False-positive rate |
|---|---:|---:|---:|
| Exact (naive JSON equality) | 100.0% | 11.4% | 0.0% |
| Structural only (deja tier 1/2) | 100.0% | 37.1% | 0.0% |
| **Deja full pipeline** | **85.4%** | **100.0%** | **14.6%** |

False-positive rate is the number that matters most: a wrong match means replaying the wrong
tool's result, or worse, a mutating call with different arguments silently looking "already
handled." The full report — including a by-category breakdown and, honestly, the two specific
kinds of case the deterministic tier still can't safely catch (small-magnitude-but-consequential
numeric drift, and opaque identifiers like UUIDs/emails/hashes that aren't path/URI-shaped) — is
in [`ts/benchmarks/RESULTS.md`](ts/benchmarks/RESULTS.md). Every case and its rationale is in
[`ts/benchmarks/corpus.mjs`](ts/benchmarks/corpus.mjs); regenerate with `npm run benchmark` from
`ts/`.

## License

MIT © Sandipan Dutta — see [LICENSE](LICENSE).
