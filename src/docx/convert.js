// Converts an assignment document (HTML from extract.js) into builder rows, following the authoring
// conventions in docs/authoring-conventions.md. Rule-based only: no language model.
//
//   lines      every paragraph, heading, list item and table, in document order
//   classify   heading / directions / question start / feedback / repeated reminder / instructor / ...
//   group      quiz description, text blocks, stimuli (Directions) and their questions
//   questions  stem, choices with [*], [NUMERIC ANSWER] blocks, Feedback:
//   checks     answer key vs feedback, margin vs rounding, stray markers, alt text, ...
//
// parseHtml(html) must return a Document (browser: DOMParser; Node tests: linkedom).

const norm = (s) => String(s ?? '')
  .replace(/ /g, ' ')
  .replace(/−/g, '-') // Unicode minus sign (−70.1)
  .replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl')
  .replace(/\s+/g, ' ')
  .trim();
const loose = (s) => norm(s).toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[.\s]+$/, '');
// Inline formatting tags are removed without a space ("<strong>30</strong>." -> "30."); others become spaces.
const stripTags = (html) => norm(String(html)
  .replace(/<\/?(strong|b|em|i|u|span|a|sub|sup|font|mark|s)\b[^>]*>/gi, '')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"));

const RE = {
  instructor: /^(instructor(?:['’]s)?\s+(guide|resources|notes|key|reference)|answer\s+key|teacher\s+(guide|notes))\b/i,
  // Headings that open instructor or design material ("Your role as a lab instructor and facilitator", "High Level Outline-V5")
  instructorHeading: /\b(instructors?|facilitators?|teachers?)\b.*\b(role|guide|notes|prep|resources|reference)\b|\b(role|guide|notes)\b.*\b(instructors?|facilitators?)\b|\bhigh[- ]level outline\b|\boutline[- ]v\d+\b|\bdesign (notes|outline|document)\b|\blab prep(aration)?\b/i,
  // "Use your results … to answer questions 2 through 4." without a Directions heading
  softDirections: /^(use|using|once|after|refer|based on|with|answer|complete|review)\b.*\banswer (the following )?questions?\s+(\d+|#+)\b/i,
  docControl: /^(published\b.*\b(version|changes)\b|next version\b|version notes\b|document (history|control)\b)/i,
  // "Objective 2: …", "Mission Objective 1", "Part 3 –" (not "Unit 2 Comet Lab" or "Mod 4 Act 1", which are titles)
  objective: /^(?:mission\s+|learning\s+)?(objective|part|section|activity)\s+(\d+)\b\s*[:.\-–—]?\s*/i,
  step: /^step\s+(\d+)\s*[:.\-–—]?\s*/i,
  directions: /^directions\b/i,
  // "12. …", "[Zero Point] 3. …", "##. …" (placeholder number). Group 1 = tag, group 2 = number.
  qStart: /^(?:\[([^\]]{1,40})\]\s*)?(\d{1,3}|#{1,3})[.)]\s+(?=\S)/,
  choice: /^([a-z])[.)]\s+/,
  feedback: /^feedback\b\s*:?\s*/i,
  numericTag: /\[\s*numeric\s+(?:answer|response)\s*\]/i,
  typeTag: /\[\s*(essay(?: question)?|file upload|upload|short answer|fill in the blank)\s*\]/i,
  ungraded: /\b(zero[- ]point|ungraded|not graded|practice|0[- ]points?)\b/i,
  archive: /\b(archive|delete (this|when|before)|do not (publish|use|import)|not for students|draft only)\b/i,
  // Closing messages at the end of an objective ("Good work, agent.", "Well done, colleague,", "Excellent work!")
  signoff: /^(good|great|nice|excellent|outstanding|fantastic|superb|impressive|terrific|amazing|wonderful|brilliant|awesome)\s+(work|job|thinking|effort|going)\b|^(well done|congratulations|congrats|bravo|kudos|mission accomplished)\b/i,
  letterFigure: /\b(letter|message|note) from\b|\bclosing out the (objective|step|mission)\b/i,
  // Short salutation that opens a letter ("Fellow scientist,", "Agent,", "Dear team,")
  salutation: /^(dear\s+[^,!:]{1,30}|(fellow|my)\s+\w+|agents?|colleagues?|interns?|team|everyone|scientists?|explorers?|astronomers?)\s*[,!:]$/i,
  // Instructor/design front matter that comes before the student content
  frontMatter: /\b(learning outcomes?|course goals?|style (formatting|guide)|performance expectations|ngss|standards alignment|alignment (table|map))\b|^(current (state|status)|draft status|revision (notes|history)|change ?log|version notes)\b/i,
  marker: /\s*\[\*\]\s*/g,
  figure: /^(figure|fig\.)\s*(\d+)\s*[.:\-–—]?\s*/i,
  selectAll: /select all that apply/i,
};
// Style-guide notes in a document ("Style formatting", "Title = Heading 1", "Figure Descriptions = subtitle")
const STYLE_NOTE = /^style\b|=\s*(heading|subtitle|title)\b/i;
const FILE_TYPES =/\b(PDF|DOCX?|PPTX?|XLSX?|CSV|TXT|PNG|JPE?G|GIF|ZIP|MP4|MP3)\b/g;

// ---------- Lines ----------

// Google Docs exports put bookmark anchors (<a id="_abc"></a>) in headings and use <br> inside paragraphs.
const cleanHtml = (html) => String(html)
  .replace(/<a\s+id="[^"]*"\s*>\s*<\/a>/gi, '')
  .replace(/^(\s*<br\s*\/?>\s*)+/i, '')
  .replace(/(\s*<br\s*\/?>\s*)+$/i, '')
  .trim();
const CAPTION = /^(figure|fig\.|table|chart|graph|exhibit)\s*\d+\b/i;

// A soft line break (Shift+Enter) starts a new logical line before these.
const BREAK_BEFORE = /^\s*(\d{1,3}[.)]\s+\S|[a-z][.)]\s+\S|feedback\s*:|\[\s*numeric answer\s*\]|answer\s*:|requirement\s*:|\+\/-\s*margin|type\s*:\s*(absolute|percent))/i;

// Closes inline tags left open (and drops stray closers) after splitting a paragraph.
function balanceInline(html) {
  const stack = [];
  let out = html.replace(/<(\/?)(strong|b|em|i|u|span|a|sub|sup)\b[^>]*>/gi, (tag, close, name) => {
    const n = name.toLowerCase();
    if (!close) { stack.push(n); return tag; }
    const at = stack.lastIndexOf(n);
    if (at < 0) return '';
    stack.splice(at, 1);
    return tag;
  });
  while (stack.length) out += `</${stack.pop()}>`;
  return out;
}

// Splits a paragraph's HTML at line breaks that start a question, choice, feedback or answer-key line,
// and at blank lines (two breaks in a row).
function splitSoftBreaks(html) {
  const parts = html.split(/<br\s*\/?>/i);
  if (parts.length < 2) return [html];
  const groups = [[parts[0]]];
  for (let i = 1; i < parts.length; i++) {
    const text = stripTags(parts[i]);
    const prevBlank = !stripTags(parts[i - 1]);
    if (BREAK_BEFORE.test(text) || (prevBlank && text)) groups.push([parts[i]]);
    else groups[groups.length - 1].push(parts[i]);
  }
  return groups.map((g) => balanceInline(cleanHtml(g.join('<br />')))).filter((h) => stripTags(h) || /<img\b/i.test(h));
}

const boldOnlyHtml = (html, text) => {
  const strong = [...html.matchAll(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => stripTags(m[2].replace(/<br\s*\/?>/gi, ' '))).join(' ');
  return !!text && norm(strong) === text;
};

function buildLines(body) {
  const lines = [];
  const push = (kind, html, extra) => {
    const text = stripTags(html.replace(/<br\s*\/?>/gi, ' '));
    const hasImg = /<img\b/i.test(html);
    if (!text && !hasImg) return; // empty spacing paragraphs and headings
    const boldOnly = kind !== 'table' && boldOnlyHtml(html, text);
    let k = kind;
    let x = extra;
    // Captions and image-only headings are content, not section headings.
    if (k === 'heading' && (CAPTION.test(text) || !text)) { k = 'p'; x = { ...x, caption: CAPTION.test(text) }; }
    lines.push({ kind: k, html, text, hasImg, boldOnly, ...x });
  };
  const add = (kind, el, extra = {}) => {
    if (kind === 'table') { push(kind, el.outerHTML, extra); return; }
    const html = cleanHtml(el.innerHTML);
    if (kind === 'p') splitSoftBreaks(html).forEach((h) => push('p', h, extra));
    else push(kind, html, extra);
  };
  const walkList = (list, depth) => {
    const ordered = list.tagName.toLowerCase() === 'ol';
    let index = 0;
    for (const li of [...list.children]) {
      if (li.tagName.toLowerCase() !== 'li') continue;
      index += 1;
      const nested = [...li.children].filter((c) => /^(ul|ol)$/i.test(c.tagName));
      nested.forEach((n) => n.remove());
      add('li', li, { depth, ordered, index });
      nested.forEach((n) => walkList(n, depth + 1));
    }
  };
  const walk = (parent) => {
    for (const el of [...parent.children]) {
      const tag = el.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) add('heading', el, { level: Number(tag[1]) });
      else if (tag === 'p') add('p', el);
      else if (tag === 'table') add('table', el);
      else if (tag === 'ul' || tag === 'ol') walkList(el, 0);
      else walk(el);
    }
  };
  walk(body);
  return lines;
}

// Rebuilds HTML from lines, re-nesting list items by depth.
function renderLines(lines, { headingLevel } = {}) {
  let html = '';
  const stack = [];
  const closeTo = (depth) => {
    while (stack.length && stack[stack.length - 1].depth > depth) html += `</li></${stack.pop().tag}>`;
  };
  for (const line of lines) {
    if (line.kind === 'li') {
      const tag = line.ordered ? 'ol' : 'ul';
      closeTo(line.depth);
      const top = stack[stack.length - 1];
      if (top && top.depth === line.depth && top.tag !== tag) { html += `</li></${stack.pop().tag}>`; }
      const cur = stack[stack.length - 1];
      if (cur && cur.depth === line.depth) html += '</li>';
      else { html += `<${tag}>`; stack.push({ tag, depth: line.depth }); }
      html += `<li>${line.html}`;
      continue;
    }
    closeTo(-1);
    if (line.kind === 'heading' || line.asHeading) {
      const level = headingLevel?.(line) || Math.min(Math.max(line.level || 3, 2), 4);
      html += `<h${level}>${line.html}</h${level}>`;
    } else if (line.kind === 'table') html += line.html;
    else html += `<p>${line.html}</p>`;
  }
  closeTo(-1);
  return html;
}

// ---------- Classification ----------

function classify(line, repeated) {
  const t = line.text;
  if (RE.instructor.test(t) && (line.kind === 'heading' || line.boldOnly || t.length < 80)) return 'instructor';
  if (RE.instructorHeading.test(t) && ((line.kind === 'heading' && line.level <= 3) || (line.boldOnly && t.length < 120))) return 'instructor';
  if (RE.docControl.test(t)) return 'doc_control';
  if (RE.directions.test(t) && line.kind !== 'li') return 'directions';
  if (/^feedback\b\s*(:|$|answer\b)/i.test(t) || /^answer\s*:/i.test(t)) return 'feedback'; // often styled as Heading 5
  // Objective/Step headings and Heading 1–3 start sections. Heading 4–6 are sub-headings inside a section.
  if (line.kind === 'heading') return line.level <= 3 || RE.objective.test(t) || RE.step.test(t) ? 'heading' : 'subheading';
  // "Objective 2: …" / "Step 3: …" as a whole-bold paragraph (not "**Step 1:** Classify costs" in a summary list)
  if (line.kind === 'p' && line.boldOnly && (RE.objective.test(t) || RE.step.test(t)) && t.length < 160) return 'heading';
  if (RE.qStart.test(t)) return 'question_start';
  if (line.kind === 'p' && repeated.has(t)) return 'repeated';
  if (line.kind === 'p' && line.boldOnly && t.length < 100 && !/[.?!:]$/.test(t)) return 'soft_heading';
  if (line.kind === 'p' && t.length < 300 && RE.softDirections.test(t)) return 'soft_directions';
  return 'content';
}

// Heading 1–4, Directions, the instructor guide or another question end the current question / block.
const isBreak = (kind, line) => ['directions', 'soft_directions', 'instructor', 'question_start', 'heading'].includes(kind)
  || (kind === 'subheading' && (line.level ?? 4) <= 4);

const hasAnswerKey = (text) => RE.numericTag.test(text) || RE.typeTag.test(text) || /\[\*\]/.test(text);

// Looks ahead from line i to the next question, section heading or Directions. A block is a question if it
// has an answer key ([*], [NUMERIC ANSWER], a type tag) or a Feedback: line, or if its first line asks a
// question ("…?") and choices follow. Numbered instructions ("1. Open the simulator.") are not questions.
function looksLikeQuestion(lines, kinds, i, { isListItem }) {
  const asks = /\?\s*$/.test(lines[i].text) || /select all that apply/i.test(lines[i].text);
  let choices = false;
  for (let j = i; j < lines.length; j++) {
    const l = lines[j];
    if (j > i) {
      const nextItem = isListItem && l.kind === 'li' && l.ordered && l.depth === 0;
      if (nextItem || isBreak(kinds[j], l)) break;
      if (kinds[j] === 'feedback' && /^feedback/i.test(l.text)) return true;
      if ((l.kind === 'li' && (!isListItem || l.depth > 0)) || RE.choice.test(l.text)) choices = true;
    }
    if (hasAnswerKey(l.text)) return true;
  }
  return asks && choices;
}

function listQuestionAt(lines, kinds, i) {
  const line = lines[i];
  if (line.kind !== 'li' || !line.ordered || line.depth !== 0) return false;
  if (looksLikeQuestion(lines, kinds, i, { isListItem: true })) return true;
  // Flat list: "1. Which reaction…?" followed by sibling items "2. Reaction 1 [*]", "3. Reaction 2" (choices not indented)
  if (!/\?\s*$/.test(line.text)) return false;
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j].kind !== 'li') return kinds[j] === 'feedback' && /^feedback/i.test(lines[j].text);
    if (/\[\*\]/.test(lines[j].text)) return true;
  }
  return false;
}
const isFlatListQuestion = (lines) => lines[0].kind === 'li' && /\?\s*$/.test(lines[0].text)
  && lines.slice(1).some((l) => l.kind === 'li' && l.depth === lines[0].depth);

