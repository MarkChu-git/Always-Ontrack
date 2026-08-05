import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  createSubmissionAttempt,
  InvalidSubmissionDetailsError,
  isSubmissionObserved,
  parseSubmissionDetails,
  parseStrictSubmissionDetails,
  prepareSubmission,
  transitionSubmissionAttempt,
  validateSubmissionMode,
} from '../src/lib/submission-lifecycle.js';
import { buildStudentTaskViews } from '../src/lib/student-task-view.js';
import type { ProjectSummary } from '../src/lib/types.js';

function submissionTask() {
  const projects: ProjectSummary[] = [
    {
      id: 101,
      target_grade: 0,
      tasks: [],
      unit: {
        id: 55,
        task_definitions: [
          {
            id: 501,
            abbreviation: 'P1',
            target_grade: 0,
            upload_requirements: [
              { key: 'file0', label: 'Report' },
              { key: 'file1', label: 'Evidence' },
            ],
          },
        ],
      },
    },
  ];
  return buildStudentTaskViews(projects)[0];
}

test('parseSubmissionDetails exposes PDF processing and task status semantics', () => {
  assert.deepEqual(
    parseSubmissionDetails({
      has_pdf: true,
      processing_pdf: true,
      submission_date: '2026-07-31T10:00:00Z',
      task_status: 'ready_for_feedback',
    }),
    {
      hasPdf: true,
      processingPdf: true,
      pdfState: 'processing',
      submissionDate: '2026-07-31T10:00:00Z',
      taskStatus: 'ready_for_feedback',
    },
  );
});

test('strict submission details normalize observed aliases and ignore unrelated remote fields', () => {
  assert.deepEqual(
    parseStrictSubmissionDetails({
      hasPdf: true,
      has_pdf: true,
      processingPdf: true,
      processing_pdf: true,
      submissionDate: null,
      submission_date: null,
      taskStatus: ' ready_for_feedback ',
      task_status: 'ready_for_feedback',
      auth_token: 'must-not-project',
    }),
    {
      hasPdf: true,
      processingPdf: true,
      pdfState: 'processing',
      submissionDate: undefined,
      taskStatus: 'ready_for_feedback',
    },
  );

  assert.deepEqual(
    parseStrictSubmissionDetails({
      has_pdf: false,
      processing_pdf: false,
    }),
    {
      hasPdf: false,
      processingPdf: false,
      pdfState: 'unavailable',
      submissionDate: undefined,
      taskStatus: undefined,
    },
  );
});

test('strict submission details fail closed on drift and terminal control characters', () => {
  const malformedPayloads = [
    null,
    [],
    {},
    { has_pdf: 'true', processing_pdf: false },
    { has_pdf: true, hasPdf: false, processing_pdf: false },
    { has_pdf: true, processing_pdf: false, processingPdf: true },
    {
      has_pdf: true,
      processing_pdf: false,
      submission_date: '2030-01-01T00:00:00.000Z',
      submissionDate: null,
    },
    { has_pdf: true, processing_pdf: false, task_status: 'working\n' },
    {
      has_pdf: true,
      processing_pdf: false,
      submission_date: '\t2030-01-01T00:00:00.000Z',
    },
    { has_pdf: true, processing_pdf: false, task_status: 'x'.repeat(81) },
  ];

  for (const payload of malformedPayloads) {
    assert.throws(
      () => parseStrictSubmissionDetails(payload),
      InvalidSubmissionDetailsError,
    );
  }
});

test('prepareSubmission validates and orders evidence slots', () => {
  const prepared = prepareSubmission(submissionTask(), [
    { key: 'file1', localPath: '/private/evidence.png', size: 20 },
    { localPath: '/private/report.pdf', size: 100 },
  ]);

  assert.deepEqual(
    prepared.files.map((file) => [file.key, file.localPath]),
    [
      ['file0', '/private/report.pdf'],
      ['file1', '/private/evidence.png'],
    ],
  );
  assert.equal(prepared.reference.taskDefinitionId, 501);
});

test('prepareSubmission rejects missing, duplicate, and unknown evidence slots', () => {
  assert.throws(
    () =>
      prepareSubmission(submissionTask(), [
        { key: 'file0', localPath: '/tmp/a.pdf', size: 1 },
      ]),
    /expects 2 evidence file/,
  );
  assert.throws(
    () =>
      prepareSubmission(submissionTask(), [
        { key: 'file0', localPath: '/tmp/a.pdf', size: 1 },
        { key: 'file0', localPath: '/tmp/b.pdf', size: 1 },
      ]),
    /Duplicate evidence slot/,
  );
  assert.throws(
    () =>
      prepareSubmission(submissionTask(), [
        { key: 'unknown', localPath: '/tmp/a.pdf', size: 1 },
        { localPath: '/tmp/b.pdf', size: 1 },
      ]),
    /Unknown evidence slot/,
  );
});

