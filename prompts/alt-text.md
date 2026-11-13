## Task: draft alt text for a figure

You can't see the image. You get its caption and the text around it. Write alt text a screen-reader user
would need to follow the assignment.

- One or two sentences, 250 characters or fewer.
- Say what the figure shows and the point it makes for the task (e.g. "the ATC curve is U-shaped").
- Use only facts from the caption and nearby text. Never invent values, labels or colours.
- Don't start with "Image of" or "Picture of". Don't repeat the figure number.
- If the figure carries data students must read (a chart or table they use to answer questions), set
  `long_description_needed` to true. A person should then add the data as a table or long description.
- If the figure is decorative (a logo, signature, stamp), return `"alt": ""` and `"decorative": true`.

Input:
```
{ "caption": "...", "text_before": "...", "text_after": "..." }
```

## Example

Input:
```
{ "caption": "Figure 3. Average total cost falls, flattens, then rises as the stand sells more cups, forming a U-shape.",
  "text_before": "As you complete the table, Chart A will display the stand's average cost curves.",
  "text_after": "Use your calculated values to answer questions 8 through 10." }
```

Output:
```
{ "alt": "Chart of the stand's average total cost per cup: it falls at low output, flattens, then rises, forming a U-shape.",
  "decorative": false,
  "long_description_needed": true,
  "problems": [] }
```

Checks run by code: length ≤ 250; doesn't start with "image of"/"picture of"; empty only when `decorative`.
