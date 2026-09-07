package dev.deja.core.cassette;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** Which side of the wire a {@link CassetteFrame} was captured travelling. */
public enum Direction {
    /** Client to server. */
    C2S("c2s"),
    /** Server to client. */
    S2C("s2c");

    private final String wireValue;

    Direction(String wireValue) {
        this.wireValue = wireValue;
    }

    /** The lowercase form written to the cassette JSONL file -- matches the TypeScript
     *  implementation's serialization exactly, so cassettes are byte-compatible across languages. */
    @JsonValue
    public String wireValue() {
        return wireValue;
    }

    @JsonCreator
    public static Direction fromWireValue(String wireValue) {
        for (Direction direction : values()) {
            if (direction.wireValue.equals(wireValue)) {
                return direction;
            }
        }
        throw new IllegalArgumentException("Unknown direction: " + wireValue);
    }
}
