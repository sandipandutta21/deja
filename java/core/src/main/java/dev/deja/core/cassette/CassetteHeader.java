package dev.deja.core.cassette;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * The single leading line of every cassette file: recording provenance. Never consulted by
 * replay to pick a transport -- {@code record}'s {@code --target} and {@code replay}'s
 * {@code --port} are independent choices, which is what makes cross-transport replay possible.
 *
 * @param version        the cassette format version; currently always {@value #CURRENT_VERSION}
 * @param recordedAt     an ISO-8601 timestamp
 * @param transport      the transport this session was recorded over
 * @param serverCommand  the (redacted, unless {@code --no-redact}) spawned command, for stdio recordings
 * @param target         the origin-only target URL, for HTTP recordings
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonIgnoreProperties(ignoreUnknown = true)
public record CassetteHeader(
        @JsonProperty("type") String type,
        @JsonProperty("version") int version,
        @JsonProperty("recorded_at") String recordedAt,
        @JsonProperty("transport") TransportType transport,
        @JsonProperty("server_command") List<String> serverCommand,
        @JsonProperty("target") String target) implements CassetteLine {

    public static final int CURRENT_VERSION = 1;

    public CassetteHeader {
        if (!"header".equals(type)) {
            throw new IllegalArgumentException("CassetteHeader.type must be \"header\", was: " + type);
        }
    }

    /** Stamps {@code type="header"} and the current format version automatically. */
    public static CassetteHeader of(String recordedAt, TransportType transport, List<String> serverCommand, String target) {
        return new CassetteHeader("header", CURRENT_VERSION, recordedAt, transport, serverCommand, target);
    }
}
