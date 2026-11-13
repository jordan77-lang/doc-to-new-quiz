// Builds a Canvas QTI 1.2 package for New Quizzes, matching the structure of Canvas's own
// New Quizzes QTI export:
//
//   imsmanifest.xml
//   <quizIdent>/<quizIdent>.xml          questestinterop with one assessment
//   <quizIdent>/assessment_meta.xml      quiz settings
//   Uploaded Media/<image files>         images referenced as $IMS-CC-FILEBASE$/Uploaded Media/...
//   non_cc_assessments/
//
// Import: Course Settings → Import Course Content → QTI .zip file. Each bank becomes one
// unpublished New Quiz.
//
// Conventions copied from Canvas exports:
// - every <item> has itemmetadata with question_type, points_possible, original_answer_ids,
//   assessment_question_identifierref and calculator_type; Canvas reads points from points_possible;
// - scoring uses a 0–100 scale: SCORE = 100 marks the correct response;
// - a stimulus is a text_only_question with passage=false; its questions follow it directly and carry
//   parent_stimulus_item_ident. Standalone text is a text_only_question with passage=true;
// - multiple answers with partial credit carry scoring_algorithm=PartialScore;
// - numeric exact answers put margintype/margin on <varequal>;
// - feedback lives in <itemfeedback> blocks named general_fb, correct_fb and general_incorrect_fb;
// - all HTML is escaped once inside <mattext>.

import { CANVAS_TYPES, UNSCORED_TYPES } from './schema.js';
import {
  xmlEscape, toHtml, looksLikeHtml, randomIdent, hashIdent, formatNumber,
  rewriteImageSrcs, isRelativeSrc, imageKey, safeFileName,
} from './util.js';

const QTI_NS = 'xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.imsglobal.org/xsd/ims_qtiasiv1p2 http://www.imsglobal.org/xsd/ims_qtiasiv1p2p1.xsd"';
export const MEDIA_FOLDER = 'Uploaded Media';

export const DEFAULT_SETTINGS = {
  description: '',
  shuffleAnswers: false,
  shuffleQuestions: false,
  showCorrectAnswers: false,
  allowedAttempts: 1, // -1 = unlimited
  oneQuestionAtATime: false,
  cantGoBack: false,
  calculator: 'none', // 'none' | 'basic' | 'scientific'
  partialCredit: false, // default for multiple_answer rows with an empty partial_credit cell
};

// Trims float noise: 3.14 - 0.005 -> 3.135 rather than 3.1350000000000002
const cleanNum = (n) => String(Number(Number(n).toPrecision(12)));

const indent = (str, spaces) => str.split('\n').map((l) => (l ? ' '.repeat(spaces) + l : l)).join('\n');

export const questionPoints = (q) => (UNSCORED_TYPES.includes(q.type) ? 0 : q.points);

// ---------- Images ----------

// images: Map imageKey -> { name, data }. Tracks which ones are used and where they go in the zip.
function createMedia(images = new Map()) {
  const used = new Map(); // key -> path
  const taken = new Set();
  return {
    used,
    resolve(src) {
      if (!isRelativeSrc(src)) return null;
      const key = imageKey(src);
      const img = images.get(key);
      if (!img) return null;
      if (!used.has(key)) {
        const safe = safeFileName(img.name);
        let name = safe;
        for (let i = 2; taken.has(name.toLowerCase()); i++) name = safe.replace(/(\.[^.]*)?$/, `-${i}$1`);
        taken.add(name.toLowerCase());
        used.set(key, `${MEDIA_FOLDER}/${name}`);
      }
      return `$IMS-CC-FILEBASE$/${used.get(key)}`;
    },
    files() {
      return [...used.entries()].map(([key, path]) => ({ path, content: images.get(key).data }));
    },
  };
}

// ---------- XML fragments ----------

