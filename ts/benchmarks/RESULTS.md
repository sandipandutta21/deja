# Deja Matching Benchmark — Results

Hand-labeled corpus of 76 JSON-RPC (recorded, incoming) pairs — 35 that should replay (`MATCH`) and 41 that must not (`REJECT`) — scored against three matchers. Regenerate with `npm run benchmark` from `ts/`. See `benchmarks/corpus.mjs` for every case and its rationale.

## Summary

| Matcher | Precision | Recall | False-positive rate | Avg. latency/call |
|---|---:|---:|---:|---:|
| Exact (naive JSON equality) | 100.0% | 11.4% | 0.0% | 1.54 µs |
| Structural only (deja tier 1/2) | 100.0% | 37.1% | 0.0% | 7.97 µs |
| Deja full pipeline (tier 1/2/3 + hard gates) | 85.4% | 100.0% | 14.6% | 17.10 µs |

**Precision** = correct matches ÷ all matches made. **Recall** = correct matches ÷ cases that should have matched. **False-positive rate** = incorrect matches ÷ cases that should have been rejected — the number that matters most here: a wrong match means replaying the wrong tool's result, or (worse) nothing stopped a mutating call with the wrong arguments from looking "already handled."

## By category

| Category | Cases | Exact (naive JSON equality) | Structural only (deja tier 1/2) | Deja full pipeline (tier 1/2/3 + hard gates) |
|---|---:|---|---|---|
| identical | 4 | 4/4 correct | 4/4 correct | 4/4 correct |
| key_order | 6 | 0/6 correct | 6/6 correct | 6/6 correct |
| meta_param | 3 | 0/3 correct | 1/3 correct | 3/3 correct |
| empty_vs_missing_params | 3 | 0/3 correct | 2/3 correct | 3/3 correct |
| whitespace_prose | 5 | 0/5 correct | 0/5 correct | 5/5 correct |
| case_variation_prose | 4 | 0/4 correct | 0/4 correct | 4/4 correct |
| typo_prose | 5 | 0/5 correct | 0/5 correct | 5/5 correct |
| optional_param_added | 5 | 0/5 correct | 0/5 correct | 5/5 correct |
| tool_name_mismatch | 8 | 8/8 correct | 8/8 correct | 8/8 correct |
| path_near_miss | 8 | 8/8 correct | 8/8 correct | 8/8 correct |
| numeric_value_changed_dangerous | 8 | 8/8 correct | 8/8 correct | 6/8 correct |
| method_mismatch | 5 | 5/5 correct | 5/5 correct | 5/5 correct |
| completely_unrelated | 6 | 6/6 correct | 6/6 correct | 6/6 correct |
| identifier_changed_non_path | 6 | 6/6 correct | 6/6 correct | 2/6 correct |

## Known limitations

The full pipeline's remaining false positives (see disagreements below) cluster into two kinds of case a domain-agnostic deterministic matcher fundamentally cannot distinguish from a safe one, without field-level semantics it doesn't have:

- **Small-magnitude but consequential numeric drift** — a 10% change to a money transfer, an off-by-one on a destructive range's boundary. The hard gate only fires on a *large* relative change (below 50% closeness); a smaller one is indistinguishable, on numbers alone, from a benign paging/retry-count nudge.
- **Opaque identifiers that aren't path/URI-shaped** — a UUID, an email address, a git SHA, a bare numeric id differing by one character. The path/URI hard gate only recognizes slash-shaped strings as opaque; a one-character change to a UUID and a one-character typo in a search query look identical to character-level similarity.

Both are real gaps, not edge cases invented to pad this list — see the disagreements below for the exact cases. Closing them generically would need either per-field semantics (which arguments are identifiers vs. free text) that deja does not have today, or leaning on the optional LLM judge tier — which, as implemented, only engages for scores *below* threshold, not for these, which score confidently above it.

## Disagreements (matcher vs. ground truth)

### Exact (naive JSON equality)

