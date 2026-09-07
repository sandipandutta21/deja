plugins {
    id("dev.deja.java-conventions")
}

description = "Cassette format, redaction, matching, and replay engine -- zero-I/O, transport-agnostic. Jackson is the sole runtime dependency."

dependencies {
    // Internal only (not `api`): deja-core's public surface is its own domain types
    // (JsonRpcMessage, CassetteFrame, ...), never raw Jackson types -- consumers get Jackson
    // on their runtime classpath transitively without being able to compile-time couple to it.
    implementation("com.fasterxml.jackson.core:jackson-databind:2.22.2")
}
