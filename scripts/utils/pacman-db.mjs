#!/usr/bin/env node
/**
 * pacman-db.mjs — Parse a pacman repository database (.db) file.
 *
 * Pacman repo databases (.db) are gzip-compressed tar archives. Each package
 * is represented as a directory entry `<pkgname>-<pkgver>-<pkgrel>/` containing
 * at minimum a `desc` file. The `desc` file uses a simple section-based format:
 *
 *   %FIELD_NAME%
 *   value
 *
 * Common fields in `desc`:
 *   %NAME%    — package name (e.g. "zlib")
 *   %VERSION% — full version string including release (e.g. "1.3.1-1")
 *   %ARCH%    — target architecture (e.g. "x86_64", "any")
 *
 * This module exports `parsePacmanDb(filePath)` which returns an array of
 * parsed package entries: `[{ name, version, arch }]`.
 *
 * Handles:
 *   - ustar tar format with 512-byte block alignment
 *   - ustar prefix + name concatenation for long paths
 *   - PAX extended headers (typeflags 'x' / 'X') — skipped (length counted)
 *   - GNU long name entries (typeflags 'L' / 'K') — skipped
 *   - Regular file entries (typeflags '0' / '\0') and directory entries (typeflag '5')
 *   - Data regions padded to 512-byte boundaries
 *
 * Throws if the file is missing, not gzip, or otherwise unparsable.
 */

import fs from "node:fs";
import zlib from "node:zlib";

/**
 * Align a byte offset up to the next 512-byte boundary.
 * @param {number} n
 * @returns {number}
 */
function align512(n) {
  return Math.ceil(n / 512) * 512;
}

/**
 * Read a null-terminated ASCII string from a buffer at a given offset+length.
 * @param {Buffer} buf
 * @param {number} offset
 * @param {number} len
 * @returns {string}
 */
function readString(buf, offset, len) {
  const end = buf.indexOf(0, offset);
  return buf.toString("utf8", offset, end === -1 ? offset + len : Math.min(end, offset + len));
}

/**
 * Parse a numeric field from an octal string in the tar header.
 * @param {Buffer} buf
 * @param {number} offset
 * @param {number} len
 * @returns {number}
 */
function readOctal(buf, offset, len) {
  const str = readString(buf, offset, len).trim();
  if (!str) return 0;
  // Handle base-256 (binary) size/length fields: first byte >= 0x80 indicates base-256
  if (str.charCodeAt(0) >= 128) {
    // base-256: big-endian two's complement, high bit = negative (we treat as unsigned)
    let val = 0;
    for (let i = 0; i < str.length; i++) {
      val = val * 256 + str.charCodeAt(i);
    }
    return val;
  }
  return parseInt(str, 8) || 0;
}

/**
 * Parse a single tar header at `offset` in `buf`.
 * Returns { name, typeflag, size, prefix, dataStart } or null if zero block.
 * @param {Buffer} buf
 * @param {number} offset
 * @returns {object|null}
 */
function parseTarHeader(buf, offset) {
  if (offset + 512 > buf.length) return null;

  // Check for end-of-archive (two consecutive zero blocks)
  let allZero = true;
  for (let i = 0; i < 512; i++) {
    if (buf[offset + i] !== 0) { allZero = false; break; }
  }
  if (allZero) return null;

  const name = readString(buf, offset, 100);
  const size = readOctal(buf, offset + 124, 12);
  const typeflag = String.fromCharCode(buf[offset + 156]);
  const prefix = readString(buf, offset + 345, 155);
  const magic = readString(buf, offset + 257, 6);

  // ustar magic starts at offset 257; "ustar" or "ustar  \0" (POSIX)
  // If not ustar, prefix field may be garbage — only use it for ustar.
  const isUstar = magic === "ustar";

  const dataStart = offset + 512;

  return {
    name: prefix && isUstar ? prefix + "/" + name : name,
    typeflag,
    size,
    dataStart,
  };
}

/**
 * Parse a desc file content (binary buffer) into a field map.
 * Format: `%FIELD_NAME%\nvalue\n` repeated.
 * Multiple values for the same field are separated by `\n` within the value block.
 *
 * @param {Buffer} descBuf
 * @returns {Record<string, string>}
 */
function parseDescFile(descBuf) {
  const text = descBuf.toString("utf8").replace(/\r\n?/g, "\n");
  const fields = {};
  let currentField = null;
  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (trimmed.startsWith("%") && trimmed.endsWith("%") && trimmed.length > 2) {
      currentField = trimmed.slice(1, -1);
    } else if (currentField !== null) {
      if (fields[currentField] === undefined) {
        fields[currentField] = trimmed;
      } else {
        // Already have a value; if this is non-empty it's a multi-line value — append.
        if (trimmed) {
          fields[currentField] += "\n" + trimmed;
        }
      }
    }
  }
  return fields;
}

/**
 * Parse a pacman repository database (.db) file and return package metadata.
 *
 * @param {string} filePath — Absolute or relative path to the .db file.
 * @returns {Array<{ name: string, version: string, arch: string }>}
 *   Array of parsed packages in directory-entry order.
 * @throws {Error} If the file doesn't exist, is not gzip, or parsing fails critically.
 */
export function parsePacmanDb(filePath) {
  const raw = fs.readFileSync(filePath);
  if (raw.length < 2 || raw[0] !== 0x1f || raw[1] !== 0x8b) {
    throw new Error(`File does not appear to be gzip: ${filePath}`);
  }

  let tarBuf;
  try {
    tarBuf = zlib.gunzipSync(raw);
  } catch (e) {
    throw new Error(`Failed to gunzip ${filePath}: ${e.message}`);
  }

  const packages = [];
  let offset = 0;

  while (offset < tarBuf.length) {
    const hdr = parseTarHeader(tarBuf, offset);
    if (!hdr) break; // end-of-archive

    const nextOffset = hdr.dataStart + align512(hdr.size);

    if (hdr.typeflag === "5") {
      // Directory entry — it's a package directory. Check if it contains "desc"
      // by looking ahead in the archive.
      // (We don't extract here; we'll find desc files in subsequent file entries.)
    }

    if (hdr.typeflag === "0" || hdr.typeflag === "\0" || hdr.typeflag === "") {
      // Regular file
      if (hdr.name.endsWith("/desc")) {
        // Extract desc file content
        const descBuf = tarBuf.subarray(hdr.dataStart, hdr.dataStart + hdr.size);
        const fields = parseDescFile(descBuf);
        const name = fields["NAME"] || null;
        const version = fields["VERSION"] || "";
        const arch = fields["ARCH"] || "any";
        if (name) {
          packages.push({ name, version, arch });
        }
      }
    }

    // For typeflags 'x', 'X' (PAX extended headers): skip over the data region.
    // For typeflags 'L', 'K' (GNU long name/link): skip over the data region.
    // For typeflag '2' (symlink): skip.
    // For anything else: skip.
    // The offset advance already handles skipping because we always advance by
    // align512(hdr.size) regardless of typeflag.

    offset = nextOffset;
  }

  return packages;
}

export default parsePacmanDb;
