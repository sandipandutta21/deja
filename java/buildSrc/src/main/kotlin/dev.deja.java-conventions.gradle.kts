/**
 * Shared configuration for every deja module: Java toolchain, compiler flags, and the JUnit 5
 * test setup every module needs for its own tests. Kept as a buildSrc convention plugin rather
 * than a `subprojects {}` block in the root build script -- the latter is Gradle's own
 * discouraged legacy pattern and has real evaluation-order pitfalls in multi-module builds.
 */
import com.vanniktech.maven.publish.JavaLibrary
import com.vanniktech.maven.publish.JavadocJar

plugins {
    `java-library`
    id("com.vanniktech.maven.publish")
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(17))
    }
    // Sources/javadoc jars are configured below via the publish plugin's own JavaLibrary
    // preset instead of java.withSourcesJar()/withJavadocJar() -- the preset registers those
    // same tasks itself, and doing both would collide.
}

// Shared Maven Central publishing setup for every publishable module (deja-core, deja-junit5).
// Real credentials never live here: mavenCentralUsername/Password and the signing key come
// from ORG_GRADLE_PROJECT_-prefixed environment variables in CI (see
// .github/workflows/publish-java.yml), or from ~/.gradle/gradle.properties for a manual local
// publish -- never from a file inside this repo.
mavenPublishing {
    configure(
        JavaLibrary(
            javadocJar = JavadocJar.Javadoc(),
            sourcesJar = true,
        )
    )

    // automaticRelease = true: a successful upload also releases to Central immediately, with
    // no manual "publish" click needed in the Central Portal UI -- required for this to run
    // unattended from a tag-push workflow.
    publishToMavenCentral(automaticRelease = true)
    signAllPublications()

    pom {
        name.set(project.name)
        // Lazy: project.description is set by each module's own build.gradle.kts *after* it
        // applies this convention plugin, so reading it eagerly here would always see null.
        description.set(project.provider { project.description })
        url.set("https://github.com/sandipandutta21/deja-mcp")
        inceptionYear.set("2026")

        licenses {
            license {
                name.set("MIT License")
                url.set("https://github.com/sandipandutta21/deja-mcp/blob/main/LICENSE")
                distribution.set("repo")
            }
        }

        developers {
            developer {
                id.set("sandipandutta21")
                name.set("sandipandutta21")
                url.set("https://github.com/sandipandutta21")
            }
        }

        scm {
            url.set("https://github.com/sandipandutta21/deja-mcp")
            connection.set("scm:git:git://github.com/sandipandutta21/deja-mcp.git")
            developerConnection.set("scm:git:ssh://git@github.com/sandipandutta21/deja-mcp.git")
        }
    }
}

repositories {
    mavenCentral()
}

// JUnit 5 (Jupiter), not the newer JUnit 6 line: this is a library other people's projects
// will depend on, and targeting the version the broadest set of consumers can already adopt
// matters more here than being on the newest major release.
val junitBomVersion = "5.14.4"
val lombokVersion = "1.18.48"

dependencies {
    "compileOnly"("org.projectlombok:lombok:$lombokVersion")
    "annotationProcessor"("org.projectlombok:lombok:$lombokVersion")
    "testCompileOnly"("org.projectlombok:lombok:$lombokVersion")
    "testAnnotationProcessor"("org.projectlombok:lombok:$lombokVersion")

    "testImplementation"(platform("org.junit:junit-bom:$junitBomVersion"))
    "testImplementation"("org.junit.jupiter:junit-jupiter")
    "testImplementation"("org.assertj:assertj-core:3.27.7")
    "testRuntimeOnly"("org.junit.platform:junit-platform-launcher")
}

tasks.withType<Test>().configureEach {
    useJUnitPlatform()
    maxParallelForks = (Runtime.getRuntime().availableProcessors() / 2).coerceAtLeast(1)
    testLogging {
        events("passed", "skipped", "failed")
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
    }
}

tasks.withType<JavaCompile>().configureEach {
    options.encoding = "UTF-8"
    // "-processing" excluded: it warns that Jackson's annotations went "unclaimed" by any
    // annotation processor the moment Lombok (an active processor) is also on the classpath --
    // Jackson reads its annotations via reflection at runtime, not annotation processing, so
    // this is always a false positive, never a real omission.
    options.compilerArgs.addAll(listOf("-Xlint:all,-processing", "-Werror"))
}
