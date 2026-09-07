package dev.deja.core.cassette;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * A JSON-RPC 2.0 error object.
 *
 * @param code    the error type that occurred
 * @param message a short, human-readable description of the error
 * @param data    additional error information; may be {@code null}
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonIgnoreProperties(ignoreUnknown = true)
public record JsonRpcError(
        @JsonProperty("code") int code,
        @JsonProperty("message") String message,
        @JsonProperty("data") Object data) {

    public JsonRpcError(int code, String message) {
        this(code, message, null);
    }
}
