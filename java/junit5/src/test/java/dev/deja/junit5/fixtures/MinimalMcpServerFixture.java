package dev.deja.junit5.fixtures;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** A minimal, schema-valid MCP server: handles {@code initialize} and {@code tools/list}
 *  well enough for the real MCP Java SDK client to complete both without error. Used both to
 *  generate the static replay fixture cassette and (in record mode) as the live server the
 *  record-mode test spawns for real. */
public final class MinimalMcpServerFixture {

    private MinimalMcpServerFixture() {
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
            if (id == null) {
                continue; // a notification -- no response
            }

            Map<String, Object> result = switch (method) {
                case "initialize" -> initializeResult();
                case "tools/list" -> Map.of("tools", List.of());
                default -> Map.of();
            };

            Map<String, Object> response = new LinkedHashMap<>();
            response.put("jsonrpc", "2.0");
            response.put("id", id);
            response.put("result", result);

            System.out.println(mapper.writeValueAsString(response));
            System.out.flush();
        }
    }

    private static Map<String, Object> initializeResult() {
        Map<String, Object> serverInfo = new LinkedHashMap<>();
        serverInfo.put("name", "deja-fixture-server");
        serverInfo.put("version", "1.0.0");

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("protocolVersion", "2025-06-18");
        result.put("capabilities", Map.of("tools", Map.of()));
        result.put("serverInfo", serverInfo);
        return result;
    }
}
