package dev.deja.core.cassette;

/**
 * One line of a cassette JSONL file: either the single leading {@link CassetteHeader} or one
 * of the many {@link CassetteFrame} lines that follow it. Mirrors the TypeScript
 * implementation's {@code CassetteHeader | CassetteFrame} discriminated union -- the {@code
 * type} field is the discriminator on both sides.
 *
 * <p>Dispatched by {@link CassetteLineDeserializer}, registered against this exact interface
 * type in {@code Json}'s (the sibling {@code json} package's shared mapper) module setup --
 * deliberately *not* via a {@code @JsonDeserialize} annotation here. Jackson's annotation
 * introspection turned out to inherit that annotation
 * down to {@link CassetteHeader}/{@link CassetteFrame} themselves (they implement this
 * interface), which sent {@code treeToValue(node, CassetteHeader.class)} straight back into
 * the same dispatcher -- infinite recursion. A module-registered deserializer is looked up by
 * exact type only, with no such inheritance.
 *
 * <p>Jackson's own {@code @JsonTypeInfo}/{@code @JsonSubTypes} polymorphism was avoided
 * entirely for the same underlying reason in a different guise: its {@code EXISTING_PROPERTY}
 * discriminator strategy has a known incompatibility with records (the discriminator field
 * arrives as {@code null} at the canonical constructor instead of its actual value).
 */
public sealed interface CassetteLine permits CassetteHeader, CassetteFrame {
    String type();
}
