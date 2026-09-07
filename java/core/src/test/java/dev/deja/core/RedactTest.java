package dev.deja.core;

import dev.deja.core.cassette.JsonRpcError;
import dev.deja.core.cassette.JsonRpcMessage;
import dev.deja.core.redact.Redact;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class RedactTest {

    @Test
    void redactsWellKnownStringShapes() {
        String raw = "Here is my key: sk-abc123def456ghi789jkl012mno345pqr678stu901 and github token ghp_123456789012345678901234567890123456";
        String scrubbed = Redact.redactString(raw);

        assertThat(scrubbed).doesNotContain("sk-abc123def456ghi789jkl012mno345pqr678stu901");
        assertThat(scrubbed).doesNotContain("ghp_123456789012345678901234567890123456");
        assertThat(scrubbed).matches(".*\\[REDACTED:sk:[a-f0-9]{8}].*");
        assertThat(scrubbed).matches(".*\\[REDACTED:github:[a-f0-9]{8}].*");
    }

    @Test
    void redactsSlackTokens() {
        assertThat(Redact.redactString("slack token xoxb-FAKEFAKEFAKE-NOTREALNOTREAL-notarealslacktoken"))
                .matches(".*\\[REDACTED:slack:[a-f0-9]{8}].*");
    }

    @Test
    void redactsAwsAccessKeys() {
        assertThat(Redact.redactString("AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE"))
                .matches(".*\\[REDACTED:aws-access-key:[a-f0-9]{8}].*");
    }

    @Test
    void redactsJwts() {
        String jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
        assertThat(Redact.redactString(jwt)).matches(".*\\[REDACTED:jwt:[a-f0-9]{8}].*");
    }

    @Test
    void redactsCredentialsEmbeddedInAUrl() {
        String scrubbed = Redact.redactString("postgres://admin:hunter2@db.internal:5432/app");
        assertThat(scrubbed).doesNotContain("admin:hunter2");
        assertThat(scrubbed).matches(".*\\[REDACTED:url-creds:[a-f0-9]{8}].*");
    }

    @Test
    @SuppressWarnings("unchecked")
    void redactsSensitiveObjectKeysDeterministically() {
        Map<String, Object> nested = new LinkedHashMap<>();
        nested.put("Authorization", "Bearer token123");
        Map<String, Object> raw = new LinkedHashMap<>();
        raw.put("user", "test");
        raw.put("apiKey", "super-secret-key");
        raw.put("nested", nested);

        Map<String, Object> scrubbed = (Map<String, Object>) Redact.redactObject(raw);

        assertThat(scrubbed.get("user")).isEqualTo("test");
        assertThat((String) scrubbed.get("apiKey")).matches("\\[REDACTED:key_match:[a-f0-9]{8}]");
        Map<String, Object> scrubbedNested = (Map<String, Object>) scrubbed.get("nested");
        // The Bearer token in the string also gets caught by string rules.
        assertThat((String) scrubbedNested.get("Authorization")).matches("\\[REDACTED:key_match:[a-f0-9]{8}]");
    }

    @Test
    @SuppressWarnings("unchecked")
    void isIdempotentRedactingAnAlreadyRedactedValueDoesNotDoubleWrapIt() {
        Map<String, Object> original = Map.of("apiKey", "super-secret-key");
        Map<String, Object> once = (Map<String, Object>) Redact.redactObject(original);
        Map<String, Object> twice = (Map<String, Object>) Redact.redactObject(once);

        assertThat(twice.get("apiKey")).isEqualTo(once.get("apiKey"));
        assertThat((String) twice.get("apiKey")).doesNotContainPattern("REDACTED:key_match:[a-f0-9]{8}].*REDACTED");
    }

    @Test
    void scrubsSecretsFromCliCommands() {
        List<String> cmd = List.of("node", "server.js", "--token=my-secret-123", "APIKEY=456");
        List<String> scrubbed = Redact.redactCommand(cmd);

        assertThat(scrubbed.get(0)).isEqualTo("node");
        assertThat(scrubbed.get(2)).matches("--token=\\[REDACTED:key_match:[a-f0-9]{8}]");
        assertThat(scrubbed.get(3)).matches("APIKEY=\\[REDACTED:key_match:[a-f0-9]{8}]");
    }

    @Test
    void createPlaceholderIsDeterministicForTheSameSecretAndRule() {
        assertThat(Redact.createPlaceholder("sk", "same-secret")).isEqualTo(Redact.createPlaceholder("sk", "same-secret"));
    }

    @Test
    void createPlaceholderDiffersForDifferentSecrets() {
        assertThat(Redact.createPlaceholder("sk", "secret-one")).isNotEqualTo(Redact.createPlaceholder("sk", "secret-two"));
    }

    @Test
    void containsSecretDetectsALivePatternAndIsReusableAcrossRepeatedCalls() {
        String secret = "sk-abc123def456ghi789jkl012mno345pqr678stu901";
        // Regression check: `Matcher.find()` is stateful per matcher instance, but a fresh
        // matcher is created per call here, so repeated calls must not start missing matches.
        assertThat(Redact.containsSecret(secret)).contains("sk");
        assertThat(Redact.containsSecret(secret)).contains("sk");
        assertThat(Redact.containsSecret(secret)).contains("sk");
    }

    @Test
    void containsSecretReturnsEmptyForCleanText() {
        assertThat(Redact.containsSecret("just a normal sentence")).isEmpty();
    }

    @Test
    void scanForSecretsFindsSecretsNestedAnywhereInAnObject() {
        Set<String> hits = Redact.scanForSecrets(Map.of(
                "result", Map.of("data", List.of("fine", "sk-abc123def456ghi789jkl012mno345pqr678stu901"))));
        assertThat(hits).contains("sk");
    }

    @Test
    void scanForSecretsFlagsSensitiveKeysHoldingARawValue() {
        assertThat(Redact.scanForSecrets(Map.of("apiKey", "raw-value-not-yet-redacted"))).contains("key_match");
    }

    @Test
    @SuppressWarnings("unchecked")
    void scanForSecretsDoesNotFlagAnAlreadyRedactedPlaceholder() {
        Map<String, Object> redacted = (Map<String, Object>) Redact.redactObject(Map.of("apiKey", "raw-value"));
        assertThat(Redact.scanForSecrets(redacted)).isEmpty();
    }

    @Test
    void scanForSecretsReturnsNoHitsForACleanPayload() {
        assertThat(Redact.scanForSecrets(Map.of("jsonrpc", "2.0", "method", "tools/list"))).isEmpty();
    }

    @Test
    void redactsAndScansAWholeJsonRpcMessageIncludingErrorData() {
        // "note" (not "secret" or any other credential-named key): this exercises the
        // string-pattern rule specifically, not the key-based rule, which would otherwise
        // fire first and mask which rule is actually being tested.
        JsonRpcMessage msg = JsonRpcMessage.error(1, new JsonRpcError(-32000, "failed", Map.of("note", "sk-abc123def456ghi789jkl012mno345pqr678stu901")));

        assertThat(Redact.scanForSecrets(msg)).contains("sk");

        JsonRpcMessage redacted = Redact.redactMessage(msg);
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) redacted.error().data();
        assertThat((String) data.get("note")).matches("\\[REDACTED:sk:[a-f0-9]{8}]");
        assertThat(Redact.scanForSecrets(redacted)).isEmpty();
    }

    @Test
    void toOriginOnlyReducesAUrlToSchemeAndHostDroppingPathQueryAndCredentials() {
        assertThat(Redact.toOriginOnly("https://user:pass@api.example.com:8443/v1/things?x=1"))
                .isEqualTo("https://api.example.com:8443");
    }

    @Test
    void toOriginOnlyPreservesABareOriginUnchanged() {
        assertThat(Redact.toOriginOnly("http://localhost:3000")).isEqualTo("http://localhost:3000");
    }
}