const qNumber = (text) => {
  const m = RE.qStart.exec(text);
  if (!m) return { number: null, tag: '' };
  return { number: /^\d+$/.test(m[2]) ? Number(m[2]) : null, placeholder: !/^\d+$/.test(m[2]), tag: m[1] || '' };
};

// ---------- Images ----------

// Fills empty alt text from a nearby "Figure N." caption. Returns true if it drafted one.
function draftAltFromCaption(lines, i) {
  const line = lines[i];
  if (!line.hasImg) return;
  const caption = [lines[i + 1], lines[i - 1], lines[i + 2]].find((l) => l && RE.figure.test(l.text));
  line.html = line.html.replace(/<img\b([^>]*?)\s*\/?>/gi, (tag, attrs) => {
    const alt = /\balt\s*=\s*"([^"]*)"/i.exec(attrs);
    if (alt && alt[1].trim()) return tag;
    if (!caption) { line.missingAlt = true; return tag; }
    const text = caption.text.replace(RE.figure, '').slice(0, 250).replace(/"/g, '&quot;');
    line.altDrafted = true;
    return `<img${attrs.replace(/\s*\balt\s*=\s*"[^"]*"/i, '')} alt="${text}">`;
  });
}

// ---------- Questions ----------

function splitAtFeedback(line) {
  const m = /(?:<(strong|b|em)>\s*)?Feedback\s*:\s*(?:<\/\1>)?/i.exec(line.html);
  const textAt = line.text.search(/\bFeedback\s*:/i);
  if (!m || textAt <= 0) return [line];
  return [
    { ...line, html: line.html.slice(0, m.index).trim(), text: norm(line.text.slice(0, textAt)) },
    { ...line, kind: 'p', html: line.html.slice(m.index).trim(), text: norm(line.text.slice(textAt)), feedbackStart: true },
  ];
}