test('submission attempt distinguishes rejection, transport uncertainty, acceptance, and observation', () => {
  const prepared = prepareSubmission(submissionTask(), [
    { localPath: '/tmp/report.pdf', size: 100 },
    { localPath: '/tmp/evidence.png', size: 20 },
  ]);
  const attempt = createSubmissionAttempt(prepared, {
    operationId: 'operation-1',
    at: '2026-07-31T10:00:00.000Z',
  });
  const uploading = transitionSubmissionAttempt(attempt, {
    type: 'upload_started',
    at: '2026-07-31T10:01:00.000Z',
  });
  const unknown = transitionSubmissionAttempt(uploading, {
    type: 'upload_outcome_unknown',
    at: '2026-07-31T10:02:00.000Z',
  });
  const rejected = transitionSubmissionAttempt(uploading, {
    type: 'upload_rejected',
    at: '2026-07-31T10:02:00.000Z',
  });
  const accepted = transitionSubmissionAttempt(uploading, {
    type: 'upload_accepted',
    at: '2026-07-31T10:02:00.000Z',
  });
  const succeeded = transitionSubmissionAttempt(accepted, {
    type: 'submission_observed',
    at: '2026-07-31T10:03:00.000Z',
  });

  assert.equal(attempt.state, 'prepared');
  assert.equal(uploading.state, 'uploading');
  assert.equal(unknown.state, 'unknown');
  assert.equal(rejected.state, 'failed');
  assert.equal(accepted.state, 'accepted');
  assert.equal(succeeded.state, 'succeeded');
  assert.notEqual(attempt.journal, uploading.journal);
});

test('upload-new-files requires an observed existing submission while a first upload does not', () => {
  const unavailable = parseSubmissionDetails({
    has_pdf: false,
    processing_pdf: false,
    task_status: 'working_on_it',
  });
  const existing = parseSubmissionDetails({
    has_pdf: true,
    processing_pdf: false,
    submission_date: '2026-07-31T10:00:00Z',
    task_status: 'ready_for_feedback',
  });

  assert.doesNotThrow(() => validateSubmissionMode('upload', unavailable));
  assert.throws(
    () => validateSubmissionMode('upload-new-files', unavailable),
    /existing submission/i,
  );
  assert.doesNotThrow(() =>
    validateSubmissionMode('upload-new-files', existing),
  );
  const submitted = parseStrictSubmissionDetails({
    has_pdf: false,
    processing_pdf: false,
    task_status: 'submitted',
  });
  const processing = parseStrictSubmissionDetails({
    has_pdf: false,
    processing_pdf: false,
    task_status: 'processing',
  });
  assert.equal(isSubmissionObserved(unavailable), false);
  assert.equal(isSubmissionObserved(existing), true);
  assert.equal(isSubmissionObserved(submitted), true);
  assert.equal(isSubmissionObserved(processing), true);
});

test('submission cancellation is local-only before dispatch and forbidden while uploading', () => {
  const attempt = createSubmissionAttempt(
    prepareSubmission(submissionTask(), [
      { localPath: '/tmp/report.pdf', size: 100 },
      { localPath: '/tmp/evidence.png', size: 20 },
    ]),
    {
      operationId: 'operation-2',
      at: '2026-07-31T10:00:00.000Z',
    },
  );

  const cancelled = transitionSubmissionAttempt(attempt, {
    type: 'cancel',
    at: '2026-07-31T10:00:30.000Z',
  });
  assert.equal(cancelled.state, 'cancelled');

  const uploading = transitionSubmissionAttempt(attempt, {
    type: 'upload_started',
    at: '2026-07-31T10:01:00.000Z',
  });
  assert.throws(
    () =>
      transitionSubmissionAttempt(uploading, {
        type: 'cancel',
        at: '2026-07-31T10:01:30.000Z',
      }),
    /cannot be cancelled after dispatch/i,
  );
});

test('attempt journal contains no local paths, filenames, comments, or identity fields', () => {
  const attempt = createSubmissionAttempt(
    prepareSubmission(submissionTask(), [
      { localPath: '/Users/student/private-report.pdf', size: 100 },
      { localPath: '/Users/student/evidence.png', size: 20 },
    ]),
    {
      operationId: 'operation-3',
      at: '2026-07-31T10:00:00.000Z',
    },
  );

  const serialized = JSON.stringify(attempt.journal);
  assert.equal(serialized.includes('/Users/student'), false);
  assert.equal(serialized.includes('private-report.pdf'), false);
  assert.equal(serialized.includes('username'), false);
  assert.equal(serialized.includes('email'), false);
  assert.equal(serialized.includes('comment'), false);
});
