package dev.deja.core.cassette;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;
import com.fasterxml.jackson.databind.JsonMappingException;
import com.fasterxml.jackson.databind.JsonNode;
import dev.deja.core.json.Json;

import java.io.IOException;

/** Reads the {@code type} discriminator and dispatches to the concrete {@link CassetteLine}
 *  implementation directly, bypassing Jackson's records-incompatible {@code EXISTING_PROPERTY}
 *  polymorphism (see {@link CassetteLine}'s Javadoc).
 *
 *  <p>Public only because {@code dev.deja.core.json.Json} (a different package -- the shared
 *  {@code ObjectMapper} lives there, deliberately separate from the cassette model) needs to
 *  register an instance of this with a {@code SimpleModule}; Java has no visibility tier
 *  between "this package" and "everyone". Not part of deja-core's public API in spirit -- there
 *  is no reason to construct this directly. */
public final class CassetteLineDeserializer extends JsonDeserializer<CassetteLine> {

    @Override
    public CassetteLine deserialize(JsonParser p, DeserializationContext ctxt) throws IOException {
        JsonNode node = ctxt.readTree(p);
        String type = node.path("type").asText(null);

        if ("header".equals(type)) {
            return Json.MAPPER.treeToValue(node, CassetteHeader.class);
        }
        if ("frame".equals(type)) {
            return Json.MAPPER.treeToValue(node, CassetteFrame.class);
        }

        throw new JsonMappingException(p, "Unknown cassette line type: " + type);
    }
}
