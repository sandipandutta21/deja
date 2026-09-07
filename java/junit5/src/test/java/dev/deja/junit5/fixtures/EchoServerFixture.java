package dev.deja.junit5.fixtures;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

/** A minimal fake MCP server for record-mode tests: reads one JSON-RPC request per stdin
 *  line, replies with {@code {jsonrpc:"2.0", id, result:{echoed: method}}}. Spawned as a real
 *  child JVM process. Duplicated from deja-core's own test fixture of the same name -- test
 *  sources aren't shared across modules without a testFixtures source set, and one small
 *  class isn't worth that extra build-config surface. */
public final class EchoServerFixture {

    private EchoServerFixture() {
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
