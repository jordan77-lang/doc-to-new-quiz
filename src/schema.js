// Single source of truth for spreadsheet columns, question types and examples.
// The CSV/XLSX templates and the Google Sheets script headers are generated from this file
// (see scripts/build-templates.js), so change columns here and re-run `npm run templates`.

export const MAX_CHOICES = 12;
export const MAX_MATCHING_PAIRS = 6;

const range = (n, fn) => Array.from({ length: n }, (_, i) => fn(i + 1));

export const COLUMNS = [
  'bank_name', 'id', 'type', 'parent_stimulus', 'title', 'question', 'image', 'image_alt', 'points',
  'feedback_general', 'feedback_correct', 'feedback_incorrect', 'tags',
  ...range(MAX_CHOICES, (i) => `choice_${i}`),
  'correct', 'partial_credit',
  'numeric_answer', 'numeric_tolerance', 'numeric_min', 'numeric_max',
  ...range(MAX_MATCHING_PAIRS, (i) => [`matching_left_${i}`, `matching_right_${i}`]).flat(),
  'matching_distractors',
  'upload_file_types', 'upload_max_files',
  // Experimental (QTI 2.1 output only)
  'correct_order',
  ...range(MAX_CHOICES, (i) => `category_${i}`),
];

// Question types New Quizzes imports from Canvas QTI 1.2, mapped to their Canvas question_type.
export const CANVAS_TYPES = {
  multiple_choice: 'multiple_choice_question',
  multiple_answer: 'multiple_answers_question',
  true_false: 'true_false_question',
  short_answer: 'short_answer_question',
  numeric: 'numerical_question',
  matching: 'matching_question',
  essay: 'essay_question',
  file_upload: 'file_upload_question',
  text_only: 'text_only_question',
  // New Quizzes stimulus: a text item (passage=false) that questions point to via parent_stimulus.
  stimulus: 'text_only_question',
};

// Types that carry no score.
export const UNSCORED_TYPES = ['text_only', 'stimulus'];

// Only exported by the experimental QTI 2.1 builder.
export const EXPERIMENTAL_TYPES = ['ordering', 'categorization', 'hotspot'];

export const TYPE_LABELS = {
  multiple_choice: 'Multiple choice',
  multiple_answer: 'Multiple answers',
  true_false: 'True/False',
  short_answer: 'Short answer (fill in the blank)',
  numeric: 'Numerical',
  matching: 'Matching',
  essay: 'Essay',
  file_upload: 'File upload',
  text_only: 'Text (no question)',
  stimulus: 'Stimulus (groups the questions that name it)',
  ordering: 'Ordering (experimental)',
  categorization: 'Categorization (experimental)',
  hotspot: 'Hotspot (experimental)',
};

// Accepted spellings for the `type` column, after lower-casing and turning spaces,
// hyphens and slashes into underscores.
export const TYPE_ALIASES = {
  multiple_choice: ['mc', 'multiple_choice', 'multiplechoice', 'multiple_choice_question', 'choice'],
  multiple_answer: ['ma', 'multiple_answer', 'multiple_answers', 'multiple_answers_question', 'select_all', 'select_all_that_apply', 'checkbox'],
  true_false: ['tf', 'true_false', 'truefalse', 'true_false_question', 't_f'],
  short_answer: ['sa', 'short_answer', 'short_answer_question', 'fill_in_the_blank', 'fill_in_blank', 'fitb', 'fib'],
  numeric: ['numeric', 'numerical', 'number', 'numerical_question'],
  matching: ['matching', 'match', 'matching_question'],
  essay: ['essay', 'essay_question', 'long_answer', 'free_response'],
  file_upload: ['file_upload', 'upload', 'file', 'file_upload_question'],
  text_only: ['text_only', 'text', 'text_only_question', 'instructions', 'passage'],
  stimulus: ['stimulus', 'stimulus_group', 'case', 'scenario'],
  ordering: ['ordering', 'order', 'sequence'],
  categorization: ['categorization', 'categorize', 'category'],
  hotspot: ['hotspot', 'hot_spot'],
};

