## Task: draft new questions for a section

The instructor asked for new questions about one section of the document. Draft them. A person will check
each one and decide whether to use it. Everything you write is labelled "AI-drafted" until they approve it.

- Write exactly the number of questions requested (1–5), using only the types requested.
- Every question must be answerable from the section text alone. In `source_quote`, copy the exact
  sentence(s) from the section that prove the correct answer. If you can't find one, don't write the question.
- Match the document's style: its terms, its scenario and characters, and its feedback pattern
  ("Answer: …" first, then a short explanation that refers back to the section).
- Multiple choice: 4 choices unless asked otherwise, one correct. Distractors should be common
  misconceptions, not jokes or obviously wrong answers. Keep choices similar in length and grammar.
- Multiple answer: say "Select all that apply." and mark 2–4 correct choices.
- Numeric: only use a value stated in the section (never one you calculated). Copy it exactly.
  Set `numeric_tolerance` to match the rounding you ask for.
- Do not repeat or rephrase the existing questions you are given.
- Set `confidence` to `low` for any question you're unsure about.

Input:
```
{ "section_title": "...", "section_text": "...", "existing_questions": ["..."], "count": 3, "types": ["multiple_choice", "multiple_answer"] }
```

## Example

Input:
```
{ "section_title": "Step 1: Classify costs as fixed or variable",
  "section_text": "A fixed cost is an expense that stays the same no matter how many cups the stand sells, such as the stand rental and the city permit. A variable cost changes with the number of cups sold, such as lemons, sugar and cups.",
  "existing_questions": ["Which of the following are fixed costs? Select all that apply."],
  "count": 1, "types": ["multiple_choice"] }
```

Output:
```
{ "items": [
  { "type": "multiple_choice", "title": "AI draft 1",
    "question": "The stand sells twice as many cups on Saturday as on Friday. Which cost stays the same on both days?",
    "choices": [ { "text": "Lemons", "correct": false }, { "text": "Cups", "correct": false },
                 { "text": "Stand rental", "correct": true }, { "text": "Sugar", "correct": false } ],
    "accepted_answers": [], "matching_pairs": [],
    "numeric_answer": "", "numeric_tolerance": "", "numeric_min": "", "numeric_max": "",
    "feedback_general": "Answer: Stand rental\nA fixed cost stays the same no matter how many cups the stand sells. Lemons, cups and sugar are variable costs because the stand needs more of them to sell more cups.",
    "feedback_correct": "", "feedback_incorrect": "",
    "source_quote": "A fixed cost is an expense that stays the same no matter how many cups the stand sells, such as the stand rental and the city permit.",
    "problems": [], "confidence": "high" } ] }
```

Checks run by code: `source_quote` appears in `section_text`; for numeric items, `numeric_answer` appears in
`section_text`; each item passes `validateQuestions`; no item's question closely matches an existing one.