// Removes a leading "12." / "a)" from HTML even when formatting splits it: "<strong>30</strong>. At" -> "<strong></strong>At".
const PREFIX_CORE = { number: '(?:\\[[^\\]]{1,40}\\]\\s*)?(?:\\d{1,3}|#{1,3})', letter: '[a-z]' };
const stripPrefix = (html, re) => {
  const core = re === RE.qStart ? PREFIX_CORE.number : PREFIX_CORE.letter;
  return html
    .replace(new RegExp(`^((?:\\s*<[^/>][^>]*>)*)\\s*${core}\\s*((?:<\\/[^>]+>)*)\\s*[.)]\\s*`, 'i'), '$1$2')
    .replace(/<(strong|b|em|span|u)\b[^>]*>\s*<\/\1>/gi, '');
};

// "a. X b. Y c. Z" in one paragraph (lettered in order from a)
function splitInlineChoices(text) {
  const parts = [];
  let expected = 'a';
  let rest = text;
  const first = new RegExp(`(?:^|\\s)a[.)]\\s+`).exec(rest);
  if (!first) return null;
  const stem = rest.slice(0, first.index).trim();
  rest = rest.slice(first.index + first[0].length);
  for (;;) {
    const next = String.fromCharCode(expected.charCodeAt(0) + 1);
    const m = new RegExp(`\\s${next}[.)]\\s+`).exec(rest);
    if (!m) { parts.push(rest.trim()); break; }
    parts.push(rest.slice(0, m.index).trim());
    rest = rest.slice(m.index + m[0].length);
    expected = next;
  }
  return parts.length >= 2 ? { stem, choices: parts } : null;
}