| Case | Category | Expected | Got |
|---|---|---|---|
| `key-order-001` | key_order | MATCH | REJECT |
| `key-order-002` | key_order | MATCH | REJECT |
| `key-order-003` | key_order | MATCH | REJECT |
| `key-order-004` | key_order | MATCH | REJECT |
| `key-order-005` | key_order | MATCH | REJECT |
| `key-order-006` | key_order | MATCH | REJECT |
| `meta-param-001` | meta_param | MATCH | REJECT |
| `meta-param-002` | meta_param | MATCH | REJECT |
| `meta-param-003` | meta_param | MATCH | REJECT |
| `empty-params-001` | empty_vs_missing_params | MATCH | REJECT |
| `empty-params-002` | empty_vs_missing_params | MATCH | REJECT |
| `empty-params-003` | empty_vs_missing_params | MATCH | REJECT |
| `whitespace-001` | whitespace_prose | MATCH | REJECT |
| `whitespace-002` | whitespace_prose | MATCH | REJECT |
| `whitespace-003` | whitespace_prose | MATCH | REJECT |
| `whitespace-004` | whitespace_prose | MATCH | REJECT |
| `whitespace-005` | whitespace_prose | MATCH | REJECT |
| `case-variation-001` | case_variation_prose | MATCH | REJECT |
| `case-variation-002` | case_variation_prose | MATCH | REJECT |
| `case-variation-003` | case_variation_prose | MATCH | REJECT |
| `case-variation-004` | case_variation_prose | MATCH | REJECT |
| `typo-001` | typo_prose | MATCH | REJECT |
| `typo-002` | typo_prose | MATCH | REJECT |
| `typo-003` | typo_prose | MATCH | REJECT |
| `typo-004` | typo_prose | MATCH | REJECT |
| `typo-005` | typo_prose | MATCH | REJECT |
| `optional-param-001` | optional_param_added | MATCH | REJECT |
| `optional-param-002` | optional_param_added | MATCH | REJECT |
| `optional-param-003` | optional_param_added | MATCH | REJECT |
| `optional-param-004` | optional_param_added | MATCH | REJECT |
| `optional-param-005` | optional_param_added | MATCH | REJECT |

### Structural only (deja tier 1/2)

| Case | Category | Expected | Got |
|---|---|---|---|
| `meta-param-001` | meta_param | MATCH | REJECT |
| `meta-param-002` | meta_param | MATCH | REJECT |
| `empty-params-003` | empty_vs_missing_params | MATCH | REJECT |
| `whitespace-001` | whitespace_prose | MATCH | REJECT |
| `whitespace-002` | whitespace_prose | MATCH | REJECT |
| `whitespace-003` | whitespace_prose | MATCH | REJECT |
| `whitespace-004` | whitespace_prose | MATCH | REJECT |
| `whitespace-005` | whitespace_prose | MATCH | REJECT |
| `case-variation-001` | case_variation_prose | MATCH | REJECT |
| `case-variation-002` | case_variation_prose | MATCH | REJECT |
| `case-variation-003` | case_variation_prose | MATCH | REJECT |
| `case-variation-004` | case_variation_prose | MATCH | REJECT |
| `typo-001` | typo_prose | MATCH | REJECT |
| `typo-002` | typo_prose | MATCH | REJECT |
| `typo-003` | typo_prose | MATCH | REJECT |
| `typo-004` | typo_prose | MATCH | REJECT |
| `typo-005` | typo_prose | MATCH | REJECT |
| `optional-param-001` | optional_param_added | MATCH | REJECT |
| `optional-param-002` | optional_param_added | MATCH | REJECT |
| `optional-param-003` | optional_param_added | MATCH | REJECT |
| `optional-param-004` | optional_param_added | MATCH | REJECT |
| `optional-param-005` | optional_param_added | MATCH | REJECT |

### Deja full pipeline (tier 1/2/3 + hard gates)

| Case | Category | Expected | Got |
|---|---|---|---|
| `numeric-dangerous-002` | numeric_value_changed_dangerous | REJECT | MATCH |
| `numeric-dangerous-004` | numeric_value_changed_dangerous | REJECT | MATCH |
| `identifier-non-path-002` | identifier_changed_non_path | REJECT | MATCH |
| `identifier-non-path-003` | identifier_changed_non_path | REJECT | MATCH |
| `identifier-non-path-005` | identifier_changed_non_path | REJECT | MATCH |
| `identifier-non-path-006` | identifier_changed_non_path | REJECT | MATCH |

