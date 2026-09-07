package dev.deja.core;

import dev.deja.core.json.Canon;
import dev.deja.core.json.Json;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class CanonTest {

    @Test
    void sortsTopLevelKeysAlphabetically() {
        Map<String, Object> input = new LinkedHashMap<>();
        input.put("b", 1);
        input.put("a", 2);
        input.put("c", 3);

        JsonNode sorted = Canon.sortKeysDeep(Json.MAPPER.valueToTree(input));
        assertThat(sorted.toString()).isEqualTo("{\"a\":2,\"b\":1,\"c\":3}");
    }

    @Test
    void sortsNestedObjectKeysRecursively() {
        Map<String, Object> nested = new LinkedHashMap<>();
        nested.put("d", 1);
        nested.put("b", 2);
        Map<String, Object> input = new LinkedHashMap<>();
        input.put("z", nested);
        input.put("a", 1);

        JsonNode sorted = Canon.sortKeysDeep(Json.MAPPER.valueToTree(input));
        assertThat(sorted.toString()).isEqualTo("{\"a\":1,\"z\":{\"b\":2,\"d\":1}}");
    }

    @Test
    void preservesArrayOrderWhileSortingEachElementsKeys() {
        List<Map<String, Object>> input = List.of(
                Map.of("b", 1, "a", 2),
                Map.of("d", 3, "c", 4));

        JsonNode sorted = Canon.sortKeysDeep(Json.MAPPER.valueToTree(input));
        assertThat(sorted.toString()).isEqualTo("[{\"a\":2,\"b\":1},{\"c\":4,\"d\":3}]");
    }

    @Test
    void stableStringifyProducesIdenticalOutputRegardlessOfKeyOrder() {
        Map<String, Object> argsA = new LinkedHashMap<>();
        argsA.put("x", 1);
        argsA.put("y", 2);
        Map<String, Object> a = new LinkedHashMap<>();
        a.put("name", "test");
        a.put("args", argsA);

        Map<String, Object> argsB = new LinkedHashMap<>();
        argsB.put("y", 2);
        argsB.put("x", 1);
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("args", argsB);
        b.put("name", "test");

        assertThat(Canon.stableStringify(a)).isEqualTo(Canon.stableStringify(b));
    }

    @Test
    void stableStringifyStillDistinguishesDifferentValues() {
        Map<String, Object> a = Map.of("name", "test", "args", Map.of("x", 1));
        Map<String, Object> b = Map.of("name", "test", "args", Map.of("x", 2));

        assertThat(Canon.stableStringify(a)).isNotEqualTo(Canon.stableStringify(b));
    }
}
