import { lstatSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { MAX_UPLOAD_BYTES } from '../constants.js';

/** Raised for rejected file paths and unwritable targets; the message is safe to show to the client. */
export class FileAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileAccessError';
  }
}

/** Raised when an upload would be rejected by Enhancv (type, size) or does not look like its extension. */
export class UploadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadValidationError';
  }
}

const DISABLED_MESSAGE =
  'Local file access is disabled. Set ENHANCV_FILES_DIR to a directory the server may read from and write to, or pass content_base64 instead of file_path.';

function isInside(base: string, target: string): boolean {
  const rel = relative(base, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function baseDir(filesDir: string | undefined): string {
  if (!filesDir) throw new FileAccessError(DISABLED_MESSAGE);
  try {
    return realpathSync(filesDir);
  } catch {
    throw new FileAccessError('ENHANCV_FILES_DIR does not exist anymore.');
  }
}

/** Resolve an existing regular file below `filesDir`; symlinks are followed but must stay inside. */
export function resolveReadablePath(filesDir: string | undefined, requested: string): string {
  const base = baseDir(filesDir);
  if (requested.includes('\0')) throw new FileAccessError('Invalid path.');
  let real: string;
  try {
    real = realpathSync(resolve(base, requested));
  } catch {
    throw new FileAccessError(`File not found below ENHANCV_FILES_DIR: ${requested}`);
  }
  if (!isInside(base, real)) throw new FileAccessError('The path is outside ENHANCV_FILES_DIR.');
  if (!statSync(real).isFile()) throw new FileAccessError('The path is not a regular file.');
  return real;
}

/** Resolve a (possibly new) file path below `filesDir`; the parent must exist and the target must not be a symlink. */
export function resolveWritablePath(filesDir: string | undefined, requested: string): string {
  const base = baseDir(filesDir);
  if (requested.includes('\0')) throw new FileAccessError('Invalid path.');
  const candidate = resolve(base, requested);
  let parent: string;
  try {
    parent = realpathSync(dirname(candidate));
  } catch {
    throw new FileAccessError('The target directory does not exist.');
  }
  if (!isInside(base, parent)) throw new FileAccessError('The path is outside ENHANCV_FILES_DIR.');
  const target = join(parent, basename(candidate));
  try {
    if (lstatSync(target).isSymbolicLink()) throw new FileAccessError('Refusing to write through a symbolic link.');
  } catch (error) {
    if (error instanceof FileAccessError) throw error;
    /* target does not exist yet - fine */
  }
  return target;
}

/** Write a file with owner-only permissions (resumes are personal data). Existing files need `overwrite`. */
export function writeOutputFile(target: string, bytes: Uint8Array, overwrite: boolean): void {
  try {
    writeFileSync(target, bytes, { flag: overwrite ? 'w' : 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new FileAccessError('The file already exists. Set overwrite to true to replace it.');
    }
    throw new FileAccessError(`Could not write the file: ${(error as NodeJS.ErrnoException).code ?? 'unknown error'}.`);
  }
}

export function readInputFile(path: string): Uint8Array {
  const { size } = statSync(path);
  if (size > MAX_UPLOAD_BYTES) throw new UploadValidationError(`The file is ${formatBytes(size)}; Enhancv accepts at most 10 MB.`);
  return new Uint8Array(readFileSync(path));
}

// --- Upload validation -----------------------------------------------------------------

const MIME_TYPES = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
} as const;
type UploadExtension = keyof typeof MIME_TYPES;

export type ValidUpload = { filename: string; mimeType: string; extension: UploadExtension; bytes: Uint8Array };

/** Keep only a plain, printable file name: no directories, quotes, control characters. */
export function sanitizeFilename(name: string): string {
  const cleaned = basename(name.replaceAll('\\', '/')).replace(/[\u0000-\u001f"<>|:*?]/g, '_').trim();
  return cleaned.slice(0, 200);
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

/** Check size, extension (PDF/DOC/DOCX) and magic bytes before anything is sent to Enhancv. */
export function validateUpload(filename: string, bytes: Uint8Array): ValidUpload {
  const safeName = sanitizeFilename(filename);
  const extension = extname(safeName).slice(1).toLowerCase();
  if (!(extension in MIME_TYPES)) {
    throw new UploadValidationError('Only PDF, DOC and DOCX files are accepted (the file name must end in .pdf, .doc or .docx).');
  }
  if (bytes.byteLength === 0) throw new UploadValidationError('The file is empty.');
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new UploadValidationError(`The file is ${formatBytes(bytes.byteLength)}; Enhancv accepts at most 10 MB.`);
  }
  const ext = extension as UploadExtension;
  const looksRight =
    ext === 'pdf'
      ? Buffer.from(bytes.subarray(0, 1024)).includes('%PDF-')
      : ext === 'docx'
        ? startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])
        : startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  if (!looksRight) throw new UploadValidationError(`The content does not look like a ${ext.toUpperCase()} file.`);
  return { filename: safeName, mimeType: MIME_TYPES[ext], extension: ext, bytes };
}

/** Decode strict standard base64 (no data: URL prefix); returns raw bytes. */
export function decodeBase64(value: string): Uint8Array {
  if (/^\s*data:/i.test(value)) throw new UploadValidationError('Pass raw base64, not a data: URL.');
  const compact = value.replace(/\s+/g, '');
  if (!compact || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    throw new UploadValidationError('content_base64 is not valid base64.');
  }
  return new Uint8Array(Buffer.from(compact, 'base64'));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
