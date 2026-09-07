package dev.deja.junit5;

import dev.deja.core.cassette.CassetteReader;
import dev.deja.core.cassette.JsonRpcMessage;
import dev.deja.core.recorder.ProcessRecorder;
import dev.deja.core.replay.ReplayEngine;
import org.junit.jupiter.api.extension.AfterAllCallback;
import org.junit.jupiter.api.extension.AfterEachCallback;
import org.junit.jupiter.api.extension.BeforeAllCallback;
import org.junit.jupiter.api.extension.BeforeEachCallback;
import org.junit.jupiter.api.extension.ExtensionContext;
import org.junit.jupiter.api.extension.ParameterContext;
import org.junit.jupiter.api.extension.ParameterResolutionException;
import org.junit.jupiter.api.extension.ParameterResolver;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Backs {@link Cassette}: loads the cassette (or spawns the record-mode server) once per test
 * class in {@link #beforeAll}, injects a fresh {@link McpSession} per test method, and fails
 * a test whose replayed requests included an unmatched one -- isolated per method, so one
 * test's miss is reported against that test alone, not the whole class.
 */
public final class CassetteExtension implements
        BeforeAllCallback, AfterAllCallback, BeforeEachCallback, AfterEachCallback, ParameterResolver {

    private static final ExtensionContext.Namespace NAMESPACE = ExtensionContext.Namespace.create(CassetteExtension.class);
    private static final String ENGINE_KEY = "engine";
    private static final String RECORDER_KEY = "recorder";
    private static final String MISSED_KEY = "missed";
    private static final String NO_MATCH_MESSAGE_PREFIX = "Deja: No matching";

    private static final Pattern PLACEHOLDER = Pattern.compile("\\$\\{(env|sys):([^}]+)}");

    @Override
    public void beforeAll(ExtensionContext context) {
        Cassette annotation = context.getRequiredTestClass().getAnnotation(Cassette.class);
        if (annotation == null) {
            throw new IllegalStateException("@Cassette is required on " + context.getRequiredTestClass());
        }

        ExtensionContext.Store store = context.getStore(NAMESPACE);

        if (isRecordMode()) {
            if (annotation.record().length == 0) {
                throw new IllegalStateException(
                        "DEJA_MODE=record requires @Cassette(record = {...}) on " + context.getRequiredTestClass());
            }
            List<String> command = interpolate(annotation.record());
            store.put(RECORDER_KEY, new ProcessRecorder(command, Path.of(annotation.value()), !annotation.noRedact()));
        } else {
            var contents = new CassetteReader(Path.of(annotation.value())).loadAll();
            store.put(ENGINE_KEY, new ReplayEngine(contents.frames(), annotation.semantic(), null));
        }
    }

    @Override
    public void afterAll(ExtensionContext context) {
        ProcessRecorder recorder = context.getStore(NAMESPACE).get(RECORDER_KEY, ProcessRecorder.class);
        if (recorder != null) {
            recorder.close();
        }
    }

    @Override
    public void beforeEach(ExtensionContext context) {
        context.getStore(NAMESPACE).put(MISSED_KEY, new CopyOnWriteArrayList<JsonRpcMessage>());
    }

    @Override
    public void afterEach(ExtensionContext context) {
        @SuppressWarnings("unchecked")
        List<JsonRpcMessage> missed = context.getStore(NAMESPACE).get(MISSED_KEY, List.class);
        if (missed != null && !missed.isEmpty()) {
            throw new AssertionError(
                    "Deja: " + missed.size() + " unmatched request(s) during offline replay. "
                            + "Ensure your agent's requests match the cassette structurally, or enable semantic matching (@Cassette(semantic = true)). "
                            + "Missed: " + missed);
        }
    }

    @Override
    public boolean supportsParameter(ParameterContext parameterContext, ExtensionContext extensionContext) throws ParameterResolutionException {
        return parameterContext.getParameter().getType() == McpSession.class;
    }

    @Override
    public Object resolveParameter(ParameterContext parameterContext, ExtensionContext extensionContext) throws ParameterResolutionException {
        return buildSession(extensionContext);
    }

    private McpSession buildSession(ExtensionContext context) {
        ExtensionContext.Store store = context.getStore(NAMESPACE);
        ProcessRecorder recorder = store.get(RECORDER_KEY, ProcessRecorder.class);

        if (recorder != null) {
            MessageResolver resolver = incoming -> {
                if (incoming.isNotification()) {
                    return CompletableFuture.completedFuture(Optional.empty());
                }
                return CompletableFuture.supplyAsync(() ->
                        Optional.of(recorder.send(incoming.method(), incoming.params()).withId(incoming.id())));
            };
            return new DejaSession(resolver);
        }

        ReplayEngine engine = store.get(ENGINE_KEY, ReplayEngine.class);
        @SuppressWarnings("unchecked")
        List<JsonRpcMessage> missed = store.get(MISSED_KEY, List.class);

        MessageResolver resolver = incoming -> engine.resolve(incoming).thenApply(maybeResponse -> {
            if (maybeResponse.isPresent() && isNoMatchError(maybeResponse.get())) {
                missed.add(incoming);
            }
            return maybeResponse;
        });
        return new DejaSession(resolver);
    }

    private boolean isNoMatchError(JsonRpcMessage msg) {
        return msg.error() != null
                && msg.error().code() == -32603
                && msg.error().message() != null
                && msg.error().message().startsWith(NO_MATCH_MESSAGE_PREFIX);
    }

    private boolean isRecordMode() {
        String mode = System.getenv("DEJA_MODE");
        if (mode == null) {
            mode = System.getProperty("DEJA_MODE");
        }
        return "record".equals(mode);
    }

    /** Resolves {@code ${env:VAR}}/{@code ${sys:property}} placeholders in a record-mode command. */
    private List<String> interpolate(String[] command) {
        List<String> result = new ArrayList<>(command.length);
        for (String arg : command) {
            Matcher matcher = PLACEHOLDER.matcher(arg);
            StringBuilder sb = new StringBuilder();
            int lastEnd = 0;
            while (matcher.find()) {
                sb.append(arg, lastEnd, matcher.start());
                String kind = matcher.group(1);
                String name = matcher.group(2);
                String value = "env".equals(kind) ? System.getenv(name) : System.getProperty(name);
                if (value == null) {
                    throw new IllegalStateException("Deja: ${" + kind + ":" + name + "} referenced in @Cassette(record = ...) is not set");
                }
                sb.append(value);
                lastEnd = matcher.end();
            }
            sb.append(arg, lastEnd, arg.length());
            result.add(sb.toString());
        }
        return result;
    }
}
