package dev.deja.core.json;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.experimental.UtilityClass;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** Order-independent JSON canonicalization -- used everywhere structural equality matters
 *  (matching, verify, diff). Mirrors the TypeScript implementation's {@code canon.ts}. */
@UtilityClass
public class Canon {

    /** Recursively sorts object keys, alphabetically, so structurally-identical payloads
     *  compare equal regardless of key order. Array order and all leaf values are untouched. */
    public JsonNode sortKeysDeep(JsonNode node) {
        if (node.isObject()) {
            List<String> fieldNames = new ArrayList<>();
            node.fieldNames().forEachRemaining(fieldNames::add);
            Collections.sort(fieldNames);

            ObjectNode sorted = Json.MAPPER.createObjectNode();
            for (String name : fieldNames) {
                sorted.set(name, sortKeysDeep(node.get(name)));
            }
            return sorted;
        }

        if (node.isArray()) {
            ArrayNode sorted = Json.MAPPER.createArrayNode();
            for (JsonNode element : node) {
                sorted.add(sortKeysDeep(element));
            }
            return sorted;
        }

        return node;
    }

    /** Order-independent JSON serialization of an arbitrary value. */
    public String stableStringify(Object value) {
        JsonNode tree = Json.MAPPER.valueToTree(value);
        return sortKeysDeep(tree).toString();
    }
}