export const EXAMPLE_ROWS = [
  {
    bank_name: 'Demo Bank', id: 'q1', type: 'multiple_choice', title: 'Addition', question: 'What is 2 + 2?', points: 1,
    feedback_correct: 'Correct!', feedback_incorrect: 'Count again.', tags: 'math',
    choice_1: '3', choice_2: '4', choice_3: '5', choice_4: '22', correct: 'choice_2',
  },
  {
    bank_name: 'Demo Bank', id: 'q2', type: 'multiple_answer', title: 'Primes', question: 'Select all of the prime numbers.', points: 2,
    feedback_correct: 'Good picks!', feedback_incorrect: 'A prime has exactly two factors.', tags: 'math',
    choice_1: '2', choice_2: '3', choice_3: '4', choice_4: '5', choice_5: '6', choice_6: '9', correct: 'choice_1;choice_2;choice_4',
  },
  {
    bank_name: 'Demo Bank', id: 'q3', type: 'true_false', title: 'Water', question: 'Water boils at 100 °C at sea level.', points: 1,
    feedback_correct: 'Correct.', feedback_incorrect: 'It does boil at 100 °C at 1 atm.', tags: 'science',
    correct: 'true',
  },
  {
    bank_name: 'Demo Bank', id: 'q4', type: 'short_answer', title: 'Symbol', question: 'What is the chemical symbol for sodium?', points: 1,
    feedback_correct: 'Yes, from the Latin natrium.', tags: 'chemistry',
    correct: 'Na;na',
  },
  {
    bank_name: 'Demo Bank', id: 'q5', type: 'numeric', title: 'Exact with tolerance', question: 'What is pi to two decimal places?', points: 1,
    feedback_correct: 'Great.', feedback_incorrect: 'Pi is about 3.14.', tags: 'math',
    numeric_answer: 3.14, numeric_tolerance: 0.005,
  },
  {
    bank_name: 'Demo Bank', id: 'q6', type: 'numeric', title: 'Range', question: 'Enter any number between 5 and 7.', points: 1,
    tags: 'math', numeric_min: 5, numeric_max: 7,
  },
  {
    bank_name: 'Demo Bank', id: 'q7', type: 'matching', title: 'Capitals', question: 'Match each country to its capital.', points: 3,
    feedback_correct: 'Well done.', feedback_incorrect: 'Check the pairs.', tags: 'geography',
    matching_left_1: 'France', matching_right_1: 'Paris',
    matching_left_2: 'Japan', matching_right_2: 'Tokyo',
    matching_left_3: 'Canada', matching_right_3: 'Ottawa',
    matching_distractors: 'Sydney;Toronto',
  },
  {
    bank_name: 'Demo Bank', id: 'q8', type: 'essay', title: 'Reflection', question: 'Describe your study plan for the next exam.', points: 5,
    feedback_general: 'Thanks. I will review this before our next meeting.', tags: 'writing',
  },
  {
    bank_name: 'Demo Bank', id: 'q9', type: 'file_upload', title: 'Worksheet', question: 'Upload a PDF of your completed worksheet.', points: 5,
    tags: 'files', upload_file_types: 'PDF', upload_max_files: 1,
  },
  {
    bank_name: 'Demo Bank', id: 'q10', type: 'text_only', title: 'Section 2', question: '<h2>Section 2</h2><p>The next questions use the price table below.</p>',
    points: 0,
  },
  {
    bank_name: 'Demo Bank', id: 's1', type: 'stimulus', title: 'Lemonade stand',
    question: 'A lemonade stand sells 40 cups a day at $2 each. Its fixed cost is $30 a day and each cup costs $0.50 to make.',
    points: 0,
  },
  {
    bank_name: 'Demo Bank', id: 'q11', type: 'numeric', parent_stimulus: 's1', title: 'Daily profit', question: 'What is the daily profit, in dollars?', points: 2,
    numeric_answer: 30, numeric_tolerance: 0.01, feedback_general: 'Profit = 40 × (2 − 0.50) − 30 = 30.',
  },
  {
    bank_name: 'Demo Bank', id: 'q12', type: 'multiple_answer', parent_stimulus: 's1', title: 'Fixed costs', question: 'Which of these are fixed costs for the stand?', points: 2,
    choice_1: 'Permit fee', choice_2: 'Lemons', choice_3: 'Stand rental', choice_4: 'Cups', correct: 'choice_1;choice_3', partial_credit: 'true',
  },
];
