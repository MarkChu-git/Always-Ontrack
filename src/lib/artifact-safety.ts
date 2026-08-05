import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import type { FileHandle } from 'node:fs/promises';

/** Keep local evidence reads bounded before they enter multipart memory. */
export const MAX_UPLOAD_FILE_BYTES = 50 * 1024 * 1024;

/** Keep binary downloads bounded before they are persisted as artifacts. */
export const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const ENCODED_CONTROL_CHARACTER = /%(?:0[0-9a-f]|1[0-9a-f]|7f)/iu;
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

export interface ArtifactPathOptions {
  readonly root: string;
  readonly allowExternal?: boolean;
}

export interface SafeUploadFile {
  readonly absolutePath: string;
  readonly filename: string;
  readonly size: number;
}

export interface ArtifactOutputOptions extends ArtifactPathOptions {
  readonly outDir?: string;
  readonly maxBytes?: number;
}

/** Typed, path-free failure that callers may safely surface to humans or Agents. */
export class ArtifactSafetyError extends Error {
  override readonly name = 'ArtifactSafetyError';
}

function pathError(message: string): Error {
  return new ArtifactSafetyError(`Artifact path rejected: ${message}`);
}

function assertCleanPathInput(rawPath: string): string {
  const value = rawPath.trim();
  if (!value) {
    throw pathError('path must not be empty.');
  }
  if (CONTROL_CHARACTER.test(value) || ENCODED_CONTROL_CHARACTER.test(value)) {
    throw pathError('path must not contain control characters.');
  }
  return value;
}

function isWithinRoot(candidate: string, root: string): boolean {
  const relativePath = relative(root, candidate);
  return (
    relativePath === '' ||
    (!relativePath.startsWith(`..${sep}`) && relativePath !== '..' && !isAbsolute(relativePath))
  );
}

/** Resolve a local artifact path and enforce the workspace boundary by default. */
export function resolveArtifactPath(
  rawPath: string,
  options: ArtifactPathOptions,
): string {
  const value = assertCleanPathInput(rawPath);
  const root = resolve(options.root);
  const candidate = resolve(root, value);
  if (!options.allowExternal && !isWithinRoot(candidate, root)) {
    throw pathError('path must remain inside the workspace boundary.');
  }
  return candidate;
}

/** Return the caller-supplied paths that resolve outside the selected workspace. */
export function findExternalArtifactPaths(
  rawPaths: readonly string[],
  root: string,
): string[] {
  const resolvedRoot = resolve(root);
  return rawPaths.filter((rawPath) => {
    const candidate = resolveArtifactPath(rawPath, {
      root: resolvedRoot,
      allowExternal: true,
    });
    return !isWithinRoot(candidate, resolvedRoot);
  });
}

async function scanForSymbolicLinkComponents(
  absolutePath: string,
  trustedRoot: string,
  allowFilesystemRootAlias: boolean = false,
): Promise<void> {
  let current = trustedRoot;
  const segments = absolutePath
    .slice(trustedRoot.length)
    .split(sep)
    .filter(Boolean);

  for (const segment of segments) {
    current = join(current, segment);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) {
        if (
          allowFilesystemRootAlias &&
          resolve(dirname(current)) === resolve(trustedRoot)
        ) {
          const canonicalAlias = await realpath(current);
          await scanForSymbolicLinkComponents(canonicalAlias, trustedRoot);
          continue;
        }
        throw pathError('path contains a symbolic link component.');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw error;
    }
  }
}

/** Reject symlink components so local reads and writes do not escape the chosen path. */
export async function assertNoSymbolicLinkComponents(
  absolutePath: string,
  trustedRoot?: string,
): Promise<void> {
  const candidate = resolve(absolutePath);
  if (!trustedRoot) {
    const filesystemRoot = parse(candidate).root;
    await scanForSymbolicLinkComponents(candidate, filesystemRoot, true);
    return;
  }

  const root = resolve(trustedRoot);
  const relativePath = relative(root, candidate);
  if (relativePath.startsWith(`..${sep}`) || relativePath === '..' || isAbsolute(relativePath)) {
    throw pathError('path must remain inside the workspace boundary.');
  }
  const canonicalRoot = await realpath(root);
  await scanForSymbolicLinkComponents(join(canonicalRoot, relativePath), canonicalRoot);
}

async function openRegularFile(
  absolutePath: string,
  maxBytes: number,
  trustedRoot?: string,
): Promise<SafeUploadFile> {
  await assertNoSymbolicLinkComponents(absolutePath, trustedRoot);
  const handle = await open(absolutePath, constants.O_RDONLY | NOFOLLOW);
  try {
    const info = await handle.stat();
    await verifyOpenedPath(handle, absolutePath, trustedRoot);
    if (!info.isFile()) {
      throw pathError('upload input must be a regular file.');
    }
    if (info.nlink > 1) {
      throw pathError('upload input must not be a hard link.');
    }
    if (info.size > maxBytes) {
      throw pathError(`upload file exceeds maximum allowed size of ${maxBytes} bytes.`);
    }
    return {
      absolutePath,
      filename: basename(absolutePath),
      size: info.size,
    };
  } finally {
    await handle.close();
  }
}