function metaField(label, entry) {
  return entry === '' || entry === undefined || entry === null
    ? `<qtimetadatafield>\n  <fieldlabel>${xmlEscape(label)}</fieldlabel>\n  <fieldentry/>\n</qtimetadatafield>`
    : `<qtimetadatafield>\n  <fieldlabel>${xmlEscape(label)}</fieldlabel>\n  <fieldentry>${xmlEscape(entry)}</fieldentry>\n</qtimetadatafield>`;
}

const decvar = '<outcomes>\n  <decvar maxvalue="100" minvalue="0" varname="SCORE" vartype="Decimal"/>\n</outcomes>';

function scoreCondition(conditionXml) {
  return `<respcondition continue="No">
  <conditionvar>
${indent(conditionXml, 4)}
  </conditionvar>
  <setvar action="Set" varname="SCORE">100</setvar>
</respcondition>`;
}

function resprocessing(parts = []) {
  return `<resprocessing>\n${indent([decvar, ...parts].join('\n'), 2)}\n</resprocessing>`;
}

// ---------- Items ----------

export function canvasItemXml(q, ctx) {
  const { ident, answerBase, settings = DEFAULT_SETTINGS, parentIdent = null } = ctx;
  const media = ctx.media || createMedia();
  const html = (text) => rewriteImageSrcs(toHtml(text), (src) => media.resolve(src));
  const htmlMattext = (text) => `<mattext texttype="text/html">${xmlEscape(html(text))}</mattext>`;
  const answerMattext = (text) => (looksLikeHtml(text)
    ? `<mattext texttype="text/html">${xmlEscape(rewriteImageSrcs(text, (src) => media.resolve(src)))}</mattext>`
    : `<mattext texttype="text/plain">${xmlEscape(text)}</mattext>`);

  let questionHtml = html(q.question);
  if (q.image) {
    const img = `<p><img src="${xmlEscape(media.resolve(q.image) || q.image)}" alt="${xmlEscape(q.imageAlt)}"></p>`;
    questionHtml = img + questionHtml;
  }
  const isText = UNSCORED_TYPES.includes(q.type);
  const questionMaterial = `<material${isText ? ' orientation="top"' : ''}>\n  <mattext texttype="text/html">${xmlEscape(questionHtml)}</mattext>\n</material>`;

  const idents = new Map(q.choices.map((c, i) => [c.id, String(answerBase + i + 1)]));
  let presentationExtra = '';
  let presentationAttrs = '';
  let processing = '';
  let answerIds = '';

  switch (q.type) {
    case 'multiple_choice':
    case 'multiple_answer':
    case 'true_false': {
      const multiple = q.type === 'multiple_answer';
      const labels = q.choices.map((c) => `<response_label ident="${idents.get(c.id)}">
  <material>
    ${answerMattext(c.text)}
  </material>
</response_label>`).join('\n');
      presentationExtra = `<response_lid ident="response1" rcardinality="${multiple ? 'Multiple' : 'Single'}">
  <render_choice>
${indent(labels, 4)}
  </render_choice>
</response_lid>`;
      const correct = new Set(q.correct);
      const condition = multiple
        ? `<and>\n${indent([
          ...q.choices.filter((c) => correct.has(c.id)).map((c) => `<varequal respident="response1">${idents.get(c.id)}</varequal>`),
          ...q.choices.filter((c) => !correct.has(c.id)).map((c) => `<not>\n  <varequal respident="response1">${idents.get(c.id)}</varequal>\n</not>`),
        ].join('\n'), 2)}\n</and>`
        : `<varequal respident="response1">${idents.get(q.correct[0])}</varequal>`;
      processing = resprocessing([scoreCondition(condition)]);
      answerIds = [...idents.values()].join(',');
      break;
    }
    case 'short_answer':
      presentationExtra = fib(null);
      processing = resprocessing([scoreCondition(q.answers.map((a) => `<varequal respident="response1">${xmlEscape(a)}</varequal>`).join('\n'))]);
      break;
    case 'numeric': {
      presentationExtra = fib('Decimal');
      const r = numericRule(q.numeric);
      const condition = r.kind === 'exact'
        ? `<or>
  <varequal respident="response1" margintype="absolute" margin="${cleanNum(r.margin)}">${cleanNum(r.exact)}</varequal>
  <and>
    <vargte respident="response1">${cleanNum(r.low)}</vargte>
    <varlte respident="response1">${cleanNum(r.high)}</varlte>
  </and>
</or>`
        : `<vargte respident="response1">${cleanNum(r.low)}</vargte>\n<varlte respident="response1">${cleanNum(r.high)}</varlte>`;
      processing = resprocessing([scoreCondition(condition)]);
      answerIds = '1';
      break;
    }
    case 'matching': {
      const pairs = q.matchingPairs;
      const rightTexts = [...new Set([...pairs.map((p) => p.right), ...q.distractors])];
      const rightIdent = new Map(rightTexts.map((t, i) => [t, String(answerBase + 500 + i + 1)]));
      const leftIdent = pairs.map((_, i) => String(answerBase + i + 1));
      const labels = rightTexts.map((t) => `<response_label ident="${rightIdent.get(t)}">
  <material>
    ${answerMattext(t)}
  </material>
</response_label>`).join('\n');
      presentationExtra = pairs.map((p, i) => `<response_lid ident="response_${leftIdent[i]}">
  <material>
    ${answerMattext(p.left)}
  </material>
  <render_choice>
${indent(labels, 4)}
  </render_choice>
</response_lid>`).join('\n');
      const share = Math.round((100 / pairs.length) * 100) / 100;
      processing = resprocessing(pairs.map((p, i) => `<respcondition>
  <conditionvar>
    <varequal respident="response_${leftIdent[i]}">${rightIdent.get(p.right)}</varequal>
  </conditionvar>
  <setvar varname="SCORE" action="Add">${share}</setvar>
</respcondition>`));
      answerIds = leftIdent.join(',');
      break;
    }
    case 'essay':
      presentationExtra = fib(null);
      processing = resprocessing(['<respcondition continue="No">\n  <conditionvar>\n    <other/>\n  </conditionvar>\n</respcondition>']);
      break;
    case 'file_upload':
      if (q.upload.types.length) presentationAttrs += ` allowed_types="${xmlEscape(q.upload.types.join(','))}"`;
      if (q.upload.maxFiles) presentationAttrs += ` files_count="${q.upload.maxFiles}"`;
      processing = resprocessing();
      break;
    case 'text_only':
    case 'stimulus':
      break;
    default:
      throw new Error(`Row ${q.rowNumber}: ${q.type} can't be exported to Canvas QTI 1.2`);
  }

  // Metadata, in the order Canvas writes it
  const fields = [
    metaField('question_type', CANVAS_TYPES[q.type]),
    metaField('points_possible', formatNumber(questionPoints(q))),
    metaField('original_answer_ids', answerIds),
    metaField('assessment_question_identifierref', hashIdent(`${ident}:question`)),
  ];
  if (parentIdent) fields.push(metaField('parent_stimulus_item_ident', parentIdent));
  fields.push(metaField('calculator_type', settings.calculator || 'none'));
  if (isText) {
    fields.push(metaField('source_url', ''));
    fields.push(metaField('passage', q.type === 'text_only' ? 'true' : 'false'));
  }
  const partial = q.partialCredit === true || (q.partialCredit === null && settings.partialCredit);
  if (q.type === 'multiple_answer' && partial) fields.push(metaField('scoring_algorithm', 'PartialScore'));
  if (q.type === 'matching') {
    const extra = q.distractors.filter((d) => !q.matchingPairs.some((p) => p.right === d));
    if (extra.length) fields.push(metaField('matching_answer_incorrect_matches', extra.join('\n')));
  }
  const metadata = `<itemmetadata>\n  <qtimetadata>\n${indent(fields.join('\n'), 4)}\n  </qtimetadata>\n</itemmetadata>`;

  const presentation = `<presentation${presentationAttrs}>\n${indent([questionMaterial, presentationExtra].filter(Boolean).join('\n'), 2)}\n</presentation>`;

  // Feedback (graded types only get correct/incorrect)
  const fb = (id, text) => `<itemfeedback ident="${id}">
  <flow_mat>
    <material>
      ${htmlMattext(text)}
    </material>
  </flow_mat>
</itemfeedback>`;
  const feedback = [];
  if (!isText) {
    const autoGraded = !['essay', 'file_upload'].includes(q.type);
    if (autoGraded && q.feedback.correct) feedback.push(fb('correct_fb', q.feedback.correct));
    if (q.feedback.general) feedback.push(fb('general_fb', q.feedback.general));
    if (autoGraded && q.feedback.incorrect) feedback.push(fb('general_incorrect_fb', q.feedback.incorrect));
  }

  return `<item ident="${ident}" title="${xmlEscape(q.title)}">
${indent([metadata, presentation, processing, ...feedback].filter(Boolean).join('\n'), 2)}
</item>`;
}

