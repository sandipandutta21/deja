package dev.deja.core.cassette;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * One captured message, in one direction, at one offset into the recording.
 *
 * @param dir  which side of the wire this message travelled
 * @param tMs  milliseconds since recording started
 * @param msg  the JSON-RPC message itself (already redacted, unless recorded with {@code --no-redact})
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonIgnoreProperties(ignoreUnknown = true)
public record CassetteFrame(
        @JsonProperty("type") String type,
        @JsonProperty("dir") Direction dir,
        @JsonProperty("t_ms") long tMs,
        @JsonProperty("msg") JsonRpcMessage msg) implements CassetteLine {

    public CassetteFrame {
        if (!"frame".equals(type)) {
            throw new IllegalArgumentException("CassetteFrame.type must be \"frame\", was: " + type);
        }
    }

    /** Stamps {@code type="frame"} automatically. */
    public static CassetteFrame of(Direction dir, long tMs, JsonRpcMessage msg) {
        return new CassetteFrame("frame", dir, tMs, msg);
    }

    /** Returns a copy carrying a different message -- used when rewriting a frame in place
     *  (e.g. re-redacting a legacy cassette) without disturbing its direction or timing. */
    public CassetteFrame withMsg(JsonRpcMessage newMsg) {
        return new CassetteFrame(type, dir, tMs, newMsg);
    }
}
