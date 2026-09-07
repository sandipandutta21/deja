package dev.deja.core.cassette;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** The transport a cassette's header records it as having been captured over. Provenance
 *  only: replay chooses its own transport independently (record over HTTP, replay over
 *  stdio, and vice versa are both supported). */
public enum TransportType {
    STDIO("stdio"),
    HTTP("http");

    private final String wireValue;

    TransportType(String wireValue) {
        this.wireValue = wireValue;
    }

    @JsonValue
    public String wireValue() {
        return wireValue;
    }

    @JsonCreator
    public static TransportType fromWireValue(String wireValue) {
        for (TransportType type : values()) {
            if (type.wireValue.equals(wireValue)) {
                return type;
            }
        }
        throw new IllegalArgumentException("Unknown transport type: " + wireValue);
    }
}