// Authors bold correct choices and whole feedback paragraphs as an answer-key marker. Remove bold that wraps
// the whole text so it doesn't reveal the answer to students; keep bold used for emphasis inside a sentence.
function unboldWhole(html) {
  let h = String(html).trim();
  for (;;) {
    const m = /^<(strong|b)>([\s\S]*)<\/\1>$/i.exec(h);
    if (!m || /<\/?(strong|b)>/i.test(m[2])) return h;
    h = m[2].trim();
  }
}

const htmlForChoice = (text, html) => {
  const cleaned = unboldWhole(stripPrefix(html.replace(RE.marker, ' ').trim(), RE.choice).trim()).replace(/<(strong|b)>\s*<\/\1>/gi, '').trim();
  return /<(strong|b|em|i|sub|sup|img|a|span|u)\b/i.test(cleaned) ? cleaned : text;
};

function buildQuestion(lines, { id, number, parentId, tag = '', placeholder = false }) {
  const findings = [];
  const note = (severity, message, fix) => findings.push({ id, severity, message, fix });
  const stem = [];
  const choices = [];
  const numeric = [];
  const feedback = [];
  let mode = 'stem';
  let sawNumeric = false;
  let forcedType = null;
  const startDepth = lines[0].kind === 'li' ? lines[0].depth : -1;
  const flatList = isFlatListQuestion(lines);
  const afterChoices = [];
  if (flatList) note('info', 'The choices are at the same list level as the question. They were read as its choices; indenting them in the document makes this unambiguous.');

  // Headings inside a question (e.g. "Feedback:" styled as Heading 5) are rendered as paragraphs.
  const pseudo = lines.map((l) => (l.kind === 'heading' ? { ...l, kind: 'p' } : l)).flatMap(splitAtFeedback);
  pseudo.forEach((ln, idx) => {
    let { text, html } = ln;
    if (idx === 0) {
      text = text.replace(RE.qStart, '');
      html = stripPrefix(html, RE.qStart);
      if (ln.kind === 'li') ln = { ...ln, kind: 'p' }; // a numbered-list question's own text is a paragraph
    }
    if (mode === 'feedback') { feedback.push({ ...ln, text, html }); return; }
    if (RE.feedback.test(text) && (ln.feedbackStart || idx > 0)) {
      mode = 'feedback';
      const restText = text.replace(RE.feedback, '');
      const restHtml = html.replace(/^(?:<(strong|b|em)>\s*)?Feedback\s*:\s*(?:<\/\1>)?\s*(?:<br\s*\/?>\s*)*/i, '');
      if (restText) feedback.push({ ...ln, text: restText, html: restHtml });
      return;
    }
    const typeTag = mode !== 'numeric' && RE.typeTag.exec(text);
    if (typeTag) {
      forcedType = /upload/i.test(typeTag[1]) ? 'file_upload' : /essay/i.test(typeTag[1]) ? 'essay' : 'short_answer';
      text = text.replace(RE.typeTag, '').trim();
      html = html.replace(/(?:<(strong|b|em)>\s*)?\[\s*[^\]]+\]\s*(?:<\/\1>)?/i, '').trim();
      if (!text) return;
    }
    if (RE.numericTag.test(text)) {
      sawNumeric = true;
      const [before, after] = text.split(RE.numericTag);
      if (before.trim() && mode === 'stem') stem.push({ ...ln, text: before.trim(), html: html.split(RE.numericTag)[0].trim() });
      if (after.trim()) numeric.push(after.trim());
      mode = 'numeric';
      return;
    }
    if (mode === 'numeric') { numeric.push(text); return; }

    const isListChoice = ln.kind === 'li' && idx > 0 && (ln.depth > startDepth || (flatList && ln.depth === startDepth));
    const lettered = RE.choice.exec(text);
    const expected = String.fromCharCode(97 + choices.length);
    if (isListChoice || (lettered && lettered[1] === expected)) {
      const t = lettered ? text.replace(RE.choice, '') : text;
      choices.push({ text: t, html, line: ln });
      mode = 'choices';
      return;
    }
    if (mode === 'stem' && !choices.length) {
      const inline = splitInlineChoices(text);
      if (inline && !ln.hasImg) {
        if (inline.stem) stem.push({ ...ln, text: inline.stem, html: inline.stem });
        inline.choices.forEach((c) => choices.push({ text: c, html: c, line: ln }));
        mode = 'choices';
        return;
      }
    }
    if (mode === 'choices') afterChoices.push(text);
    stem.push({ ...ln, text, html });
  });

  if (afterChoices.length) {
    note('info', `${afterChoices.length} paragraph(s) between the choices and the feedback were added to the question text (starting "${afterChoices[0].slice(0, 60)}").`);
  }
  const stemText = stem.map((l) => l.text).join(' ');
  const row = { id, title: `Question ${number}`, question: renderLines(stem) };
  if (parentId) row.parent_stimulus = parentId;
  if (tag && RE.ungraded.test(tag)) {
    row.points = 0;
    note('info', `Marked "[${tag}]", so it was imported as a 0-point (ungraded) question.`);
  } else if (tag) note('info', `The tag "[${tag}]" before the question number was removed.`);
  if (placeholder) note('warning', 'The question number is a placeholder (##). Check that this question is meant to be in the quiz.');

  // Stray markers outside the choices
  const strayIn = [];
  if (stem.some((l) => /\[\*\]/.test(l.text))) strayIn.push('question');
  if (feedback.some((l) => /\[\*\]/.test(l.text))) strayIn.push('feedback');
  const clean = (l) => ({ ...l, html: l.html.replace(RE.marker, ' ').trim(), text: l.text.replace(RE.marker, ' ').trim() });
  if (strayIn.length) {
    row.question = renderLines(stem.map(clean));
    note('warning', `Removed a stray [*] from the ${strayIn.join(' and ')}. [*] belongs only after correct choices.`);
  }
  const feedbackLines = feedback.map(clean).map((l) => ({ ...l, html: unboldWhole(l.html) }));
  row.feedback_general = renderLines(feedbackLines);

  if (forcedType === 'essay' || forcedType === 'file_upload') {
    row.type = forcedType;
    if (forcedType === 'file_upload') {
      const types = [...new Set((stemText.match(FILE_TYPES) || []).map((t) => t.toUpperCase()))];
      if (types.length) row.upload_file_types = types.join(';');
      row.upload_max_files = 1;
    }
    if (choices.length || sawNumeric) note('warning', `Tagged as ${forcedType.replace('_', ' ')}, so its choices or numeric answer were ignored.`);
  } else if (forcedType === 'short_answer') {
    row.type = 'short_answer';
  } else if (sawNumeric) {
    row.type = 'numeric';
    const joined = numeric.join(' ');
    const ans = /answer\s*:?\s*\$?\s*([+-]?[\d,]*\.?\d+)/i.exec(joined); // "+1", "-70.1", "1,250"
    const margin = /margin\s*(?:of error)?\s*:?\s*\$?\s*(-?[\d,]*\.?\d+)\s*(%)?/i.exec(joined);
    const kind = /type\s*:?\s*(absolute|percent(?:age)?)/i.exec(joined);
    if (!ans) note('error', 'Found [NUMERIC ANSWER] but no "Answer: <number>" line.');
    else row.numeric_answer = ans[1].replace(/,/g, '').replace(/^\+/, '');
    if (margin) {
      const m = Number(margin[1].replace(/,/g, ''));
      const percent = margin[2] === '%' || /^percent/i.test(kind?.[1] || '');
      if (percent && ans) {
        const abs = Math.abs(Number(row.numeric_answer)) * m / 100;
        row.numeric_tolerance = String(Number(abs.toPrecision(10)));
        note('info', `Converted the ${m}% margin to ±${row.numeric_tolerance}, because New Quizzes imports absolute margins.`);
      } else row.numeric_tolerance = String(m);
    }
    // A margin larger than the rounding asked for accepts wrong answers (nearest 0.01 but ±0.1).
    // A smaller margin (0, or 0.5 for "nearest 1") is fine: it just requires the rounded value.
    const rounding = /nearest\s+(\d*\.\d+|\d+)/i.exec(stemText);
    if (rounding && row.numeric_tolerance && Number(row.numeric_tolerance) > Number(rounding[1]) + 1e-12) {
      const r = rounding[1];
      note('warning', `The question asks for the nearest ${r}, but the margin is ${row.numeric_tolerance}, so answers that are off by more than the rounding are accepted.`, { label: `Set margin to ${r}`, field: 'numeric_tolerance', value: r });
    }
  } else if (choices.length) {
    const marked = choices.map((c) => /\[\*\]/.test(c.text));
    choices.forEach((c, i) => { row[`choice_${i + 1}`] = htmlForChoice(c.text.replace(RE.marker, ' ').trim(), c.html); });
    row.correct = marked.map((m, i) => (m ? `choice_${i + 1}` : null)).filter(Boolean).join(';');
    const n = marked.filter(Boolean).length;
    const selectAll = RE.selectAll.test(stemText);
    row.type = n > 1 || selectAll ? 'multiple_answer' : 'multiple_choice';
    if (!n) {
      // Suggest the choice the feedback names: its exact text, or a letter ("Answer: B", "Answer: Figure B").
      const said = /^answer\s*:\s*(.+)$/i.exec(feedback.map(clean)[0]?.text || '')?.[1] || '';
      let k = choices.findIndex((c) => loose(c.text.replace(RE.marker, '')) === loose(said));
      const letter = /^(?:(?:figure|fig\.|option|choice|answer)\s+)?\(?([A-Za-z])\)?\.?$/i.exec(said.trim());
      if (k < 0 && letter) k = letter[1].toLowerCase().charCodeAt(0) - 97;
      const fix = k >= 0 && k < choices.length ? { label: `Mark choice ${k + 1} (${String.fromCharCode(65 + k)}) correct`, field: 'correct', value: `choice_${k + 1}` } : undefined;
      note('error', `No choice is marked correct. Add [*] after the correct choice${fix ? `; the feedback says "${said}"` : ''}.`, fix);
    }
    if (selectAll && n === 1) note('warning', 'Says "Select all that apply" but only one choice is marked [*].');
    if (!selectAll && n > 1) note('warning', 'Several choices are marked [*]. It was imported as multiple answer; consider adding "Select all that apply."');
  } else if (/\bupload\b/i.test(stemText)) {
    row.type = 'file_upload';
    const types = [...new Set((stemText.match(FILE_TYPES) || []).map((t) => t.toUpperCase()))];
    if (types.length) row.upload_file_types = types.join(';');
    row.upload_max_files = 1;
  } else {
    row.type = 'essay';
    note('info', 'No choices or numeric answer found, so it was imported as an essay (graded manually).');
  }

  // Answer key agrees with the feedback's "Answer:" line? For multiple answers the correct choices may be
  // listed on the lines after "Answer:", one per line.
  const firstFeedback = feedbackLines[0]?.text || '';
  let stated = /^answer\s*:\s*(.+)$/i.exec(firstFeedback)?.[1];
  if (stated && choices.length) {
    const choiceTexts = new Set(choices.map((c) => loose(c.text.replace(RE.marker, ''))));
    for (let k = 1; k < feedbackLines.length && choiceTexts.has(loose(feedbackLines[k].text)); k++) stated += `; ${feedbackLines[k].text}`;
  }
  if (stated && row.type === 'numeric' && row.numeric_answer !== undefined) {
    const num = /-?[\d,]*\.?\d+/.exec(stated.replace(/\$/g, ''));
    if (num && Math.abs(Number(num[0].replace(/,/g, '')) - Number(row.numeric_answer)) > 1e-9) {
      note('warning', `The feedback says "Answer: ${stated}" but the answer key is ${row.numeric_answer}.`);
    }
  } else if (stated && (row.type === 'multiple_choice' || row.type === 'multiple_answer')) {
    const correctTexts = (row.correct || '').split(';').filter(Boolean).map((c) => loose(stripTags(row[c])));
    const s = loose(stated);
    if (correctTexts.length && !correctTexts.every((t) => s.includes(t))) {
      note('warning', `The feedback says "Answer: ${stated}" but the choice(s) marked [*] say "${correctTexts.join('", "')}".`);
    }
  }
  if (row.type === 'short_answer') {
    if (stated) row.correct = stated.replace(/[.\s]+$/, '');
    else note('error', 'Tagged as short answer, but the feedback has no "Answer:" line to take the accepted answer from.');
  }
  if (!feedbackLines.length) note('info', 'No "Feedback:" section.');
  if (!parentId) note('info', 'Not inside a Directions section, so it is a standalone question.');

  return { row, findings, lines };
}

