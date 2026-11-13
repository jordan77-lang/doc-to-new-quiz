// EXPERIMENTAL: generic IMS QTI 2.1 package.
// Canvas's QTI 2.1 import support is limited and undocumented. Prefer the Canvas QTI 1.2 package
// (canvasQti.js) and import it with "Import existing quizzes as New Quizzes" for New Quizzes.
// This builder is kept for ordering / categorization / hotspot items, which QTI 1.2 cannot express.

import { xmlEscape, randomIdent, stripHtml } from './util.js';
import { numericRule } from './canvasQti.js';

const NS = 'http://www.imsglobal.org/xsd/imsqti_v2p1';

const p = (text) => `<p>${xmlEscape(stripHtml(text))}</p>`;
const safeFile = (id) => String(id).replace(/[^A-Za-z0-9_.-]+/g, '_');
const ident = (id) => `I_${safeFile(id)}`;

function wrap(q, inner) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<assessmentItem xmlns="${NS}" identifier="${xmlEscape(ident(q.id))}" title="${xmlEscape(q.title)}" adaptive="false" timeDependent="false">
${inner}
</assessmentItem>
`;
}

const score = (points) => `<outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float" normalMaximum="${points}"/>`;

const matchCorrect = (points) => `  <responseProcessing>
    <responseCondition>
      <responseIf>
        <match>
          <variable identifier="RESPONSE"/>
          <correctResponse identifier="RESPONSE"/>
        </match>
        <setOutcomeValue identifier="SCORE"><baseValue baseType="float">${points}</baseValue></setOutcomeValue>
      </responseIf>
      <responseElse>
        <setOutcomeValue identifier="SCORE"><baseValue baseType="float">0</baseValue></setOutcomeValue>
      </responseElse>
    </responseCondition>
  </responseProcessing>`;

const zeroScore = '  <responseProcessing>\n    <setOutcomeValue identifier="SCORE"><baseValue baseType="float">0</baseValue></setOutcomeValue>\n  </responseProcessing>';

function itemXml(q) {
  switch (q.type) {
    case 'text_only':
    case 'stimulus':
      return wrap(q, `  <itemBody>\n    ${p(q.question)}\n  </itemBody>`);

    case 'essay':
    case 'file_upload':
      return wrap(q, `  <responseDeclaration identifier="RESPONSE" cardinality="single" baseType="${q.type === 'essay' ? 'string' : 'file'}"/>
  ${score(q.points)}
  <itemBody>
    ${p(q.question)}
    ${q.type === 'essay' ? '<extendedTextInteraction responseIdentifier="RESPONSE" expectedLength="250"/>' : '<uploadInteraction responseIdentifier="RESPONSE"/>'}
  </itemBody>
${zeroScore}`);

    case 'short_answer':
      return wrap(q, `  <responseDeclaration identifier="RESPONSE" cardinality="single" baseType="string">
    <correctResponse>
${q.answers.map((a) => `      <value>${xmlEscape(a)}</value>`).join('\n')}
    </correctResponse>
    <mapping defaultValue="0">
${q.answers.map((a) => `      <mapEntry mapKey="${xmlEscape(a)}" mappedValue="${q.points}" caseSensitive="false"/>`).join('\n')}
    </mapping>
  </responseDeclaration>
  ${score(q.points)}
  <itemBody>
    ${p(q.question)}
    <p><textEntryInteraction responseIdentifier="RESPONSE" expectedLength="32"/></p>
  </itemBody>
  <responseProcessing>
    <setOutcomeValue identifier="SCORE"><mapResponse identifier="RESPONSE"/></setOutcomeValue>
  </responseProcessing>`);

    case 'numeric': {
      const { low, high } = numericRule(q.numeric);
      return wrap(q, `  <responseDeclaration identifier="RESPONSE" cardinality="single" baseType="float"/>
  ${score(q.points)}
  <itemBody>
    ${p(q.question)}
    <p><textEntryInteraction responseIdentifier="RESPONSE" expectedLength="32"/></p>
  </itemBody>
  <responseProcessing>
    <responseCondition>
      <responseIf>
        <and>
          <gte><variable identifier="RESPONSE"/><baseValue baseType="float">${low}</baseValue></gte>
          <lte><variable identifier="RESPONSE"/><baseValue baseType="float">${high}</baseValue></lte>
        </and>
        <setOutcomeValue identifier="SCORE"><baseValue baseType="float">${q.points}</baseValue></setOutcomeValue>
      </responseIf>
      <responseElse>
        <setOutcomeValue identifier="SCORE"><baseValue baseType="float">0</baseValue></setOutcomeValue>
      </responseElse>
    </responseCondition>
  </responseProcessing>`);
    }

    case 'matching':
    case 'categorization': {
      const pairs = q.type === 'categorization'
        ? q.categories.map((c) => ({ left: q.choices.find((ch) => ch.id === c.choiceId)?.text || c.choiceId, right: c.category }))
        : q.matchingPairs;
      const left = pairs.map((pr, i) => ({ id: `L${i + 1}`, text: pr.left }));
      const rightTexts = [...new Set([...pairs.map((pr) => pr.right), ...(q.type === 'matching' ? q.distractors : [])])];
      const right = rightTexts.map((text, i) => ({ id: `R${i + 1}`, text }));
      const correct = pairs.map((pr, i) => `${left[i].id} ${right.find((r) => r.text === pr.right).id}`);
      const each = q.points / Math.max(1, correct.length);
      return wrap(q, `  <responseDeclaration identifier="RESPONSE" cardinality="multiple" baseType="directedPair">
    <correctResponse>
${correct.map((c) => `      <value>${c}</value>`).join('\n')}
    </correctResponse>
    <mapping defaultValue="0">
${correct.map((c) => `      <mapEntry mapKey="${c}" mappedValue="${each}"/>`).join('\n')}
    </mapping>
  </responseDeclaration>
  ${score(q.points)}
  <itemBody>
    ${p(q.question)}
    <matchInteraction responseIdentifier="RESPONSE" shuffle="false" maxAssociations="${correct.length}">
      <simpleMatchSet>
${left.map((c) => `        <simpleAssociableChoice identifier="${c.id}" matchMax="1">${xmlEscape(c.text)}</simpleAssociableChoice>`).join('\n')}
      </simpleMatchSet>
      <simpleMatchSet>
${right.map((c) => `        <simpleAssociableChoice identifier="${c.id}" matchMax="${left.length}">${xmlEscape(c.text)}</simpleAssociableChoice>`).join('\n')}
      </simpleMatchSet>
    </matchInteraction>
  </itemBody>
  <responseProcessing>
    <setOutcomeValue identifier="SCORE"><mapResponse identifier="RESPONSE"/></setOutcomeValue>
  </responseProcessing>`);
    }

    case 'ordering':
      return wrap(q, `  <responseDeclaration identifier="RESPONSE" cardinality="ordered" baseType="identifier">
    <correctResponse>
${q.orderedIds.map((id) => `      <value>${id}</value>`).join('\n')}
    </correctResponse>
  </responseDeclaration>
  ${score(q.points)}
  <itemBody>
    ${p(q.question)}
    <orderInteraction responseIdentifier="RESPONSE" shuffle="true">
${q.choices.map((c) => `      <simpleChoice identifier="${c.id}">${xmlEscape(c.text)}</simpleChoice>`).join('\n')}
    </orderInteraction>
  </itemBody>
${matchCorrect(q.points)}`);

    case 'hotspot':
      return wrap(q, `  <responseDeclaration identifier="RESPONSE" cardinality="multiple" baseType="identifier">
    <correctResponse>
${q.hotspots.map((_, i) => `      <value>HS${i + 1}</value>`).join('\n')}
    </correctResponse>
  </responseDeclaration>
  ${score(q.points)}
  <itemBody>
    ${p(q.question)}
    <hotspotInteraction responseIdentifier="RESPONSE" maxChoices="${q.hotspots.length}">
      <object type="image/png" data="media/${xmlEscape(q.imageFile || 'image.png')}"/>
${q.hotspots.map((c, i) => `      <hotspotChoice identifier="HS${i + 1}" shape="rect" coords="${c.join(',')}"/>`).join('\n')}
    </hotspotInteraction>
  </itemBody>
${matchCorrect(q.points)}`);

    default: {
      // multiple_choice, multiple_answer, true_false
      const multiple = q.type === 'multiple_answer';
      const decl = multiple
        ? `  <responseDeclaration identifier="RESPONSE" cardinality="multiple" baseType="identifier">
    <correctResponse>
${q.correct.map((id) => `      <value>${id}</value>`).join('\n')}
    </correctResponse>
  </responseDeclaration>`
        : `  <responseDeclaration identifier="RESPONSE" cardinality="single" baseType="identifier">
    <correctResponse><value>${q.correct[0]}</value></correctResponse>
  </responseDeclaration>`;
      return wrap(q, `${decl}
  ${score(q.points)}
  <itemBody>
    ${p(q.question)}
    <choiceInteraction responseIdentifier="RESPONSE" shuffle="false" maxChoices="${multiple ? q.choices.length : 1}">
${q.choices.map((c) => `      <simpleChoice identifier="${c.id}">${xmlEscape(c.text)}</simpleChoice>`).join('\n')}
    </choiceInteraction>
  </itemBody>
${matchCorrect(q.points)}`);
    }
  }
}

