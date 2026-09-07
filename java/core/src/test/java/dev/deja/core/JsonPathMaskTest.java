package dev.deja.core;

import dev.deja.core.json.JsonPathMask;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class JsonPathMaskTest {

    @SuppressWarnings("unchecked")
    private Map<String, Object> nestedMap(Object... keyValuePairs) {
        Map<String, Object> map = new LinkedHashMap<>();
        for (int i = 0; i < keyValuePairs.length; i += 2) {
            map.put((String) keyValuePairs[i], keyValuePairs[i + 1]);
        }
        return map;
    }

    @Test
    void masksASimpleDottedPath() {
        Map<String, Object> metadata = nestedMap("requestId", "abc-123", "other", "keep");
        Map<String, Object> result = nestedMap("metadata", metadata);
        Map<String, Object> obj = nestedMap("result", result);

        JsonPathMask.maskPath(obj, "$.result.metadata.requestId");

        assertThat(metadata.get("requestId")).isEqualTo(JsonPathMask.IGNORED_SENTINEL);
        assertThat(metadata.get("other")).isEqualTo("keep");
    }

    @Test
    void masksASpecificArrayIndex() {
        List<Object> items = new ArrayList<>(List.of("a", "b", "c"));
        Map<String, Object> obj = nestedMap("result", nestedMap("items", items));

        JsonPathMask.maskPath(obj, "$.result.items[1]");

        assertThat(items).containsExactly("a", JsonPathMask.IGNORED_SENTINEL, "c");
    }

    @Test
    void masksAFieldAcrossEveryArrayElementViaWildcard() {
        Map<String, Object> item1 = nestedMap("id", 1, "name", "x");
        Map<String, Object> item2 = nestedMap("id", 2, "name", "y");
        List<Object> items = new ArrayList<>(List.of(item1, item2));
        Map<String, Object> obj = nestedMap("result", nestedMap("items", items));

        JsonPathMask.maskPath(obj, "$.result.items[*].id");

        assertThat(item1.get("id")).isEqualTo(JsonPathMask.IGNORED_SENTINEL);
        assertThat(item2.get("id")).isEqualTo(JsonPathMask.IGNORED_SENTINEL);
        assertThat(item1.get("name")).isEqualTo("x");
        assertThat(item2.get("name")).isEqualTo("y");
    }

    @Test
    void isASilentNoOpForAPathThatDoesNotResolve() {
        Map<String, Object> metadata = nestedMap("requestId", "abc");
        Map<String, Object> obj = nestedMap("result", nestedMap("metadata", metadata));

        assertThat(catchThrowable(() -> JsonPathMask.maskPath(obj, "$.result.metadata.nonexistent.deep"))).isNull();
        assertThat(metadata.get("requestId")).isEqualTo("abc");
    }

    private Throwable catchThrowable(Runnable runnable) {
        try {
            runnable.run();
            return null;
        } catch (Throwable t) {
            return t;
        }
    }

    @Test
    void isANoOpWhenTheArrayIndexIsOutOfRange() {
        List<Object> items = new ArrayList<>(List.of("a"));
        Map<String, Object> obj = nestedMap("result", nestedMap("items", items));

        JsonPathMask.maskPath(obj, "$.result.items[5]");

        assertThat(items).containsExactly("a");
    }

    @Test
    void masksTheWholeValueWhenThePathHasASingleSegment() {
        Map<String, Object> obj = nestedMap("token", "secret");
        JsonPathMask.maskPath(obj, "$.token");
        assertThat(obj.get("token")).isEqualTo(JsonPathMask.IGNORED_SENTINEL);
    }
}
