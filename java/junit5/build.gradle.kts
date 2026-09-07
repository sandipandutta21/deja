plugins {
    id("dev.deja.java-conventions")
}

description = "JUnit 5 @Cassette extension and DejaMcpTransport -- lets the official MCP Java SDK's McpClient run unmodified against a cassette."

val junitBomVersion = "5.14.4"
val mcpSdkVersion = "2.0.1"

dependencies {
    api(project(":deja-core"))

    // `api`, not `implementation`: this module's main source set directly implements JUnit
    // Jupiter extension interfaces and the MCP SDK's transport interface, so both leak into
    // deja-junit5's own public API surface -- consumers need them on their compile classpath.
    api(platform("org.junit:junit-bom:$junitBomVersion"))
    api("org.junit.jupiter:junit-jupiter-api")
    api("io.modelcontextprotocol.sdk:mcp:$mcpSdkVersion")

    // Pinned explicitly (not left to transitive resolution) since DejaMcpTransport uses
    // Mono/Flux/Sinks directly -- the exact version the MCP SDK 2.0.1 itself compiles against.
    api("io.projectreactor:reactor-core:3.7.0")

    // For testing the extension itself: runs a fixture test class through JUnit's own
    // launcher and asserts on the resulting execution events, rather than JUnit invoking our
    // extension for real (there's no test-of-a-test-runner shortcut otherwise).
    testImplementation("org.junit.platform:junit-platform-testkit")

    // deja-core deliberately keeps Jackson `implementation`-scoped (an internal detail, not
    // part of its public API), so it isn't visible here transitively. Test-only: production
    // code in this module never touches Jackson directly, only the small fake MCP servers
    // test fixtures spawn as real subprocesses need it, to hand-roll JSON-RPC responses.
    testImplementation("com.fasterxml.jackson.core:jackson-databind:2.22.2")
}

tasks.test {
    // "*Subject" classes are fixtures meant to be driven only through junit-platform-testkit's
    // EngineTestKit (to inspect *how* they fail/pass), not run directly. A static nested class
    // with @Test methods is its own standalone Jupiter test class regardless of @Nested, so
    // without this exclusion Gradle's own discovery runs it too -- including the ones designed
    // to fail on purpose, which would otherwise fail this very test task.
    exclude("**/*Subject.class")
}
