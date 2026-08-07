import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

async function runCli(
  args: string[],
  configRoot: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(
      process.execPath,
      [resolve(process.cwd(), 'src/cli.ts'), ...args],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          XDG_CONFIG_HOME: configRoot,
          NO_COLOR: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => {
      resolveResult({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}

async function writeFixtureSession(configRoot: string, port: number): Promise<void> {
  const sessionDir = join(configRoot, 'ontrack-cli');
  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    join(sessionDir, 'session.json'),
    JSON.stringify({
      baseUrl: `http://127.0.0.1:${port}/api`,
      username: 'fixture-user',
      authToken: 'fixture-token',
      user: { id: 1, username: 'fixture-user' },
      savedAt: '2026-08-08T00:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z',
      source: 'access-token',
      refreshedAt: '2026-08-08T00:00:00.000Z',
    }),
    'utf8',
  );
}

test('agent call pdf.submission gates readiness, writes a validated artifact, and preserves legacy JSON', async () => {
  const configRoot = await mkdtemp(join(tmpdir(), 'ontrack-agent-submission-pdf-'));
  const outputRoot = await mkdtemp(join(tmpdir(), 'ontrack-agent-submission-output-'));
  const legacyOutputRoot = await mkdtemp(join(tmpdir(), 'ontrack-legacy-submission-output-'));
  const pdfBytes = Buffer.from('%PDF-1.7\nfixture submission\n', 'ascii');
  let submissionDetails: unknown = {
    has_pdf: true,
    processing_pdf: false,
    submission_date: '2026-08-08T00:00:00.000Z',
    task_status: 'submitted',
  };
  let pdfResponse = pdfBytes;
  let pdfContentType = 'application/octet-stream';
  let pdfContentDisposition = 'attachment; filename=FIT0001_D4_submission.pdf';
  let submissionDownloadRequests = 0;
  const server = createServer((request, response) => {
    assert.equal(request.headers['auth-token'], 'fixture-token');
    response.setHeader('content-type', 'application/json');
    if (request.url === '/api/projects') {
      response.end(JSON.stringify([{ id: 87, unit_id: 55 }]));
      return;
    }
    if (request.url === '/api/projects/87') {
      response.end(JSON.stringify({ id: 87, unit_id: 55, tasks: [] }));
      return;
    }
    if (request.url === '/api/units/55') {
      response.end(JSON.stringify({
        id: 55,
        code: 'FIT0001',
        task_definitions: [{ id: 501, abbreviation: 'D4', name: 'Design task' }],
      }));
      return;
    }
    if (request.url === '/api/projects/87/task_def_id/501/submission_details') {
      response.end(JSON.stringify(submissionDetails));
      return;
    }
    if (request.url === '/api/projects/87/task_def_id/501/submission?as_attachment=true') {
      submissionDownloadRequests += 1;
      response.setHeader('content-type', pdfContentType);
      response.setHeader('content-disposition', pdfContentDisposition);
      response.end(pdfResponse);
      return;
    }
    response.writeHead(404);
    response.end(JSON.stringify({ error: 'not found' }));
  });

  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    await writeFixtureSession(configRoot, address.port);

    const described = await runCli(['agent', 'describe', 'pdf.submission'], configRoot);
    assert.equal(described.exitCode, 0, described.stderr);
    const describedData = JSON.parse(described.stdout).data as Record<string, unknown>;
    assert.equal(describedData.path, 'pdf.submission');
    assert.match(JSON.stringify(describedData.input_schema), /task_definition_id/);
    assert.equal(JSON.stringify(describedData.input_schema).includes('all_tasks'), false);
    assert.match(JSON.stringify(describedData.output_schema), /pdf_state/);

    const schema = await runCli(['schema', 'pdf.submission'], configRoot);
    assert.equal(schema.exitCode, 0, schema.stderr);
    const schemaData = JSON.parse(schema.stdout) as Record<string, unknown>;
    assert.equal(JSON.stringify(schemaData.input_schema).includes('all_tasks'), true);
    assert.equal(JSON.stringify(schemaData.output_schema).includes('pdf_state'), false);

    const result = await runCli(
      [
        'agent',
        'call',
        'pdf.submission',
        '--input-json',
        JSON.stringify({
          project_id: 87,
          abbreviation: 'D4',
          out_dir: outputRoot,
          allow_external_dir: true,
        }),
      ],
      configRoot,
    );
    assert.equal(result.exitCode, 0, `${result.stderr}\n${result.stdout}`);
    assert.equal(result.stderr, '');
    const envelope = JSON.parse(result.stdout) as Record<string, unknown>;
    assert.equal(envelope.command, 'pdf.submission');
    assert.equal(envelope.status, 'success');
    const data = envelope.data as Record<string, unknown>;
    assert.deepEqual(
      {
        project_id: data.project_id,
        unit_id: data.unit_id,
        unit_code: data.unit_code,
        task_definition_id: data.task_definition_id,
        task_instance_id: data.task_instance_id,
        abbreviation: data.abbreviation,
        instantiated: data.instantiated,
        has_pdf: data.has_pdf,
        processing_pdf: data.processing_pdf,
        pdf_state: data.pdf_state,
        submission_observed: data.submission_observed,
      },
      {
        project_id: 87,
        unit_id: 55,
        unit_code: 'FIT0001',
        task_definition_id: 501,
        task_instance_id: null,
        abbreviation: 'D4',
        instantiated: false,
        has_pdf: true,
        processing_pdf: false,
        pdf_state: 'ready',
        submission_observed: true,
      },
    );
    const artifact = data.artifact as Record<string, unknown>;
    assert.equal(artifact.filename, 'FIT0001_D4_submission.pdf');
    assert.equal(artifact.bytes, pdfBytes.byteLength);
    assert.equal(artifact.content_type, 'application/octet-stream');
    assert.equal(
      artifact.sha256,
      '525b7f5065611dc3d31b6e666887ddd433f858939a985c60afd78b6b9e656bc0',
    );
    const outputPath = join(outputRoot, 'FIT0001_D4_submission.pdf');
    assert.equal(await stat(outputPath).then(() => true), true);
    assert.deepEqual(await readFile(outputPath), pdfBytes);
    assert.equal(result.stdout.includes('fixture-token'), false);
    assert.equal(result.stdout.includes(configRoot), false);

    submissionDetails = { has_pdf: true, processing_pdf: true };
    const processing = await runCli(
      [
        'agent',
        'call',
        'pdf.submission',
        '--input-json',
        JSON.stringify({ project_id: 87, task_definition_id: 501 }),
      ],
      configRoot,
    );
    assert.equal(processing.exitCode, 6, processing.stderr);
    const processingEnvelope = JSON.parse(processing.stdout) as Record<string, unknown>;
    const processingError = processingEnvelope.error as Record<string, unknown>;
    assert.equal(processingError.code, 'CONFLICT');
    assert.equal(processingError.retryable, true);
    assert.deepEqual(processingEnvelope.next_actions, [
      {
        action: 'submission.status',
        arguments: { project_id: 87, task_definition_id: 501 },
      },
    ]);
    assert.equal(submissionDownloadRequests, 1);

    submissionDetails = { has_pdf: false, processing_pdf: false };
    const unavailable = await runCli(
      [
        'agent',
        'call',
        'pdf.submission',
        '--input-json',
        JSON.stringify({ project_id: 87, task_definition_id: 501 }),
      ],
      configRoot,
    );
    assert.equal(unavailable.exitCode, 5, unavailable.stderr);
    assert.equal(
      (JSON.parse(unavailable.stdout).error as Record<string, unknown>).code,
      'NOT_FOUND',
    );
    assert.equal(submissionDownloadRequests, 1);

    submissionDetails = { has_pdf: 'yes', processing_pdf: false };
    const malformedDetails = await runCli(
      [
        'agent',
        'call',
        'pdf.submission',
        '--input-json',
        JSON.stringify({ project_id: 87, task_definition_id: 501 }),
      ],
      configRoot,
    );
    assert.equal(malformedDetails.exitCode, 7, malformedDetails.stderr);
    assert.equal(
      (JSON.parse(malformedDetails.stdout).error as Record<string, unknown>).code,
      'REMOTE_UNAVAILABLE',
    );
    assert.equal(submissionDownloadRequests, 1);

    submissionDetails = { has_pdf: true, processing_pdf: false };
    pdfResponse = Buffer.from('<html>not a PDF</html>', 'ascii');
    const invalidPdf = await runCli(
      [
        'agent',
        'call',
        'pdf.submission',
        '--input-json',
        JSON.stringify({ project_id: 87, task_definition_id: 501 }),
      ],
      configRoot,
    );
    assert.equal(invalidPdf.exitCode, 7, invalidPdf.stderr);
    assert.equal(
      (JSON.parse(invalidPdf.stdout).error as Record<string, unknown>).code,
      'REMOTE_UNAVAILABLE',
    );
    assert.deepEqual(await readFile(outputPath), pdfBytes);

    pdfResponse = pdfBytes;
    pdfContentType = 'application/pdf';
    pdfContentDisposition = 'attachment; filename=FileNotFound.pdf';
    const missingPdf = await runCli(
      [
        'agent',
        'call',
        'pdf.submission',
        '--input-json',
        JSON.stringify({ project_id: 87, task_definition_id: 501 }),
      ],
      configRoot,
    );
    assert.equal(missingPdf.exitCode, 5, missingPdf.stderr);
    assert.equal(
      (JSON.parse(missingPdf.stdout).error as Record<string, unknown>).code,
      'NOT_FOUND',
    );
    assert.deepEqual(await readFile(outputPath), pdfBytes);

    pdfContentDisposition = 'attachment; filename=FIT0001_D4_submission.pdf';
    const legacy = await runCli(
      [
        'pdf',
        'submission',
        '--project-id',
        '87',
        '--task-definition-id',
        '501',
        '--out-dir',
        legacyOutputRoot,
        '--allow-external-dir',
        '--json',
      ],
      configRoot,
    );
    assert.equal(legacy.exitCode, 0, legacy.stderr);
    const legacyData = JSON.parse(legacy.stdout) as Record<string, unknown>;
    assert.equal(legacyData.taskDefinitionId, 501);
    assert.deepEqual(
      await readFile(join(legacyOutputRoot, 'FIT0001_D4_submission.pdf')),
      pdfBytes,
    );

    const compatibilityAgent = await runCli(
      [
        'pdf',
        'submission',
        '--project-id',
        '87',
        '--all-tasks',
        '--out-dir',
        legacyOutputRoot,
        '--allow-external-dir',
        '--output',
        'agent-json',
      ],
      configRoot,
    );
    assert.equal(compatibilityAgent.exitCode, 0, compatibilityAgent.stderr);
    const compatibilityEnvelope = JSON.parse(compatibilityAgent.stdout) as Record<string, unknown>;
    assert.equal(compatibilityEnvelope.command, 'pdf.submission');
    const compatibilityData = compatibilityEnvelope.data as Record<string, unknown>;
    assert.equal(compatibilityData.taskDefinitionId, 501);
    assert.equal('artifact' in compatibilityData, false);
  } finally {
    server.close();
    await rm(configRoot, { recursive: true, force: true });
    await rm(outputRoot, { recursive: true, force: true });
    await rm(legacyOutputRoot, { recursive: true, force: true });
  }
});

test('pdf.submission rejects batch and conflicting selectors before authentication', async () => {
  const configRoot = await mkdtemp(join(tmpdir(), 'ontrack-agent-submission-input-'));
  try {
    for (const input of [
      { project_id: 87, all_tasks: true },
      { project_id: 87, task_definition_id: 501, abbreviation: 'D4' },
    ]) {
      const result = await runCli(
        ['agent', 'call', 'pdf.submission', '--input-json', JSON.stringify(input)],
        configRoot,
      );
      assert.equal(result.exitCode, 2, result.stderr);
      assert.equal(
        (JSON.parse(result.stdout).error as Record<string, unknown>).code,
        'INVALID_ARGUMENT',
      );
    }
  } finally {
    await rm(configRoot, { recursive: true, force: true });
  }
});
