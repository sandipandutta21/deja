package dev.deja.core.redact;

import com.fasterxml.jackson.core.type.TypeReference;
import dev.deja.core.cassette.JsonRpcMessage;
import dev.deja.core.json.Json;
import lombok.experimental.UtilityClass;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Secret redaction: known-shaped tokens (GitHub, OpenAI-style {@code sk-}, Slack, AWS, JWT,
 * Bearer, URL-embedded credentials) and credential-named object keys are replaced with a
 * deterministic {@code [REDACTED:<rule>:<hash>]} placeholder. Idempotent: re-redacting an
 * already-redacted value is a no-op.
 *
 * <p>Mirrors the TypeScript implementation's {@code redact.ts} rule-for-rule, and hashes with
 * the same algorithm (SHA-256 of the UTF-8 secret, first 8 hex characters) so the same secret
 * produces byte-identical placeholders in both languages -- required for the cross-language
 * conformance suite.
 */
@UtilityClass
public class Redact {

    private final TypeReference<Map<String, Object>> MAP_TYPE_REF = new TypeReference<>() {
    };

    private final Set<String> SENSITIVE_KEYS = Set.of(
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
            "cookie");

    private record SecretPattern(String rule, Pattern pattern) {
    }

    private final List<SecretPattern> SECRET_PATTERNS = List.of(
            new SecretPattern("github", Pattern.compile("(gh[pousr]_[A-Za-z0-9_]{36,255})")),
            new SecretPattern("sk", Pattern.compile("(sk-[a-zA-Z0-9]{20,})")),
            new SecretPattern("slack", Pattern.compile("(xox[baprs]-[A-Za-z0-9-]{10,72})")),
            new SecretPattern("aws-access-key", Pattern.compile("(AKIA[0-9A-Z]{16})")),
            new SecretPattern("bearer", Pattern.compile("(?<=Bearer\\s+)[A-Za-z0-9\\-._~+/]+=*")),
            new SecretPattern("jwt", Pattern.compile("(eyJ[a-zA-Z0-9_-]+\\.[a-zA-Z0-9_-]+\\.[a-zA-Z0-9_-]+)")),
            new SecretPattern("url-creds", Pattern.compile("(?<=://)[^/\\s:@]+:[^/\\s@]+(?=@)")));

    private final Pattern PLACEHOLDER_PATTERN = Pattern.compile("^\\[REDACTED:[a-z0-9_-]+:[0-9a-f]{8}]$", Pattern.CASE_INSENSITIVE);

    private boolean isPlaceholder(String value) {
        return PLACEHOLDER_PATTERN.matcher(value).matches();
    }

    /** A deterministic {@code [REDACTED:<rule>:<hash>]} placeholder: the same secret always
     *  hashes to the same placeholder, so a live secret still structurally matches its
     *  redacted recording during replay. */
    public String createPlaceholder(String rule, String secret) {
        return "[REDACTED:" + rule + ":" + sha256Hex8(secret) + "]";
    }

