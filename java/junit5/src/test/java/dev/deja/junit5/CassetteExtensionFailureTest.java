package dev.deja.junit5;

import org.junit.jupiter.api.Test;
import org.junit.platform.testkit.engine.EngineTestKit;

import static org.junit.platform.engine.discovery.DiscoverySelectors.selectClass;
import static org.junit.platform.testkit.engine.EventConditions.event;
import static org.junit.platform.testkit.engine.EventConditions.finishedSuccessfully;
import static org.junit.platform.testkit.engine.EventConditions.finishedWithFailure;
import static org.junit.platform.testkit.engine.EventConditions.test;
import static org.junit.platform.testkit.engine.TestExecutionResultConditions.instanceOf;
import static org.junit.platform.testkit.engine.TestExecutionResultConditions.message;

/**
 * Drives {@link ReplaySubject} through JUnit's real launcher (via {@code
 * junit-platform-testkit}) and inspects the resulting execution events -- the only way to
 * verify "does this extension actually fail the test it's attached to" for real, rather than
 * calling extension callback methods directly and hoping that matches what JUnit would do.
 *
 * <p>{@link ReplaySubject} is deliberately named without a "Test" suffix so Gradle's own test
 * discovery doesn't also try to run it directly as a top-level test class.
 */
class CassetteExtensionFailureTest {

    @Cassette(value = "src/test/resources/fixtures/session.jsonl")
    static class ReplaySubject {

        @Test
        void matchingRequestPasses(McpSession session) {
            session.request("tools/list", null);
        }

        @Test
        void unmatchedRequestFails(McpSession session) {
            session.request("totally/unknown/method", null);
        }
    }

    @Test
    void oneUnmatchedRequestFailsOnlyThatTestNotTheWholeClass() {
        EngineTestKit.engine("junit-jupiter")
                .selectors(selectClass(ReplaySubject.class))
                .execute()
                .testEvents()
                .assertThatEvents()
                .haveExactly(1, event(test("matchingRequestPasses"), finishedSuccessfully()))
                .haveExactly(1, event(
                        test("unmatchedRequestFails"),
                        finishedWithFailure(instanceOf(McpSessionException.class), message(m -> m.contains("-32603")))));
    }
}
