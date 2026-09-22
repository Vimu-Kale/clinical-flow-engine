# The expression language

Guards, start filters and `=`-prefixed automation parameters are written in a small expression language. It is **not** JavaScript: there is no `eval`, no `Function` constructor, and the grammar has no assignment, no function definition and no method call. A parsed expression can only read from the scope it is handed.

```
coalesce(lactate, 0) >= 4 && coalesce(systolicBp, 999) < 90
daysSince(lastA1c.effectiveDateTime) > 180
!exists(coverage) || coverage.priorAuthRequired == false
determination.outcome == "approved"
medicationCount >= 5 || admissionCount >= 2 || coalesce(egfr, 90) < 45
```

## Grammar

Precedence, loosest to tightest:

| Level | Operators |
|---|---|
| 1 | `\|\|` `or` |
| 2 | `&&` `and` |
| 3 | `==` `!=` `<` `<=` `>` `>=` `in` |
| 4 | `+` `-` |
| 5 | `*` `/` `%` |
| 6 | unary `-` `!` `not` |
| 7 | member `.` · index `[ ]` · call `( )` |

Literals: numbers, single- or double-quoted strings, `true`, `false`, `null`, and array literals such as `["E11.9", "I10"]`.

## Semantics worth knowing

- **Missing data is not an error.** Reading an absent property returns nothing, and `patient.missing.deeper` is nothing rather than a crash. Clinical records are sparse by nature.
- **`==` treats null and undefined as equal** to each other, and is otherwise strict.
- **Ordering comparisons understand dates.** Two ISO-8601 strings compare by instant, so `"2026-01-02T00:00:00Z" > "2026-01-01T00:00:00Z"` is true.
- **`+` concatenates** when either side is text, and adds otherwise.
- **`in` tests membership** for a list and substring for text.
- **Division by zero is an error**, not `Infinity`.
- **A guard must evaluate to a real boolean.** `count(alerts)` as a condition is rejected rather than coerced. Silently treating a number as "true" is exactly the class of bug that must not reach a patient, so it fails at authoring time.

## Sandbox guarantees

Each of these is covered by a regression test in `tests/expression.test.ts`:

| Guarantee | How |
|---|---|
| Prototype plumbing is unreadable | `__proto__`, `constructor` and `prototype` are rejected as identifiers and as property names |
| Inherited members are not callable | Function lookup is own-properties-only, so `constructor("return 1")` and `hasOwnProperty("x")` resolve to nothing |
| No method calls | Only a bare identifier can precede `(`; `x.toString()` fails at **parse** time |
| Property reads never cross the prototype chain | Every read goes through an own-property check |
| No catastrophic backtracking | `matches()` is a case-insensitive substring test, deliberately not a regular expression |
| Unknown variables are caught | Referencing something not in scope is an error — and the validator catches it statically, before the pathway can run |

## Function library

All functions are pure apart from the injected clock, which is what makes a recorded run replayable.

<!-- BEGIN GENERATED FUNCTIONS -->
| Signature | Description |
|---|---|
| `abs(number)` | Absolute value. |
| `age(birthDate)` | Whole years elapsed since a birth date. |
| `avg(list)` | Mean of a list of numbers, or null when empty. |
| `coalesce(a, b, ...)` | First argument that is neither null nor missing. |
| `contains(listOrText, value)` | Membership test for a list, or substring test for text. |
| `count(list)` | Number of items in a list. |
| `daysSince(date)` | Days between a past date and now. Negative for future dates. |
| `daysUntil(date)` | Days between now and a future date. Negative for past dates. |
| `exists(value)` | True when a value is neither null nor missing. |
| `first(list)` | First item of a list, or null when empty. |
| `isEmpty(value)` | True for null, missing values, empty text and empty lists. |
| `last(list)` | Last item of a list, or null when empty. |
| `latest(list, dateKey?)` | The most recent item in a list, by `effectiveDateTime` unless told otherwise. |
| `lower(text)` | Lowercased text. |
| `matches(text, fragment)` | Case-insensitive substring test. Deliberately not a regular expression, so a guard cannot be made to backtrack. |
| `max(a, b, ...)` | Largest of the given numbers, or of a single list. |
| `min(a, b, ...)` | Smallest of the given numbers, or of a single list. |
| `now()` | Current time as epoch milliseconds, taken from the engine clock. |
| `pluck(list, key)` | Extracts one field from every item in a list. |
| `round(number, decimals?)` | Rounds to the given number of decimal places, default zero. |
| `sum(list)` | Adds every number in a list. |
| `upper(text)` | Uppercased text. |
| `where(list, key, value)` | Keeps the items whose field equals a value. |
| `within(date, days)` | True when a date falls inside the given number of days of now. |
<!-- END GENERATED FUNCTIONS -->

Regenerate this table with `npm run docs:functions`.