// ---------- Grouping ----------

// "AST 111 Lab 6 - A Tail of Ice or Fire_ Predicting the Comet's Path [Pub 6-9-26].docx"
//   -> "AST 111 Lab 6 - A Tail of Ice or Fire: Predicting the Comet's Path"
export function titleFromFileName(name = '') {
  return norm(String(name)
    .replace(/\.docx$/i, '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/_ /g, ': ')
    .replace(/_/g, ' '));
}

export function convertDocument(html, { parseHtml, fileName = '' }) {
  const doc = parseHtml(`<!doctype html><html><body>${html}</body></html>`);
  const lines = buildLines(doc.body);
  const counts = new Map();
  lines.forEach((l) => { if (l.kind === 'p' && l.text.length > 40) counts.set(l.text, (counts.get(l.text) || 0) + 1); });
  const repeated = new Set([...counts].filter(([, n]) => n > 1).map(([t]) => t));
  const kinds = lines.map((l) => classify(l, repeated));
  // A repeated paragraph is a reminder only if it also appears outside a question (e.g. in Directions or a
  // step's text). A sentence that only ever ends feedback ("For more information, see…") stays feedback.
  const seenOutside = new Set();
  let inQuestion = false;
  lines.forEach((l, i) => {
    const k = kinds[i];
    if ((k === 'question_start' && looksLikeQuestion(lines, kinds, i, { isListItem: false })) || k === 'feedback') inQuestion = true;
    else if (isBreak(k, l)) inQuestion = false;
    if (k === 'repeated' && !inQuestion) seenOutside.add(l.text);
  });
  lines.forEach((_, i) => draftAltFromCaption(lines, i));

  const items = []; // { row, lines, findings }
  const findings = [];
  const excluded = [];
  const description = [];
  let title = '';
  let block = null;
  let stim = null;
  let question = null;
  let seenSection = false;
  let objective = null;
  let nText = 0; let nStim = 0; let nQ = 0;

  // The quiz title: the first Title/Heading 1 before the first objective, step, Directions or question
  // (skipping front matter and archive headings); otherwise a heading or bold line at the very top.
  const firstSection = lines.findIndex((l, i) => ['directions', 'question_start'].includes(kinds[i]) || (kinds[i] === 'heading' && (RE.objective.test(l.text) || RE.step.test(l.text))));
  const before = (i) => firstSection < 0 || i < firstSection;
  const notMeta = (l, i) => kinds[i] !== 'doc_control' && l.text && !RE.frontMatter.test(l.text) && !RE.archive.test(l.text) && !STYLE_NOTE.test(l.text);
  let titleIndex = lines.findIndex((l, i) => before(i) && notMeta(l, i) && l.kind === 'heading' && l.level === 1);
  if (titleIndex < 0) titleIndex = lines.findIndex((l, i) => notMeta(l, i) && !(l.hasImg && !l.text));
  const isTitle = titleIndex >= 0 && (lines[titleIndex].kind === 'heading' || lines[titleIndex].boldOnly);
  if (isTitle) title = lines[titleIndex].text;
  else if (fileName) title = titleFromFileName(fileName);
  let lastNumber = 0;
  let skipLevel = null; // inside an "ARCHIVE / delete when…" section

  const newText = (titleText, firstLine) => {
    nText += 1;
    block = { row: { id: `t${nText}`, type: 'text_only', title: titleText }, lines: firstLine ? [firstLine] : [], findings: [] };
    items.push(block);
  };
  const finishBlock = () => { block = null; };
  const finishStim = () => {
    if (!stim) return;
    if (!stim.children) {
      // Directions with no questions: keep the text with the section it belongs to
      const idx = items.indexOf(stim);
      const prev = items[idx - 1];
      if (prev && prev.row.type === 'text_only' && idx === items.length - 1) { prev.lines.push(...stim.lines); items.pop(); } else { stim.row.type = 'text_only'; }
    }
    stim = null;
  };
  const finishQuestion = () => {
    if (!question) return;
    nQ += 1;
    const number = question.number ?? lastNumber + 1;
    lastNumber = number;
    const built = buildQuestion(question.lines, { id: `q${nQ}`, number, parentId: stim?.row.id, tag: question.tag, placeholder: question.placeholder });
    items.push(built);
    if (stim) stim.children += 1;
    question = null;
  };
  const closesSection = (i) => {
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].hasImg && !lines[j].text) continue;
      return kinds[j] === 'doc_control' || (isBreak(kinds[j], lines[j]) && kinds[j] !== 'question_start');
    }
    return true;
  };
  const headingTitle = (line) => {
    const t = line.text;
    let m = RE.objective.exec(t);
    if (m) { objective = `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}`; return objective; }
    m = RE.step.exec(t);
    if (m) return objective ? `${objective}, Step ${m[1]}` : `Step ${m[1]}`;
    return t.length > 80 ? `${t.slice(0, 77)}…` : t;
  };

  for (let i = 0; i < lines.length; i++) {
    if (isTitle && i === titleIndex) { skipLevel = null; continue; } // the title starts the student content
    const line = lines[i];
    let kind = kinds[i];

    // Sections marked "ARCHIVE", "delete when no longer needed", … are left out up to the next heading of the same level.
    const headingLike = ['heading', 'subheading', 'soft_heading'].includes(kind);
    const skippable = (t) => RE.archive.test(t) || RE.frontMatter.test(t) || STYLE_NOTE.test(t);
    if (skipLevel !== null) {
      if (line.kind === 'heading' && line.level <= skipLevel && !skippable(line.text)) skipLevel = null;
      else { excluded[excluded.length - 1].lines += 1; continue; }
    }
    if (!seenSection && line.kind === 'table' && RE.frontMatter.test(line.text.slice(0, 300))) {
      excluded.push({ reason: 'Notes for instructors or the writing team before the student content (not included)', heading: '', lines: 1, preview: line.text.slice(0, 240) });
      continue;
    }
    const archived = headingLike && RE.archive.test(line.text);
    const frontMatter = !seenSection && (headingLike || line.boldOnly) && RE.frontMatter.test(line.text);
    if (archived || frontMatter) {
      finishQuestion(); finishStim(); finishBlock();
      skipLevel = archived ? (line.level ?? 1) : Math.min(line.kind === 'heading' ? line.level : 2, 2);
      excluded.push({
        reason: archived ? 'Section marked for deletion or archive (not included)' : 'Notes for instructors or the writing team before the student content (not included)',
        heading: line.text, lines: 1, preview: line.text.slice(0, 240),
      });
      continue;
    }

    // A Word-list item starts a question only outside a question, or after the current question's feedback
    // began. Before that, list items are the current question's choices.
    if (['content', 'soft_heading'].includes(kind) && (!question || question.inFeedback) && listQuestionAt(lines, kinds, i)) kind = 'question_start';
    if (kind === 'question_start' && line.kind !== 'li') {
      const { number } = qNumber(line.text);
      // Inside a question, numbered steps in the feedback ("1) Sort the values…") don't start a new question.
      const continues = !question || number === null || question.number === null || number > question.number;
      if (!continues || !looksLikeQuestion(lines, kinds, i, { isListItem: false })) kind = 'content';
    }
    const startQuestion = () => {
      const n = qNumber(line.text);
      question = { lines: [line], number: n.number, tag: n.tag, placeholder: n.placeholder };
    };
    if (kind === 'instructor') {
      finishQuestion(); finishStim(); finishBlock();
      const rest = lines.slice(i);
      excluded.push({ reason: 'Instructor-only section (not included in the quiz)', heading: line.text, lines: rest.length, preview: rest.slice(0, 3).map((l) => l.text).join(' ').slice(0, 240) });
      break;
    }
    if (kind === 'doc_control') { excluded.push({ reason: 'Document-control note', heading: '', lines: 1, preview: line.text.slice(0, 240) }); continue; }

    if (question) {
      if (kind === 'question_start') { finishQuestion(); startQuestion(); continue; }
      // A repeated paragraph is a reminder only when it closes a section (next is a heading, Directions or
      // the end). Repeated sentences inside feedback ("To calculate total cost, add…") stay in the feedback.
      if (kind === 'repeated' && seenOutside.has(line.text) && closesSection(i)) {
        const moved = [];
        while (question.lines.length > 1 && question.lines[question.lines.length - 1].hasImg && !question.lines[question.lines.length - 1].text) moved.unshift(question.lines.pop());
        finishQuestion();
        nText += 1;
        items.push({ row: { id: `t${nText}`, type: 'text_only', title: 'Reminder' }, lines: [...moved, line], findings: [] });
        continue;
      }
      // A closing message after the last question ("Good work, agent. … Rodney") is not feedback. Feedback is
      // bold by the team's convention; the message isn't. It runs to the next heading and takes the letter
      // image and its "Figure N. A letter from …" caption with it.
      if (question.inFeedback && line.kind === 'p' && !line.boldOnly && (RE.signoff.test(line.text) || RE.salutation.test(line.text))) {
        const moved = [];
        const isLetterPart = (l) => (l.hasImg && !l.text) || (RE.figure.test(l.text) && (RE.letterFigure.test(l.text) || !l.boldOnly)) || RE.letterFigure.test(l.text);
        while (question.lines.length > 1 && isLetterPart(question.lines[question.lines.length - 1])) moved.unshift(question.lines.pop());
        finishQuestion();
        newText(objective ? `${objective} closing message` : 'Closing message');
        block.lines.push(...moved, line);
        continue;
      }
      // Only section-level headings (1–4) and directions end a question; Heading 5/6 lines are part of its feedback.
      const ends = kind !== 'question_start' && isBreak(kind, line) && (kind !== 'soft_directions' || question.inFeedback);
      if (ends) finishQuestion();
      else {
        if (/^feedback\b/i.test(line.text) || /\bfeedback\s*:/i.test(line.text)) question.inFeedback = true;
        question.lines.push(line);
        continue;
      }
    }

    if (kind === 'question_start') {
      finishBlock();
      startQuestion();
      continue;
    }
    if (kind === 'heading') {
      finishStim(); finishBlock();
      seenSection = true;
      newText(headingTitle(line), { ...line, asHeading: true, objectiveLevel: RE.objective.test(line.text), stepLevel: RE.step.test(line.text) });
      continue;
    }
    // Bold labels ("Equipment") and Heading 4–6 stay inside the current section as sub-headings.
    const lineOut = kind === 'soft_heading' || kind === 'subheading' ? { ...line, asHeading: true, level: 4 } : line;
    // "Use your results to answer questions 2 through 4." without a Directions heading opens a group too,
    // unless a Directions block is already collecting its text.
    if (kind === 'soft_directions' && !(stim && !stim.children)) kind = 'directions';
    if (kind === 'directions') {
      finishStim(); finishBlock();
      seenSection = true;
      nStim += 1;
      stim = { row: { id: `s${nStim}`, type: 'stimulus', title: 'Directions' }, lines: [line], findings: [], children: 0 };
      items.push(stim);
      continue;
    }
    // content, sub-headings, feedback (stray), repeated (outside a question)
    if (stim && !stim.children) stim.lines.push(lineOut);
    else if (!seenSection && !stim) description.push(lineOut);
    else {
      if (!block || items[items.length - 1] !== block) newText(lineOut.asHeading ? headingTitle(line) : 'Text');
      block.lines.push(lineOut);
    }
  }
  finishQuestion(); finishStim();

  // Render text and stimulus HTML; collect findings with item numbers
  const headingLevel = (l) => (l.objectiveLevel ? 2 : l.stepLevel ? 3 : Math.min(Math.max(l.level || 3, 2), 4));
  const rows = items.map((it) => {
    if (it.row.type === 'text_only' || it.row.type === 'stimulus') it.row.question = renderLines(it.lines, { headingLevel });
    return it.row;
  });
  items.forEach((it, idx) => {
    const item = idx + 1;
    it.findings.forEach((f) => findings.push({ ...f, item }));
    if (it.lines.some((l) => l.altDrafted)) findings.push({ item, id: it.row.id, severity: 'warning', message: 'Alt text for an image was drafted from its figure caption. Check that it describes the image.' });
    if (it.lines.some((l) => l.missingAlt)) findings.push({ item, id: it.row.id, severity: 'warning', message: 'An image has no alt text and no figure caption to draft it from.' });
  });
  if (!items.some((it) => !['text_only', 'stimulus'].includes(it.row.type))) {
    findings.unshift({ item: null, severity: 'error', message: 'No questions were found. Questions should be numbered (1., 2., …) with choices marked [*], or [NUMERIC ANSWER] blocks. See the authoring guide.' });
  }

  return {
    title,
    description: renderLines(description, { headingLevel }),
    rows,
    findings,
    excluded,
    sources: items.map((it) => it.lines.map((l) => l.text).join('\n').slice(0, 2000)),
    stats: {
      questions: rows.filter((r) => !['text_only', 'stimulus'].includes(r.type)).length,
      stimuli: rows.filter((r) => r.type === 'stimulus').length,
      text: rows.filter((r) => r.type === 'text_only').length,
    },
  };
}
