## Task: rebuild a table that was flattened into text

When a PDF is converted to text, tables lose their rows and columns. You get the flattened text of one
table, starting with its caption. Rebuild it as rows of cells.

- `caption`: the caption exactly as written (e.g. "Table 1. Monthly expenses").
- `header`: the column headings, left to right.
- `rows`: one array per row, with one cell per column, in the original order.
- Every word and number in the input must appear exactly once in the output, unchanged. Don't add, remove,
  reorder or reformat anything (keep "$40.00", don't write "40").
- If a row seems to have a missing or extra cell, keep the text and explain in `problems`.
- Text that clearly isn't part of the table (a page number, the start of the next paragraph) goes in
  `left_over` instead.

Input:
```
{ "text": "..." }
```

## Example

Input:
```
{ "text": "Table 2. Daily costs Item Cost per day Stand rental $10.00 Lemons $12.00 Cups $4.00 7" }
```

Output:
```
{ "caption": "Table 2. Daily costs",
  "header": ["Item", "Cost per day"],
  "rows": [["Stand rental", "$10.00"], ["Lemons", "$12.00"], ["Cups", "$4.00"]],
  "left_over": "7",
  "problems": [] }
```

Checks run by code: the multiset of words and numbers in `caption + header + rows + left_over` equals the
input's; every row has `header.length` cells. Code renders the HTML `<table>` with a `<caption>` and `<th>`
headers, so the model never writes HTML.