function fib(fibtype) {
  return `<response_str ident="response1" rcardinality="Single">
  <render_fib${fibtype ? ` fibtype="${fibtype}"` : ''}>
    <response_label ident="answer1"${fibtype ? '' : ' rshuffle="No"'}/>
  </render_fib>
</response_str>`;
}

export function numericRule(numeric) {
  const { answer, tolerance, min, max } = numeric;
  if (answer !== null || min === null || max === null) {
    const exact = answer ?? min ?? max;
    const margin = Math.abs(tolerance ?? 0);
    return { kind: 'exact', exact, margin, low: exact - margin, high: exact + margin };
  }
  return { kind: 'range', low: min, high: max };
}

// ---------- Package ----------

const itemIdent = (quizIdent, q) => hashIdent(`${quizIdent}:${q.id}`);

function itemsXml(questions, quizIdent, settings, media) {
  return questions.map((q, i) => {
    const parent = q.parentStimulus && questions.find((p) => p.type === 'stimulus' && p.id === q.parentStimulus);
    return canvasItemXml(q, {
      ident: itemIdent(quizIdent, q),
      answerBase: (i + 1) * 1000,
      settings,
      media,
      parentIdent: parent ? itemIdent(quizIdent, parent) : null,
    });
  });
}

// Question-bank mode keeps the questions (and the stimuli they belong to) but drops text blocks,
// instructions and stimuli with no questions.
export function bankQuestions(questions) {
  const usedStimuli = new Set(questions.filter((q) => q.parentStimulus).map((q) => q.parentStimulus));
  return questions.filter((q) => (q.type === 'stimulus' ? usedStimuli.has(q.id) : q.type !== 'text_only'));
}

