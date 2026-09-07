package dev.deja.core.match;

import dev.deja.core.cassette.JsonRpcMessage;
import dev.deja.core.json.Canon;
import dev.deja.core.json.Json;
import lombok.experimental.UtilityClass;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The matching engine: exact/structural equality, and a deterministic semantic similarity
 * tier with two hard safety gates. Mirrors the TypeScript implementation's {@code match.ts},
 * including both hard gates found necessary during real-server testing:
 *
 * <ul>
 *   <li>{@code tools/call} never matches across different tool names, even if every other
 *       parameter is identical.</li>
 *   <li>Two path/URI-shaped string parameters that differ are never fuzzy-matched, however
 *       much of the string they share (e.g. two files under the same long directory prefix) --
 *       fuzzy-matching an identifier risks confidently returning one resource's content for a
 *       request naming a different one.</li>
 * </ul>
 */
@UtilityClass
public class Match {

    private final double WEIGHT_STRUCTURAL = 0.45;
    private final double WEIGHT_TOKEN_JACCARD = 0.35;
    private final double WEIGHT_TRIGRAM_DICE = 0.2;

    /** Width of the "uncertain band" just below the threshold escalated to a judge. */
    private final double JUDGE_BAND_WIDTH = 0.15;

    private final int MAX_RECURSION_DEPTH = 50;

    private final Pattern TOKEN_PATTERN = Pattern.compile("[a-z0-9_]+");

    /** Fast-fails matching across different tools: a recorded {@code fetch} call must never
     *  satisfy an incoming {@code write_file} call just because both are {@code tools/call}. */
    private boolean toolNamesCompatible(JsonRpcMessage incoming, JsonRpcMessage recorded) {
        if (!"tools/call".equals(incoming.method())) {
            return true;
        }
        Object incomingName = incoming.params() == null ? null : incoming.params().get("name");
        Object recordedName = recorded.params() == null ? null : recorded.params().get("name");
        return Objects.equals(incomingName, recordedName);
    }

    /** Strips fields that legitimately vary run-to-run without changing request identity:
     *  MCP's {@code _meta}, an empty {@code params} object, and the id. */
    @SuppressWarnings("unchecked")
    private JsonRpcMessage normalizeMessage(JsonRpcMessage msg) {
        Map<String, Object> params = msg.params();
        if (params != null) {
            Map<String, Object> mutable = new LinkedHashMap<>(params);
            mutable.remove("_meta");
            params = mutable.isEmpty() ? null : mutable;
        }
        return new JsonRpcMessage(msg.jsonrpc(), null, msg.method(), params, msg.result(), msg.error());
    }

    /** Tier 1/2: exact structural equality, independent of key order. */
    public boolean matchStructural(JsonRpcMessage incoming, JsonRpcMessage recorded) {
        if (!Objects.equals(incoming.method(), recorded.method())) {
            return false;
        }
        if (!toolNamesCompatible(incoming, recorded)) {
            return false;
        }

        JsonRpcMessage cleanIncoming = normalizeMessage(incoming);
        JsonRpcMessage cleanRecorded = normalizeMessage(recorded);

        return Canon.stableStringify(cleanIncoming).equals(Canon.stableStringify(cleanRecorded));
    }

    private Set<String> trigrams(String value) {
        String normalized = value.toLowerCase();
        if (normalized.length() < 3) {
            return Set.of(normalized);
        }

        Set<String> grams = new LinkedHashSet<>();
        for (int i = 0; i <= normalized.length() - 3; i++) {
            grams.add(normalized.substring(i, i + 3));
        }
        return grams;
    }

    /** Dice coefficient over character trigrams -- tolerant of typos, param reordering, minor
     *  phrasing drift. */
    public double trigramDice(String a, String b) {
        if (a.equals(b)) {
            return 1;
        }

        Set<String> gramsA = trigrams(a);
        Set<String> gramsB = trigrams(b);
        if (gramsA.isEmpty() || gramsB.isEmpty()) {
            return 0;
        }

        int intersection = 0;
        for (String gram : gramsA) {
            if (gramsB.contains(gram)) {
                intersection++;
            }
        }

        return (2.0 * intersection) / (gramsA.size() + gramsB.size());
    }

    private Set<String> tokenize(Object value) {
        String text;
        if (value == null) {
            text = "";
        } else if (value instanceof String s) {
            text = s;
        } else {
            text = Json.MAPPER.valueToTree(value).toString();
        }

        Matcher matcher = TOKEN_PATTERN.matcher(text.toLowerCase());
        Set<String> tokens = new LinkedHashSet<>();
        while (matcher.find()) {
            tokens.add(matcher.group());
        }
        return tokens;
    }

