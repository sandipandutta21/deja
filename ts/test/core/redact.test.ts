import { describe, it, expect } from "vitest";
import { containsSecret, createPlaceholder, redactCommand, redactObject, redactString, scanForSecrets, toOriginOnly } from "../../src/core/redact.js";

describe("Redaction Core", () => {
  it("redacts well-known string shapes", () => {
    const raw = "Here is my key: sk-abc123def456ghi789jkl012mno345pqr678stu901 and github token ghp_123456789012345678901234567890123456";
    const scrubbed = redactString(raw);

    expect(scrubbed).not.toContain("sk-abc123def456ghi789jkl012mno345pqr678stu901");
    expect(scrubbed).not.toContain("ghp_123456789012345678901234567890123456");
    expect(scrubbed).toMatch(/\[REDACTED:sk:[a-f0-9]{8}\]/);
    expect(scrubbed).toMatch(/\[REDACTED:github:[a-f0-9]{8}\]/);
  });

  it("redacts Slack tokens", () => {
    const raw = "slack token xoxb-FAKEFAKEFAKE-NOTREALNOTREAL-notarealslacktoken";
    expect(redactString(raw)).toMatch(/\[REDACTED:slack:[a-f0-9]{8}\]/);
  });

  it("redacts AWS access keys", () => {
    const raw = "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE";
    expect(redactString(raw)).toMatch(/\[REDACTED:aws-access-key:[a-f0-9]{8}\]/);
  });

  it("redacts JWTs", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    expect(redactString(jwt)).toMatch(/\[REDACTED:jwt:[a-f0-9]{8}\]/);
  });

  it("redacts credentials embedded in a URL", () => {
    const raw = "postgres://admin:hunter2@db.internal:5432/app";
    const scrubbed = redactString(raw);
    expect(scrubbed).not.toContain("admin:hunter2");
    expect(scrubbed).toMatch(/\[REDACTED:url-creds:[a-f0-9]{8}\]/);
  });

  it("redacts sensitive object keys deterministically", () => {
    const rawObj = {
      user: "test",
      apiKey: "super-secret-key",
      nested: {
        Authorization: "Bearer token123",
      },
    };

    const scrubbed = redactObject(rawObj) as any;
    expect(scrubbed.user).toBe("test");
    expect(scrubbed.apiKey).toMatch(/\[REDACTED:key_match:[a-f0-9]{8}\]/);
    // The Bearer token in the string also gets caught by string rules
    expect(scrubbed.nested.Authorization).toMatch(/\[REDACTED:key_match:[a-f0-9]{8}\]/);
  });

  it("is idempotent -- redacting an already-redacted value does not double-wrap it", () => {
    const original = { apiKey: "super-secret-key" };
    const once = redactObject(original) as any;
    const twice = redactObject(once) as any;

    expect(twice.apiKey).toBe(once.apiKey);
    expect(twice.apiKey).not.toMatch(/REDACTED:key_match:[a-f0-9]{8}\].*REDACTED/);
  });

  it("scrubs secrets from CLI commands", () => {
    const cmd = ["node", "server.js", "--token=my-secret-123", "APIKEY=456"];
    const scrubbed = redactCommand(cmd);

    expect(scrubbed[0]).toBe("node");
    expect(scrubbed[2]).toMatch(/--token=\[REDACTED:key_match:[a-f0-9]{8}\]/);
    expect(scrubbed[3]).toMatch(/APIKEY=\[REDACTED:key_match:[a-f0-9]{8}\]/);
  });

  it("createPlaceholder is deterministic for the same secret and rule", () => {
    const a = createPlaceholder("sk", "same-secret");
    const b = createPlaceholder("sk", "same-secret");
    expect(a).toBe(b);
  });

  it("createPlaceholder differs for different secrets", () => {
    const a = createPlaceholder("sk", "secret-one");
    const b = createPlaceholder("sk", "secret-two");
    expect(a).not.toBe(b);
  });
});

describe("containsSecret / scanForSecrets", () => {
  it("containsSecret detects a live pattern and is reusable across repeated calls", () => {
    // Regression check: the `g`-flagged regexes are stateful across calls (lastIndex),
    // so a naive implementation would start missing matches on the second or third call.
    expect(containsSecret("sk-abc123def456ghi789jkl012mno345pqr678stu901")?.rule).toBe("sk");
    expect(containsSecret("sk-abc123def456ghi789jkl012mno345pqr678stu901")?.rule).toBe("sk");
    expect(containsSecret("sk-abc123def456ghi789jkl012mno345pqr678stu901")?.rule).toBe("sk");
  });

  it("containsSecret returns null for clean text", () => {
    expect(containsSecret("just a normal sentence")).toBeNull();
  });

  it("scanForSecrets finds secrets nested anywhere in an object", () => {
    const hits = scanForSecrets({
      result: { data: ["fine", "sk-abc123def456ghi789jkl012mno345pqr678stu901"] },
    });
    expect(hits).toContain("sk");
  });

  it("scanForSecrets flags sensitive keys holding a raw (unredacted) value", () => {
    const hits = scanForSecrets({ apiKey: "raw-value-not-yet-redacted" });
    expect(hits).toContain("key_match");
  });

  it("scanForSecrets does not flag an already-redacted placeholder", () => {
    const redacted = redactObject({ apiKey: "raw-value" }) as any;
    expect(scanForSecrets(redacted)).toHaveLength(0);
  });

  it("scanForSecrets returns no hits for a fully clean payload", () => {
    expect(scanForSecrets({ jsonrpc: "2.0", method: "tools/list" })).toHaveLength(0);
  });
});

describe("toOriginOnly", () => {
  it("reduces a URL to scheme + host, dropping path, query, and credentials", () => {
    expect(toOriginOnly("https://user:pass@api.example.com:8443/v1/things?x=1")).toBe("https://api.example.com:8443");
  });

  it("preserves a bare origin unchanged", () => {
    expect(toOriginOnly("http://localhost:3000")).toBe("http://localhost:3000");
  });
});
