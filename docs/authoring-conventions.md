# Writing assignment documents that convert into New Quizzes

These conventions come from the team's own assignment documents (Perfume Collapse, Meet the Beetles, M0 Data
Analysis, AST 111 Labs 1 and 6). The builder already reads all of the variations below. Sticking to the
**recommended** form means fewer things to check after import.

**What to upload:** from Google Docs, use **File → Download → Microsoft Word (.docx)**.
Before you download, **accept or reject all suggestions and resolve comments**. Otherwise suggested text can
end up in the quiz, and the builder blocks export until you confirm.

---

## Styles (the team's style guide)

| Use this style | For | Becomes in New Quizzes |
|---|---|---|
| Title or Heading 1 | The assignment title (e.g. "ECN212 - Module 1 Act 1 - The Perfume Collapse") | Quiz title. If there's none, the file name is used. |
| Heading 2 | `Objective 1: …`, `Step 1: …` | A text block ("Objective 1", "Objective 1, Step 1") |
| Heading 3 | Figure and table titles (`Figure 1`, `Table 1. …`) | Kept inside the step's text block |
| Heading 4 | **Directions** | A stimulus; the questions after it are grouped with it |
| Heading 5 | `Feedback:` and the feedback text | Question feedback |
| Subtitle | Figure long descriptions | Kept with the figure |

Text before the first objective (mission memo, overview) becomes the quiz instructions. Bold labels inside a
step ("Equipment", "Part 2: …") and Heading 4–6 sub-headings stay inside that step instead of becoming new items.

## Questions

Number questions `1.`, `2.`, … either typed or with Word's numbered list. Numbering can restart in each objective.

### Multiple choice: one correct answer
```
13. Between 960 and 1,440 bottles, how does the average variable cost (AVC) change?
    a. AVC decreases
    b. AVC first decreases, then increases
    c. AVC increases [*]
Feedback:
Answer: AVC increases.
<explanation>
```
- Choices can be a lettered list (`a.`, `b.`), a numbered sub-list, or lines separated with Shift+Enter.
- **Recommended:** indent the choices under the question. Choices at the same list level as the question
  also work, but you get a note asking you to check them.
- Bolding the correct choice is fine. The builder removes the bold so it doesn't reveal the answer.

### Multiple answer
Say **Select all that apply.** and put `[*]` after every correct choice.

### Numeric
```
3. What is the fixed cost (FC) at 960 bottles per month? Enter your answer to the nearest 0.01 dollars ($).
[NUMERIC ANSWER]            (or [NUMERIC RESPONSE])
Requirement: Margin of error
Answer: 108.00              (negative numbers work: −70.1)
+/- margin: 0.01
Type: Absolute              (Type: Percent is converted to an absolute margin)
Feedback:
Answer: $108.00
<explanation>
```
- The margin can be smaller than the rounding you ask for (0 = exact rounded value). If it's **larger**
  (nearest 0.01 but ±0.1), you'll get a warning, because wrong answers would be accepted.

### Essay, file upload and short answer
Put a tag on the line after the question: `[ESSAY QUESTION]`, `[FILE UPLOAD]` or `[SHORT ANSWER]`.
A question that asks students to upload something is a file upload even without the tag. The file types
named in the question (PDF, PNG…) become the allowed types.

### Ungraded questions
Start the question with `[Zero Point]` (or `[Ungraded]`): `[Zero Point] 3. Based on your observations, …`.
It imports as a 0-point question. New Quizzes still needs one choice marked `[*]`.

### Placeholders
`##.` instead of a number is accepted but flagged, so you can check that the draft question belongs in the quiz.

## Feedback
- Start with `Feedback:` (or `Feedback`), then `Answer: <the correct answer>`.
  The builder checks this line against the `[*]` choice or numeric answer and warns you if they disagree.
  If no choice is marked `[*]` but this line names one (e.g. "Answer: Figure B"), you get a one-click fix.
- Numbered steps inside feedback ("1) Sort the values…") stay in the feedback.
- Only use `[*]` on choices. A stray `[*]` in feedback or question text is removed and reported.

## Figures, tables and links
- Give images alt text in Google Docs (right-click → Alt text). Without it, alt text is drafted from the
  `Figure N.` caption and flagged for checking.
- Use real tables, not tabs or spaces. Make links real hyperlinks.

## What's left out automatically
- Document-control notes ("Published 8/17/26. Any changes made…").
- **Instructor material:** everything after a heading such as *Instructor guide*, *Answer key*,
  *Your role as a … instructor and facilitator* or *High Level Outline*.
- **Front matter before the student content:** learning outcomes, course goals, NGSS alignment, style-guide notes.
- **Sections marked for deletion:** any heading containing *ARCHIVE*, *delete when no longer needed*,
  *do not publish* or *draft only*, up to the next heading at the same level.

The import report lists everything that was left out, so nothing disappears silently.