export function buildQti21Package(banks) {
  const files = [];
  const resources = [];
  const tests = [];
  banks.forEach((bank, b) => {
    const refs = bank.questions.map((q) => {
      const href = `items/b${b + 1}_${safeFile(q.id)}.xml`;
      const resId = `RES_${randomIdent()}`;
      files.push({ path: href, content: itemXml(q) });
      resources.push(`    <resource identifier="${resId}" type="imsqti_item_xmlv2p1" href="${href}">\n      <file href="${href}"/>\n    </resource>`);
      return { q, href, resId };
    });
    const testHref = `assessment_${b + 1}.xml`;
    const testId = randomIdent();
    files.push({
      path: testHref,
      content: `<?xml version="1.0" encoding="UTF-8"?>
<assessmentTest xmlns="${NS}" identifier="${testId}" title="${xmlEscape(bank.title)}">
  <testPart identifier="P1" navigationMode="nonlinear" submissionMode="individual">
    <assessmentSection identifier="S1" title="${xmlEscape(bank.title)}" visible="true">
${refs.map((r) => `      <assessmentItemRef identifier="${xmlEscape(ident(r.q.id))}" href="${r.href}"/>`).join('\n')}
    </assessmentSection>
  </testPart>
</assessmentTest>
`,
    });
    tests.push(`    <resource identifier="RES_${testId}" type="imsqti_test_xmlv2p1" href="${testHref}">
      <file href="${testHref}"/>
${refs.map((r) => `      <dependency identifierref="${r.resId}"/>`).join('\n')}
    </resource>`);
  });
  files.unshift({
    path: 'imsmanifest.xml',
    content: `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${randomIdent()}" xmlns="http://www.imsglobal.org/xsd/imscp_v1p1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.imsglobal.org/xsd/imscp_v1p1 http://www.imsglobal.org/xsd/imscp_v1p1.xsd">
  <organizations/>
  <resources>
${[...tests, ...resources].join('\n')}
  </resources>
</manifest>
`,
  });
  return { files, folders: [] };
}