// Canvas's own question-bank format (what Canvas writes for banks in course exports): an <objectbank>
// with a bank_title, containing the items.
function objectBankXml(bank, bankIdent, settings, media) {
  const items = itemsXml(bankQuestions(bank.questions), bankIdent, settings, media);
  return `<?xml version="1.0" encoding="UTF-8"?>
<questestinterop ${QTI_NS}>
  <objectbank ident="${bankIdent}">
    <qtimetadata>
      <qtimetadatafield>
        <fieldlabel>bank_title</fieldlabel>
        <fieldentry>${xmlEscape(bank.title)}</fieldentry>
      </qtimetadatafield>
    </qtimetadata>
${indent(items.join('\n'), 4)}
  </objectbank>
</questestinterop>
`;
}

function assessmentXml(bank, quizIdent, settings, media) {
  const items = itemsXml(bank.questions, quizIdent, settings, media);
  const attempts = settings.allowedAttempts < 0 ? 'unlimited' : String(settings.allowedAttempts);
  return `<?xml version="1.0" encoding="UTF-8"?>
<questestinterop ${QTI_NS}>
  <assessment ident="${quizIdent}" title="${xmlEscape(bank.title)}">
    <qtimetadata>
      <qtimetadatafield>
        <fieldlabel>cc_maxattempts</fieldlabel>
        <fieldentry>${attempts}</fieldentry>
      </qtimetadatafield>
    </qtimetadata>
    <section ident="root_section">
${indent(items.join('\n'), 6)}
    </section>
  </assessment>
</questestinterop>
`;
}

