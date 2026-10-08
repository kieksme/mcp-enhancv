import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FileAccessError,
  UploadValidationError,
  decodeBase64,
  readInputFile,
  resolveReadablePath,
  resolveWritablePath,
  sanitizeFilename,
  validateUpload,
  writeOutputFile
} from '../src/utils/files.js';

let root: string;
let base: string;
let outside: string;

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'enhancv-files-')));
  base = join(root, 'base');
  outside = join(root, 'outside');
  mkdirSync(join(base, 'sub'), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(base, 'cv.pdf'), '%PDF-1.4 inside');
  writeFileSync(join(outside, 'secret.txt'), 'top secret');
  symlinkSync(join(outside, 'secret.txt'), join(base, 'link-to-secret.pdf'));
  symlinkSync(outside, join(base, 'link-dir'));
});

afterAll(() => {
  chmodSync(root, 0o700);
  rmSync(root, { recursive: true, force: true });
});

describe('resolveReadablePath', () => {
  it('is disabled without ENHANCV_FILES_DIR', () => {
    expect(() => resolveReadablePath(undefined, 'cv.pdf')).toThrow('ENHANCV_FILES_DIR');
  });

  it('resolves files below the base directory, relative or absolute', () => {
    expect(resolveReadablePath(base, 'cv.pdf')).toBe(join(base, 'cv.pdf'));
    expect(resolveReadablePath(base, join(base, 'cv.pdf'))).toBe(join(base, 'cv.pdf'));
  });

  it('rejects traversal, absolute paths outside and symlink escapes', () => {
    expect(() => resolveReadablePath(base, '../outside/secret.txt')).toThrow('outside');
    expect(() => resolveReadablePath(base, join(outside, 'secret.txt'))).toThrow('outside');
    expect(() => resolveReadablePath(base, 'link-to-secret.pdf')).toThrow('outside');
    expect(() => resolveReadablePath(base, 'link-dir/secret.txt')).toThrow('outside');
    expect(() => resolveReadablePath(base, 'cv\0.pdf')).toThrow('Invalid path');
  });

  it('rejects missing files and directories', () => {
    expect(() => resolveReadablePath(base, 'missing.pdf')).toThrow('not found');
    expect(() => resolveReadablePath(base, 'sub')).toThrow('regular file');
  });
});

describe('resolveWritablePath and writeOutputFile', () => {
  it('allows new files below the base and refuses other places', () => {
    expect(resolveWritablePath(base, 'out.pdf')).toBe(join(base, 'out.pdf'));
    expect(resolveWritablePath(base, 'sub/out.pdf')).toBe(join(base, 'sub', 'out.pdf'));
    expect(() => resolveWritablePath(base, '../outside/out.pdf')).toThrow('outside');
    expect(() => resolveWritablePath(base, 'link-dir/out.pdf')).toThrow('outside');
    expect(() => resolveWritablePath(base, 'missing-dir/out.pdf')).toThrow('does not exist');
    expect(() => resolveWritablePath(undefined, 'out.pdf')).toThrow('disabled');
  });

  it('refuses to write through a symbolic link', () => {
    expect(() => resolveWritablePath(base, 'link-to-secret.pdf')).toThrow(FileAccessError);
  });

  it('does not overwrite unless asked and writes owner-only files', () => {
    const target = resolveWritablePath(base, 'export.pdf');
    writeOutputFile(target, new TextEncoder().encode('%PDF-first'), false);
    expect(statSync(target).mode & 0o777).toBe(0o600);
    expect(() => writeOutputFile(target, new TextEncoder().encode('%PDF-second'), false)).toThrow('already exists');
    writeOutputFile(target, new TextEncoder().encode('%PDF-second'), true);
    expect(readFileSync(target, 'utf8')).toBe('%PDF-second');
  });
});

describe('upload validation', () => {
  const pdf = new TextEncoder().encode('%PDF-1.7 hello');
  const docx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]);
  const doc = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]);

  it('accepts PDF, DOCX and DOC with matching content and sets the MIME type', () => {
    expect(validateUpload('cv.pdf', pdf).mimeType).toBe('application/pdf');
    expect(validateUpload('CV.DOCX', docx).mimeType).toContain('wordprocessingml');
    expect(validateUpload('old.doc', doc).mimeType).toBe('application/msword');
  });

  it('rejects other extensions, mismatching content, empty and oversized files', () => {
    expect(() => validateUpload('cv.txt', pdf)).toThrow('PDF, DOC and DOCX');
    expect(() => validateUpload('cv.pdf', docx)).toThrow('does not look like a PDF');
    expect(() => validateUpload('cv.docx', pdf)).toThrow('DOCX');
    expect(() => validateUpload('cv.pdf', new Uint8Array())).toThrow('empty');
    expect(() => validateUpload('cv.pdf', new Uint8Array(10 * 1024 * 1024 + 1))).toThrow(UploadValidationError);
    expect(() => validateUpload('cv.pdf', new Uint8Array(10 * 1024 * 1024 + 1))).toThrow('10 MB');
  });

  it('strips directories and unsafe characters from file names', () => {
    expect(sanitizeFilename('../../etc/cv.pdf')).toBe('cv.pdf');
    expect(sanitizeFilename('C:\\Users\\me\\cv.pdf')).toBe('cv.pdf');
    expect(sanitizeFilename('a"b<c>.pdf')).toBe('a_b_c_.pdf');
    expect(validateUpload('../x/cv.pdf', pdf).filename).toBe('cv.pdf');
  });

  it('reads input files with a size guard', () => {
    expect(new TextDecoder().decode(readInputFile(join(base, 'cv.pdf')))).toBe('%PDF-1.4 inside');
  });
});

describe('decodeBase64', () => {
  it('decodes strict base64 and rejects data URLs and garbage', () => {
    expect(new TextDecoder().decode(decodeBase64('JVBERi0xLjQ='))).toBe('%PDF-1.4');
    expect(new TextDecoder().decode(decodeBase64('JVBE\nRi0x\nLjQ='))).toBe('%PDF-1.4');
    expect(() => decodeBase64('data:application/pdf;base64,JVBERi0xLjQ=')).toThrow('raw base64');
    expect(() => decodeBase64('not base64!')).toThrow('not valid base64');
    expect(() => decodeBase64('abc')).toThrow('not valid base64');
  });
});