    /** Jaccard similarity: |intersection| / |union|, over word-token sets. */
    public double tokenJaccard(Object a, Object b) {
        Set<String> setA = tokenize(a);
        Set<String> setB = tokenize(b);
        if (setA.isEmpty() && setB.isEmpty()) {
            return 1;
        }

        int intersection = 0;
        for (String token : setA) {
            if (setB.contains(token)) {
                intersection++;
            }
        }

        int union = setA.size() + setB.size() - intersection;
        return union == 0 ? 1 : (double) intersection / union;
    }

    /** Relative numeric closeness, scaled so magnitude doesn't dominate (1 vs 2 and 1001 vs
     *  1002 differ). */
    public double numericCloseness(double a, double b) {
        if (a == b) {
            return 1;
        }
        double scale = Math.max(Math.max(Math.abs(a), Math.abs(b)), 1);
        return Math.max(0, 1 - Math.abs(a - b) / scale);
    }

    private double arraySimilarity(List<?> a, List<?> b, int depth) {
        if (a.isEmpty() && b.isEmpty()) {
            return 1;
        }
        int maxLength = Math.max(a.size(), b.size());

        double total = 0;
        for (int i = 0; i < maxLength; i++) {
            total += structuralSimilarity(i < a.size() ? a.get(i) : null, i < b.size() ? b.get(i) : null, depth + 1);
        }
        return total / maxLength;
    }

    private double objectSimilarity(Map<?, ?> a, Map<?, ?> b, int depth) {
        Set<Object> keys = new LinkedHashSet<>();
        keys.addAll(a.keySet());
        keys.addAll(b.keySet());
        if (keys.isEmpty()) {
            return 1;
        }

        double total = 0;
        for (Object key : keys) {
            total += structuralSimilarity(a.get(key), b.get(key), depth + 1);
        }
        return total / keys.size();
    }

    /**
     * Recursively compares two values shape-by-shape, weighting each leaf by type-appropriate
     * closeness (numeric distance, trigram Dice for strings, exact for booleans) and each
     * container by the fraction of its keys/indices that resolved well on the other side.
     * Missing keys and type mismatches are penalized, not ignored, so a recorded request with
     * extra required fields won't falsely satisfy a leaner incoming one.
     */
    private double structuralSimilarity(Object a, Object b, int depth) {
        if (depth > MAX_RECURSION_DEPTH) {
            return Objects.equals(a, b) ? 1 : 0;
        }
        if (a == null || b == null) {
            return a == null && b == null ? 1 : 0;
        }

        // Number comparison must come before a generic equals()/instanceof-Object fallback:
        // Integer(5).equals(Long.valueOf(5)) is false in Java even though JSON (and
        // JavaScript) has exactly one numeric type -- boxed-type mismatches between
        // Jackson-deserialized and hand-constructed values must not read as "different".
        if (a instanceof Number na && b instanceof Number nb) {
            return numericCloseness(na.doubleValue(), nb.doubleValue());
        }
        if (a instanceof String sa && b instanceof String sb) {
            return trigramDice(sa, sb);
        }
        if (a instanceof Boolean ba && b instanceof Boolean bb) {
            return ba.equals(bb) ? 1 : 0;
        }
        if (a instanceof List<?> la && b instanceof List<?> lb) {
            return arraySimilarity(la, lb, depth);
        }
        if (a instanceof Map<?, ?> ma && b instanceof Map<?, ?> mb) {
            return objectSimilarity(ma, mb, depth);
        }

        return 0; // type mismatch never contributes similarity
    }

    /** A string that looks like a path or URI (contains a separator) is an opaque identifier,
     *  not prose: two different paths are never "close enough" no matter how much of the
     *  string they share -- e.g. "/data/secrets.txt" and "/data/readme.txt" share a long
     *  literal prefix and would otherwise score deceptively high on generic string similarity. */
    private boolean looksLikePathOrUri(String value) {
        return value.contains("/") || value.contains("\\");
    }

    /**
     * Recursively walks two values in parallel looking for a pair of corresponding leaf
     * strings that are both path/URI-shaped and unequal. A hard gate ahead of the fuzzy
     * scoring below: fuzzy-matching an identifier would risk confidently returning one
     * resource's content (or performing one resource's mutation) for a request naming a
     * different one.
     */
    private boolean hasMismatchedPathOrUriLeaf(Object a, Object b, int depth) {
        if (depth > MAX_RECURSION_DEPTH) {
            return false;
        }

        if (a instanceof String sa && b instanceof String sb) {
            return !sa.equals(sb) && (looksLikePathOrUri(sa) || looksLikePathOrUri(sb));
        }

        if (a instanceof List<?> la && b instanceof List<?> lb) {
            int maxLength = Math.max(la.size(), lb.size());
            for (int i = 0; i < maxLength; i++) {
                if (hasMismatchedPathOrUriLeaf(i < la.size() ? la.get(i) : null, i < lb.size() ? lb.get(i) : null, depth + 1)) {
                    return true;
                }
            }
            return false;
        }

        if (a instanceof Map<?, ?> ma && b instanceof Map<?, ?> mb) {
            Set<Object> keys = new LinkedHashSet<>();
            keys.addAll(ma.keySet());
            keys.addAll(mb.keySet());
            for (Object key : keys) {
                if (hasMismatchedPathOrUriLeaf(ma.get(key), mb.get(key), depth + 1)) {
                    return true;
                }
            }
            return false;
        }

        return false;
    }

