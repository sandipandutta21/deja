package dev.deja.core.json;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.module.SimpleModule;
import dev.deja.core.cassette.CassetteLine;
import dev.deja.core.cassette.CassetteLineDeserializer;
import lombok.experimental.UtilityClass;

/**
 * The single shared Jackson {@link ObjectMapper} for the whole module. Jackson is deja-core's
 * only runtime dependency; one correctly-configured, thread-safe mapper instance is reused
 * everywhere rather than every class constructing its own.
 */
@UtilityClass
public class Json {
    public final ObjectMapper MAPPER = new ObjectMapper()
            .registerModule(new SimpleModule().addDeserializer(CassetteLine.class, new CassetteLineDeserializer()));
}
