## Task: turn one question block into a quiz item

You get the text of one question from the document, exactly as it was extracted, plus the directions that
come before it. The rule-based parser could not read it, usually because of broken formatting. Rebuild the
question as one item.

How the document marks things:
- `[*]` after a choice marks a correct choice. Several `[*]` or the words "Select all that apply" mean
  `multiple_answer`. Exactly one `[*]` means `multiple_choice`.
- `[NUMERIC ANSWER]` … `Answer: <number>` … `+/- margin: <number>` means `numeric`: copy both numbers exactly
  into `numeric_answer` and `numeric_tolerance`. `Requirement:` and `Type:` lines are instructions for the
  writing team; leave them out.
- `Feedback:` starts the feedback. Everything after it, up to the end of the block, goes in
  `feedback_general`. Keep its paragraphs and calculations.
- A question that asks students to upload a file and has no choices is `file_upload`.
- Choices are lettered `a.`, `b.`, `c.` … Keep them in order. Remove the letter and the `[*]` from the text.
- Page numbers and stray fragments ("26", "Published…") may appear in the middle of text. Leave them out.

Fill every field. Use `""` or `[]` for fields that don't apply to the type. Put the question's number (e.g.
"Q7") in `title`. In `source_quote`, copy the exact words from the input that show the correct answer (the
`[*]` choice, or the `Answer:` line). In `problems`, list anything unclear, such as no `[*]`, two different
answers, or a margin that doesn't match the rounding asked for.

Input:
```
{ "directions": "...", "block": "..." }
```

## Example

Input:
```
{ "directions": "Directions Use the price list to answer questions 3 and 4.",
  "block": "3. What is the daily revenue when the stand sells 40 cups? Enter your answer to the nearest 0.01 dollars ($). [NUMERIC ANSWER] Requirement: Margin of error Answer: 80.00 12 +/- margin: 0.01 Type: Absolute Feedback: Answer: $80.00 Revenue = price × quantity = $2.00 × 40 = $80.00." }
```

Output:
```
{ "type": "numeric", "title": "Q3",
  "question": "What is the daily revenue when the stand sells 40 cups? Enter your answer to the nearest 0.01 dollars ($).",
  "choices": [], "accepted_answers": [], "matching_pairs": [],
  "numeric_answer": "80.00", "numeric_tolerance": "0.01", "numeric_min": "", "numeric_max": "",
  "feedback_general": "Answer: $80.00\nRevenue = price × quantity = $2.00 × 40 = $80.00.",
  "feedback_correct": "", "feedback_incorrect": "",
  "source_quote": "Answer: 80.00 12 +/- margin: 0.01",
  "problems": ["Removed a stray \"12\" between the answer and the margin; it looks like a page number."],
  "confidence": "high" }
```

Checks run by code:
- The stem and every choice text appear in the input block (fuzzy match, ignoring spacing).
- `source_quote` appears in the input verbatim.
- `numeric_answer` and `numeric_tolerance` appear in the input as written.
- The item passes `validateQuestions`.
- The number of choices equals the number of letters `a.`, `b.` … found in the block.
