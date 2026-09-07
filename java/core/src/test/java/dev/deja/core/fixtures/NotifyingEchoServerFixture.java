package dev.deja.core.fixtures;

import com.fasterxml.jackson.databind.ObjectMapper;

import dev.deja.core.recorder.ProcessRecorder;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

/** A fake MCP server that -- like the real MCP reference "Everything" server -- pushes an
 *  unsolicited notification before answering each request. Exists specifically to prove
 *  {@link ProcessRecorder} correctly demuxes by id instead of assuming the very
 *  next line on the wire is always the answer. */
public final class NotifyingEchoServerFixture {

    private NotifyingEchoServerFixture() {
    }

    public static void main(String[] args) throws IOException {
        ObjectMapper mapper = new ObjectMapper();
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));

        String line;
        while ((line = in.readLine()) != null) {
            if (line.isBlank()) {
                continue;
            }
            Map<?, ?> request = mapper.readValue(line, Map.class);
            Object id = request.get("id");
            String method = (String) request.get("method");

            Map<String, Object> notification = new LinkedHashMap<>();
            notification.put("jsonrpc", "2.0");
            notification.put("method", "notifications/unsolicited");
            System.out.println(mapper.writeValueAsString(notification));

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("echoed", method);

            Map<String, Object> response = new LinkedHashMap<>();
            response.put("jsonrpc", "2.0");
            response.put("id", id);
            response.put("result", result);

            System.out.println(mapper.writeValueAsString(response));
            System.out.flush();
        }
    }
}