function assessmentMetaXml(bank, quizIdent, settings, media) {
  const total = bank.questions.reduce((sum, q) => sum + questionPoints(q), 0);
  const bool = (b) => (b ? 'true' : 'false');
  const description = rewriteImageSrcs(toHtml(settings.description), (src) => media.resolve(src));
  return `<?xml version="1.0" encoding="UTF-8"?>
<quiz identifier="${quizIdent}" xmlns="http://canvas.instructure.com/xsd/cccv1p0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://canvas.instructure.com/xsd/cccv1p0 https://canvas.instructure.com/xsd/cccv1p0.xsd">
  <title>${xmlEscape(bank.title)}</title>
  <description>${xmlEscape(description)}</description>
  <due_at/>
  <lock_at/>
  <unlock_at/>
  <shuffle_questions>${bool(settings.shuffleQuestions)}</shuffle_questions>
  <shuffle_answers>${bool(settings.shuffleAnswers)}</shuffle_answers>
  <calculator_type>${xmlEscape(settings.calculator || 'none')}</calculator_type>
  <scoring_policy>keep_highest</scoring_policy>
  <hide_results/>
  <quiz_type>assignment</quiz_type>
  <points_possible>${formatNumber(total)}</points_possible>
  <require_lockdown_browser>false</require_lockdown_browser>
  <require_lockdown_browser_for_results>false</require_lockdown_browser_for_results>
  <require_lockdown_browser_monitor>false</require_lockdown_browser_monitor>
  <lockdown_browser_monitor_data/>
  <show_correct_answers>${bool(settings.showCorrectAnswers)}</show_correct_answers>
  <anonymous_submissions>false</anonymous_submissions>
  <could_be_locked>false</could_be_locked>
  <disable_timer_autosubmission>false</disable_timer_autosubmission>
  <allowed_attempts>${settings.allowedAttempts}</allowed_attempts>
  <build_on_last_attempt>false</build_on_last_attempt>
  <one_question_at_a_time>${bool(settings.oneQuestionAtATime)}</one_question_at_a_time>
  <cant_go_back>${bool(settings.cantGoBack)}</cant_go_back>
  <available>false</available>
  <one_time_results>false</one_time_results>
  <show_correct_answers_last_attempt>false</show_correct_answers_last_attempt>
  <only_visible_to_overrides>false</only_visible_to_overrides>
  <module_locked>false</module_locked>
  <allow_clear_mc_selection>true</allow_clear_mc_selection>
  <disable_document_access>false</disable_document_access>
  <result_view_restricted>true</result_view_restricted>
  <display_items>true</display_items>
  <display_item_feedback>true</display_item_feedback>
  <display_item_response>true</display_item_response>
  <display_points_awarded>true</display_points_awarded>
  <display_points_possible>true</display_points_possible>
  <display_item_correct_answer>${bool(settings.showCorrectAnswers)}</display_item_correct_answer>
  <display_item_response_correctness>true</display_item_response_correctness>
</quiz>
`;
}