async function readBoundedFile(
  handle: FileHandle,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  let position = 0;
  const chunkSize = Math.min(64 * 1024, maxBytes + 1);
  while (true) {
    const buffer = Buffer.allocUnsafe(chunkSize);
    const result = await handle.read(buffer, 0, buffer.length, position);
    if (result.bytesRead === 0) {
      break;
    }
    total += result.bytesRead;
    position += result.bytesRead;
    chunks.push(buffer.subarray(0, result.bytesRead));
    if (total > maxBytes) {
      throw pathError(`upload file exceeds maximum allowed size of ${maxBytes} bytes.`);
    }
  }
  return Buffer.concat(chunks, total);
}

function sameFileIdentity(
  left: { readonly dev: number; readonly ino: number },
  right: { readonly dev: number; readonly ino: number },
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

/** Verify the opened inode still corresponds to the checked path before I/O. */
async function verifyOpenedPath(
  handle: FileHandle,
  absolutePath: string,
  trustedRoot?: string,
): Promise<void> {
  await assertNoSymbolicLinkComponents(absolutePath, trustedRoot);
  const opened = await handle.stat();
  const current = await lstat(absolutePath);
  if (current.isSymbolicLink() || !sameFileIdentity(opened, current)) {
    throw pathError('path changed while it was being opened.');
  }
  if (trustedRoot) {
    const canonicalRoot = await realpath(resolve(trustedRoot));
    const canonicalPath = await realpath(absolutePath);
    if (!isWithinRoot(canonicalPath, canonicalRoot)) {
      throw pathError('path changed outside the workspace boundary.');
    }
  }
}

/** Inspect a local upload without reading its bytes. */
export async function inspectUploadFile(
  rawPath: string,
  options: ArtifactPathOptions & { readonly maxBytes?: number },
): Promise<SafeUploadFile> {
  const absolutePath = resolveArtifactPath(rawPath, options);
  return openRegularFile(
    absolutePath,
    options.maxBytes ?? MAX_UPLOAD_FILE_BYTES,
    options.allowExternal ? undefined : options.root,
  );
}

/** Read an inspected upload again through a no-follow, bounded file handle. */
export async function readUploadFile(
  file: SafeUploadFile,
  options: { readonly maxBytes?: number; readonly trustedRoot?: string } = {},
): Promise<Buffer> {
  const maxBytes = options.maxBytes ?? MAX_UPLOAD_FILE_BYTES;
  await assertNoSymbolicLinkComponents(file.absolutePath, options.trustedRoot);
  const handle = await open(file.absolutePath, constants.O_RDONLY | NOFOLLOW);
  try {
    const info = await handle.stat();
    await verifyOpenedPath(handle, file.absolutePath, options.trustedRoot);
    if (!info.isFile()) {
      throw pathError('upload input must be a regular file.');
    }
    if (info.nlink > 1) {
      throw pathError('upload input must not be a hard link.');
    }
    const content = await readBoundedFile(handle, maxBytes);
    return content;
  } finally {
    await handle.close();
  }
}

/** Inspect and read one upload at the same safety boundary. */
export async function readUploadArtifact(
  rawPath: string,
  options: ArtifactPathOptions & { readonly maxBytes?: number },
): Promise<SafeUploadFile & { readonly content: Buffer }> {
  const file = await inspectUploadFile(rawPath, options);
  return {
    ...file,
    content: await readUploadFile(file, {
      maxBytes: options.maxBytes,
      trustedRoot: options.allowExternal ? undefined : options.root,
    }),
  };
}

function assertSafeFilename(filename: string): void {
  if (
    !filename ||
    filename === '.' ||
    filename === '..' ||
    basename(filename) !== filename ||
    filename.includes('/') ||
    filename.includes('\\') ||
    CONTROL_CHARACTER.test(filename)
  ) {
    throw pathError('artifact filename must be a single safe path segment.');
  }
}

async function prepareOutputDirectory(options: ArtifactOutputOptions): Promise<string> {
  const dir = resolveArtifactPath(options.outDir ?? './downloads', options);
  const trustedRoot = options.allowExternal ? undefined : options.root;
  await assertNoSymbolicLinkComponents(dir, trustedRoot);
  await mkdir(dir, { recursive: true });
  await assertNoSymbolicLinkComponents(dir, trustedRoot);
  return dir;
}

/** Persist a bounded artifact without following symlinked directories or files. */
export async function writeArtifactFile(
  buffer: Uint8Array,
  filename: string,
  options: ArtifactOutputOptions,
): Promise<string> {
  const maxBytes = options.maxBytes ?? MAX_DOWNLOAD_BYTES;
  assertSafeFilename(filename);
  if (buffer.byteLength > maxBytes) {
    throw pathError(`artifact exceeds maximum allowed size of ${maxBytes} bytes.`);
  }

  const dir = await prepareOutputDirectory(options);
  const filePath = join(dir, filename);
  await assertNoSymbolicLinkComponents(
    filePath,
    options.allowExternal ? undefined : options.root,
  );
  const handle = await open(
    filePath,
    constants.O_WRONLY | constants.O_CREAT | NOFOLLOW,
    0o600,
  );
  try {
    await verifyOpenedPath(
      handle,
      filePath,
      options.allowExternal ? undefined : options.root,
    );
    const info = await handle.stat();
    if (!info.isFile()) {
      throw pathError('artifact destination must be a regular file.');
    }
    if (info.nlink > 1) {
      throw pathError('artifact destination must not be a hard link.');
    }
    await handle.chmod(0o600);
    await handle.truncate(0);
    await handle.writeFile(buffer);
  } finally {
    await handle.close();
  }
  return filePath;
}