    /**
     * Tier 3: deterministic semantic similarity in {@code [0, 1]}. Combines structural shape,
     * token overlap, and character-level similarity of the request params. Requires zero
     * network access or model calls -- fully reproducible in CI.
     */
    public double calculateSimilarity(JsonRpcMessage incoming, JsonRpcMessage recorded) {
        if (!Objects.equals(incoming.method(), recorded.method())) {
            return 0;
        }
        if (!toolNamesCompatible(incoming, recorded)) {
            return 0;
        }
        if (matchStructural(incoming, recorded)) {
            return 1;
        }

        Map<String, Object> incomingParams = normalizeMessage(incoming).params();
        Map<String, Object> recordedParams = normalizeMessage(recorded).params();
        Map<String, Object> effectiveIncoming = incomingParams == null ? Map.of() : incomingParams;
        Map<String, Object> effectiveRecorded = recordedParams == null ? Map.of() : recordedParams;

        if (hasMismatchedPathOrUriLeaf(effectiveIncoming, effectiveRecorded, 0)) {
            return 0;
        }

        double structural = structuralSimilarity(effectiveIncoming, effectiveRecorded, 0);
        double tokens = tokenJaccard(effectiveIncoming, effectiveRecorded);
        double trigram = trigramDice(Json.MAPPER.valueToTree(effectiveIncoming).toString(), Json.MAPPER.valueToTree(effectiveRecorded).toString());

        double score = WEIGHT_STRUCTURAL * structural + WEIGHT_TOKEN_JACCARD * tokens + WEIGHT_TRIGRAM_DICE * trigram;
        return Math.max(0, Math.min(1, score));
    }

    private record ScoredCandidate<T>(T candidate, double score) {
    }

    /**
     * Generic best-match search shared by every replay path: ranks candidates by {@link
     * #calculateSimilarity}, accepts the top scorer at or above the threshold, and -- only
     * when a judge is configured and no candidate clears the threshold -- escalates the
     * highest-scoring candidates within {@link #JUDGE_BAND_WIDTH} below it for a sequential
     * tiebreak (never in parallel: the first "equivalent" verdict wins, and later candidates
     * are never even asked once one has answered).
     */
    public <T> CompletableFuture<Optional<T>> findSemanticMatch(JsonRpcMessage incoming, SemanticMatchOptions<T> options) {
        double threshold = options.getThreshold() != null ? options.getThreshold() : SemanticConfig.DEFAULT_THRESHOLD;

        T best = null;
        double bestScore = 0;
        List<ScoredCandidate<T>> uncertain = new ArrayList<>();

        for (T candidate : options.getCandidates()) {
            double score = calculateSimilarity(incoming, options.getMessageExtractor().apply(candidate));

            if (score >= threshold) {
                if (score > bestScore) {
                    bestScore = score;
                    best = candidate;
                }
            } else if (options.getJudge() != null && score >= threshold - JUDGE_BAND_WIDTH) {
                uncertain.add(new ScoredCandidate<>(candidate, score));
            }
        }

        if (best != null) {
            return CompletableFuture.completedFuture(Optional.of(best));
        }
        if (options.getJudge() == null || uncertain.isEmpty()) {
            return CompletableFuture.completedFuture(Optional.empty());
        }

        uncertain.sort((x, y) -> Double.compare(y.score(), x.score()));
        return judgeSequentially(incoming, options, uncertain.iterator());
    }

    private <T> CompletableFuture<Optional<T>> judgeSequentially(
            JsonRpcMessage incoming, SemanticMatchOptions<T> options, Iterator<ScoredCandidate<T>> remaining) {
        if (!remaining.hasNext()) {
            return CompletableFuture.completedFuture(Optional.empty());
        }

        T candidate = remaining.next().candidate();
        JsonRpcMessage recordedMsg = options.getMessageExtractor().apply(candidate);

        return options.getJudge().evaluate(incoming, recordedMsg).thenCompose(verdict -> {
            if (verdict.equivalent()) {
                return CompletableFuture.completedFuture(Optional.of(candidate));
            }
            return judgeSequentially(incoming, options, remaining);
        });
    }
}
