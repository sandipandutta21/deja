package dev.deja.core.cassette;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;

/**
 * A JSON-RPC 2.0 message in the flattened shape deja's cassette format uses: requests,
 * notifications, and responses all fit this one record, distinguished by which of
 * {@code method}/{@code id}/{@code result}/{@code error} are present. This mirrors the
 * TypeScript implementation's {@code JsonRpcMessage} interface exactly, field for field, so
 * a cassette written by one language is structurally identical when read by the other.
 *
 * @param jsonrpc always {@code "2.0"}
 * @param id      present on requests and responses; absent (null) on notifications
 * @param method  present on requests and notifications
 * @param params  present on requests and notifications that take arguments
 * @param result  present on a successful response
 * @param error   present on a failed response
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonIgnoreProperties(ignoreUnknown = true)
public record JsonRpcMessage(
        @JsonProperty("jsonrpc") String jsonrpc,
        @JsonProperty("id") Object id,
        @JsonProperty("method") String method,
        @JsonProperty("params") Map<String, Object> params,
        @JsonProperty("result") Object result,
        @JsonProperty("error") JsonRpcError error) {

    private static final String VERSION = "2.0";

    /** True for a notification: a method call with no {@code id}. JSON-RPC guarantees a
     *  notification never receives a response, and replay relies on that -- see {@code
     *  ReplayEngine.resolve} in the sibling {@code replay} package.
     *
     *  <p>{@code @JsonIgnore} matters here: this method's name matches the {@code isXxx()}
     *  JavaBean getter convention Jackson auto-detects, so without it Jackson would silently
     *  serialize a bonus {@code "notification"} field into every message -- and then refuse
     *  to deserialize that same field back on the next round trip. */
    @JsonIgnore
    public boolean isNotification() {
        return id == null;
    }

    /** Returns a copy with {@code id} replaced -- how replay rewrites a recorded response's
     *  id to match the id an incoming request actually carried. */
    public JsonRpcMessage withId(Object newId) {
        return new JsonRpcMessage(jsonrpc, newId, method, params, result, error);
    }

    public static JsonRpcMessage request(Object id, String method, Map<String, Object> params) {
        return new JsonRpcMessage(VERSION, id, method, params, null, null);
    }

    public static JsonRpcMessage notification(String method, Map<String, Object> params) {
        return new JsonRpcMessage(VERSION, null, method, params, null, null);
    }

    public static JsonRpcMessage result(Object id, Object result) {
        return new JsonRpcMessage(VERSION, id, null, null, result, null);
    }

    public static JsonRpcMessage error(Object id, JsonRpcError error) {
        return new JsonRpcMessage(VERSION, id, null, null, null, error);
    }
}
