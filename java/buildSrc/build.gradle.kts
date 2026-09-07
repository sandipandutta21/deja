plugins {
    `kotlin-dsl`
}

repositories {
    gradlePluginPortal()
    mavenCentral()
}

dependencies {
    // Applied (with a version) inside the precompiled convention plugin below, so it needs to
    // be resolvable on buildSrc's own classpath -- talks to the Central Portal Publisher API
    // directly, unlike the older Nexus-staging-plugin approach that only understands the
    // legacy OSSRH host.
    implementation("com.vanniktech:gradle-maven-publish-plugin:0.35.0")
}

// Otherwise buildSrc's own Kotlin compilation silently targets whatever JDK launched Gradle
// (23 here), while kotlin-dsl's embedded Kotlin compiler caps out lower -- a harmless but
// noisy mismatch warning on every build.
kotlin {
    jvmToolchain(21)
}