    private String sha256Hex8(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(8);
            for (int i = 0; i < 4; i++) {
                hex.append(String.format("%02x", hash[i]));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException e) {
            // SHA-256 is a JDK-guaranteed algorithm (JLS/JCA baseline); this can't happen.
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    /** Replaces every recognized secret pattern found anywhere in {@code value}. */
    public String redactString(String value) {
        String result = value;
        for (SecretPattern secretPattern : SECRET_PATTERNS) {
            Matcher matcher = secretPattern.pattern().matcher(result);
            StringBuilder sb = new StringBuilder();
            int lastEnd = 0;
            while (matcher.find()) {
                sb.append(result, lastEnd, matcher.start());
                sb.append(createPlaceholder(secretPattern.rule(), matcher.group()));
                lastEnd = matcher.end();
            }
            sb.append(result, lastEnd, result.length());
            result = sb.toString();
        }
        return result;
    }

    /**
     * Recursively redacts a generic JSON-shaped value (as produced by deserializing JSON into
     * {@code Object}: nested {@code Map<String, Object>}, {@code List<Object>}, {@code
     * String}, {@code Number}, {@code Boolean}, or {@code null}). A value under a
     * credential-named key is replaced outright; every other string is scanned for the known
     * secret patterns.
     */
    @SuppressWarnings("unchecked")
    public Object redactObject(Object value) {
        if (value instanceof String s) {
            return redactString(s);
        }

        if (value instanceof List<?> list) {
            List<Object> redacted = new ArrayList<>(list.size());
            for (Object element : list) {
                redacted.add(redactObject(element));
            }
            return redacted;
        }

        if (value instanceof Map<?, ?> map) {
            Map<String, Object> redacted = new LinkedHashMap<>();
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                String key = String.valueOf(entry.getKey());
                Object entryValue = entry.getValue();
                if (SENSITIVE_KEYS.contains(key.toLowerCase()) && entryValue instanceof String stringValue) {
                    redacted.put(key, isPlaceholder(stringValue) ? stringValue : createPlaceholder("key_match", stringValue));
                } else {
                    redacted.put(key, redactObject(entryValue));
                }
            }
            return redacted;
        }

        return value;
    }

    /** Redacts an entire {@link JsonRpcMessage} -- params, result, and error (including {@code
     *  error.data}) alike -- by round-tripping it through a generic tree, exactly like the
     *  TypeScript implementation's {@code redactObject(msg)} walks the whole parsed object.
     *  Messages are immutable, so this always returns a new instance. */
    public JsonRpcMessage redactMessage(JsonRpcMessage msg) {
        Map<String, Object> tree = Json.MAPPER.convertValue(msg, MAP_TYPE_REF);
        Object redactedTree = redactObject(tree);
        return Json.MAPPER.convertValue(redactedTree, JsonRpcMessage.class);
    }

    /** Every redaction rule that still has a raw, unredacted match anywhere in {@code msg}
     *  (params, result, or error alike). */
    public Set<String> scanForSecrets(JsonRpcMessage msg) {
        Map<String, Object> tree = Json.MAPPER.convertValue(msg, MAP_TYPE_REF);
        return scanForSecrets((Object) tree);
    }

    /** Redacts a CLI-style command array: {@code --key=value} and {@code KEY=value} arguments
     *  whose key (leading dashes stripped) is credential-named have their value replaced. */
    public List<String> redactCommand(List<String> command) {
        List<String> redacted = new ArrayList<>(command.size());
        for (String arg : command) {
            int eq = arg.indexOf('=');
            if (eq >= 0) {
                String key = arg.substring(0, eq);
                String value = arg.substring(eq + 1);
                // CLI flags carry a leading "-"/"--" that a bare key name like "token" never
                // has -- strip it before comparing, or "--token=..." would never match.
                String normalizedKey = key.replaceFirst("^--?", "").toLowerCase();
                if (SENSITIVE_KEYS.contains(normalizedKey)) {
                    redacted.add(key + "=" + (isPlaceholder(value) ? value : createPlaceholder("key_match", value)));
                    continue;
                }
            }
            redacted.add(redactString(arg));
        }
        return redacted;
    }

    /** Reduces a URL to scheme + host, dropping path, query, and any embedded credentials --
     *  so cassette headers never retain more than the bare origin. */
    public String toOriginOnly(String rawUrl) {
        URI uri = URI.create(rawUrl);
        String authority = uri.getHost() + (uri.getPort() == -1 ? "" : ":" + uri.getPort());
        return uri.getScheme() + "://" + authority;
    }

    /** The redaction rule matching {@code value}, if any. Resets each pattern's matcher state
     *  before use so repeated calls can't silently miss matches. */
    public Optional<String> containsSecret(String value) {
        for (SecretPattern secretPattern : SECRET_PATTERNS) {
            if (secretPattern.pattern().matcher(value).find()) {
                return Optional.of(secretPattern.rule());
            }
        }
        return Optional.empty();
    }

    /** Every redaction rule that still has a raw, unredacted match somewhere inside {@code value}. */
    public Set<String> scanForSecrets(Object value) {
        Set<String> hits = new LinkedHashSet<>();
        scanValue(value, hits);
        return hits;
    }

    private void scanValue(Object value, Set<String> hits) {
        if (value instanceof String s) {
            containsSecret(s).ifPresent(hits::add);
            return;
        }

        if (value instanceof List<?> list) {
            for (Object element : list) {
                scanValue(element, hits);
            }
            return;
        }

        if (value instanceof Map<?, ?> map) {
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                String key = String.valueOf(entry.getKey());
                Object entryValue = entry.getValue();
                if (SENSITIVE_KEYS.contains(key.toLowerCase()) && entryValue instanceof String stringValue
                        && !stringValue.isEmpty() && !isPlaceholder(stringValue)) {
                    hits.add("key_match");
                    continue;
                }
                scanValue(entryValue, hits);
            }
        }
    }
}