function manifestXml(entries, mediaPaths, packageTitle) {
  const today = new Date().toISOString().slice(0, 10);
  const quizzes = entries.map(({ quizIdent, metaIdent }) => (metaIdent
    ? `    <resource identifier="${quizIdent}" type="imsqti_xmlv1p2">
      <file href="${quizIdent}/${quizIdent}.xml"/>
      <dependency identifierref="${metaIdent}"/>
    </resource>
    <resource identifier="${metaIdent}" type="associatedcontent/imscc_xmlv1p1/learning-application-resource" href="${quizIdent}/assessment_meta.xml">
      <file href="${quizIdent}/assessment_meta.xml"/>
    </resource>`
    : `    <resource identifier="${quizIdent}" type="imsqti_xmlv1p2">
      <file href="${quizIdent}/${quizIdent}.xml"/>
    </resource>`));
  const media = mediaPaths.map((p) => `    <resource identifier="${hashIdent(`media:${p}`).slice(1)}" type="webcontent" href="${xmlEscape(p)}">
      <file href="${xmlEscape(p)}"/>
    </resource>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${randomIdent()}" xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1" xmlns:lom="http://ltsc.ieee.org/xsd/imsccv1p1/LOM/resource" xmlns:imsmd="http://www.imsglobal.org/xsd/imsmd_v1p2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1 http://www.imsglobal.org/xsd/imscp_v1p1.xsd http://ltsc.ieee.org/xsd/imsccv1p1/LOM/resource http://www.imsglobal.org/profile/cc/ccv1p1/LOM/ccv1p1_lomresource_v1p0.xsd http://www.imsglobal.org/xsd/imsmd_v1p2 http://www.imsglobal.org/xsd/imsmd_v1p2p2.xsd">
  <metadata>
    <schema>IMS Content</schema>
    <schemaversion>1.1.3</schemaversion>
    <imsmd:lom>
      <imsmd:general>
        <imsmd:title>
          <imsmd:string>${xmlEscape(packageTitle)}</imsmd:string>
        </imsmd:title>
      </imsmd:general>
      <imsmd:lifeCycle>
        <imsmd:contribute>
          <imsmd:date>
            <imsmd:dateTime>${today}</imsmd:dateTime>
          </imsmd:date>
        </imsmd:contribute>
      </imsmd:lifeCycle>
    </imsmd:lom>
  </metadata>
  <organizations/>
  <resources>
${[...quizzes, ...media].join('\n')}
  </resources>
</manifest>
`;
}

// banks: [{ title, questions }] (see groupIntoBanks).
// options.mode: 'quiz' (default) builds New Quizzes with instructions, text blocks and settings;
//   'bank' builds question banks with just the questions (and the stimuli they belong to).
// options.images: Map imageKey -> { name, data } of image files that rows may reference.
// options.idents: fixed quiz identifiers (tests). Otherwise they are random per export, so each
// import creates new quizzes instead of overwriting earlier ones.
// Returns { files: [{ path, content }], folders, quizzes, unusedImages }.
export function buildCanvasPackage(banks, userSettings = {}, { idents, images, mode = 'quiz' } = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...userSettings };
  const media = createMedia(images);
  const files = [];
  const entries = [];
  banks.forEach((bank, i) => {
    const quizIdent = idents?.[i] ?? randomIdent();
    if (mode === 'bank') {
      entries.push({ quizIdent });
      files.push({ path: `${quizIdent}/${quizIdent}.xml`, content: objectBankXml(bank, quizIdent, settings, media) });
      return;
    }
    const metaIdent = hashIdent(`${quizIdent}:meta`);
    entries.push({ quizIdent, metaIdent });
    files.push({ path: `${quizIdent}/${quizIdent}.xml`, content: assessmentXml(bank, quizIdent, settings, media) });
    files.push({ path: `${quizIdent}/assessment_meta.xml`, content: assessmentMetaXml(bank, quizIdent, settings, media) });
  });
  const mediaFiles = media.files();
  const packageTitle = banks.length === 1 ? banks[0].title : `${banks.length} ${mode === 'bank' ? 'question banks' : 'quizzes'}`;
  files.unshift({ path: 'imsmanifest.xml', content: manifestXml(entries, mediaFiles.map((f) => f.path), packageTitle) });
  files.push(...mediaFiles);
  return {
    files,
    folders: ['non_cc_assessments'],
    quizzes: entries.map((e, i) => ({
      ident: e.quizIdent,
      title: banks[i].title,
      count: mode === 'bank' ? bankQuestions(banks[i].questions).length : banks[i].questions.length,
      points: banks[i].questions.reduce((s, q) => s + questionPoints(q), 0),
    })),
    unusedImages: images ? [...images.keys()].filter((k) => !media.used.has(k)).map((k) => images.get(k).name) : [],
  };
}
