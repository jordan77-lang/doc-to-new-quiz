## Task: review one quiz item before it is published

You get one item that was read from the course document, the directions it belongs to, and findings from
automatic checks. Look for problems a student would run into. Return at most 5 suggestions, most important
first. Return no suggestions if the item is fine. Not every item needs changes.

Look for:
1. **Answer key:** does the marked answer agree with the feedback's "Answer:" line and explanation? Quote
   both if they disagree. Do not recalculate. Only compare what is written.
2. **Clarity:** is the question answerable from the directions and earlier steps? Is anything ambiguous
   (units, rounding, which output level)?
3. **Rounding and margin:** does the margin match the rounding the question asks for?
4. **Choices:** duplicates, two choices that are both defensible, a choice that gives the answer away,
   inconsistent grammar or length between choices.
5. **Multiple answer:** does the question say "Select all that apply"?
6. **Feedback:** does it explain why, not just state the answer? Does it mention anything the student hasn't
   seen yet?
7. **Accessibility:** images need alt text; don't rely on colour alone; spell out abbreviations the first
   time if the directions don't.
8. **Leftovers:** markers like `[*]`, `[NUMERIC ANSWER]`, "Requirement:", page numbers or editor notes in
   student-facing text.

Each suggestion has:
- `field`: the field to change.
- `severity`: `error` (students would be marked wrong unfairly or the item is broken), `warning` (confusing or
  inconsistent), `idea` (optional improvement).
- `problem`: one sentence.
- `quote`: the exact words from the item that show the problem (copied verbatim).
- `proposed_value`: the full replacement text for that field, or `""` if a person needs to decide. For
  `correct`, give the choice text. Never propose a new numeric answer: use `""` and explain in `problem`.

Input:
```
{ "directions": "...", "item": { ...item fields... }, "automatic_findings": ["..."] }
```

## Example

Input:
```
{ "directions": "Directions Use the cost table to answer questions 5 and 6.",
  "item": { "type": "numeric", "title": "Q5", "question": "What is the total cost at 40 cups? Enter your answer to the nearest 0.01 dollars ($).",
            "numeric_answer": "50.00", "numeric_tolerance": "0.1",
            "feedback_general": "Answer: $50.00\nTC = FC + VC = $30.00 + $20.00 = $50.00." },
  "automatic_findings": ["Margin 0.1 is larger than the rounding the question asks for (0.01)."] }
```

Output:
```
{ "overall": "needs_changes",
  "suggestions": [
    { "field": "numeric_tolerance", "severity": "warning",
      "problem": "The question asks for the nearest 0.01 dollars, but answers up to 0.10 away are accepted.",
      "quote": "to the nearest 0.01 dollars", "proposed_value": "0.01" },
    { "field": "question", "severity": "idea",
      "problem": "\"TC\" appears in the feedback but the question says \"total cost\"; adding the abbreviation helps students match it to the table.",
      "quote": "What is the total cost at 40 cups?", "proposed_value": "What is the total cost (TC) at 40 cups? Enter your answer to the nearest 0.01 dollars ($)." }
  ] }
```

Checks run by code: every `quote` appears in the item; `field` exists on the item type; suggestions for
`numeric_answer` with a non-empty `proposed_value` are dropped; at most 5 suggestions.
