## Task: label blocks of a course document

The document has been split into numbered blocks. Code has already labelled the obvious ones. You get the
blocks it could not label, each with the blocks immediately before and after for context. Give each block
exactly one label.

Labels:
- `quiz_description`: overview or scenario text that comes before the first objective or section
- `section_heading`: a heading for an objective, part or module section
- `step_heading`: a heading for a step inside a section
- `narrative`: explanatory text, definitions, formulas or story inside a section
- `directions`: instructions telling students what to do before a group of questions (often starts with "Directions")
- `question`: a numbered question, possibly with choices, an answer key and feedback
- `figure_caption`: text that starts "Figure N" and describes an image
- `table`: a table, or table text that was flattened into a paragraph
- `reminder`: a warning or tip that repeats in several places
- `closing`: wrap-up text after the last question
- `instructor_only`: content for instructors (answer keys, setup notes, IDs, "Students will…")
- `document_control`: version notes, publishing notes, editing instructions for the writing team
- `noise`: page numbers, headers, footers, stray fragments

Decide from the block's own text first, then its position. Use `low` confidence when two labels both fit.

Input:
```
{ "blocks": [ { "id": "b41", "before": "...", "text": "...", "after": "..." } ] }
```

## Example

Input:
```
{ "blocks": [
  { "id": "b7", "before": "Step 2: Calculate daily profit.", "text": "Profit is what remains after the stand pays all of its costs. Profit = total revenue − total cost.", "after": "Directions Use the price list to answer questions 3 and 4." },
  { "id": "b8", "before": "...", "text": "Next version: add a question about taxes. — reviewer note", "after": "..." },
  { "id": "b9", "before": "...", "text": "Students enter total revenue for each output level before the terminal unlocks Step 3.", "after": "..." }
] }
```

Output:
```
{ "labels": [
  { "block_id": "b7", "label": "narrative", "confidence": "high" },
  { "block_id": "b8", "label": "document_control", "confidence": "high" },
  { "block_id": "b9", "label": "instructor_only", "confidence": "medium" }
] }
```

Checks run by code: one label per input block; every `block_id` exists; label is in the list.
