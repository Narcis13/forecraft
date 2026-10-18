// Assets: logos and figures, uploaded once and referenced by id ("asset:ast_…").
// Size-limited, sniffed by their magic bytes (the declared type is ignored),
// stored in SQLite, served with `nosniff` and, for SVG, a CSP that runs nothing.
// Reports never reference a remote URL.

import { createHash } from "node:crypto";
import { type DB, newId, now } from "../db/index.ts";
import { Problem } from "../api/http.ts";

export const ASSET_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];
/** The API's body limit: a logo or a figure, not a photo library. */
export const MAX_ASSET_BYTES = 1024 * 1024 - 1024;

export interface AssetRow { id: string; workspace_id: string; type: AssetType; name: string; size: number; width: number | null; height: number | null; sha256: string; bytes: Uint8Array; created_at: string }

/** The real type of the bytes, or null. A script disguised as a PNG is null. */
export function sniff(bytes: Uint8Array): AssetType | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  const head = new TextDecoder("utf-8", { fatal: false }).decode(b.slice(0, 1024)).replace(/^﻿/, "").trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return "image/svg+xml";
  return null;
}

/** An SVG must be a picture, not a program: no script, no event handler, no foreign object, no external reference.
 *  A blocklist, so the second line of defence matters: SVGs are only ever shown through <img>
 *  (which runs no script) and served with a sandboxing CSP; never inline one. */
export function svgProblems(text: string): string | null {
  // Namespace prefixes count: <s:script xmlns:s="…svg"> is a script too.
  if (/<(?:[\w.-]+:)?script[\s>/]/i.test(text)) return "an SVG with <script> is refused";
  if (/\son[a-z]+\s*=/i.test(text)) return "an SVG with event handlers is refused";
  // Animation rewrites attributes after these checks: set/animate on a link or a handler is refused.
  if (/<(?:[\w.-]+:)?(?:set|animate\w*)\b[^>]*attributeName\s*=\s*["']?\s*(?:xlink:)?(?:href|on)/i.test(text)) return "an SVG that animates a link or an event handler is refused";
  if (/<(?:[\w.-]+:)?foreignObject[\s>/]/i.test(text)) return "an SVG with <foreignObject> is refused";
  if (/(?:xlink:)?href\s*=\s*(?:["']\s*)?(?!["'#\s])/i.test(text)) return "an SVG that references another file or URL is refused (only #fragment references)";
  if (/@import|url\(\s*["']?\s*(?!#)/i.test(text)) return "an SVG that loads CSS or images from elsewhere is refused";
  return null;
}

function dimensions(type: AssetType, b: Uint8Array): { width: number | null; height: number | null } {
  try {
    if (type === "image/png") {
      const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
      return { width: v.getUint32(16), height: v.getUint32(20) };
    }
    if (type === "image/jpeg") {
      let i = 2;
      while (i < b.length) {
        if (b[i] !== 0xff) break;
        const marker = b[i + 1]!;
        const len = (b[i + 2]! << 8) | b[i + 3]!;
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: (b[i + 5]! << 8) | b[i + 6]!, width: (b[i + 7]! << 8) | b[i + 8]! };
        i += 2 + len;
      }
    }
    if (type === "image/webp") {
      const chunk = String.fromCharCode(...b.slice(12, 16));
      if (chunk === "VP8X") return { width: 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)), height: 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)) };
      if (chunk === "VP8 ") return { width: (b[26]! | (b[27]! << 8)) & 0x3fff, height: (b[28]! | (b[29]! << 8)) & 0x3fff };
      if (chunk === "VP8L") { const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24); return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }; }
    }
    if (type === "image/svg+xml") {
      const t = new TextDecoder().decode(b.slice(0, 4096));
      const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(t);
      if (vb) return { width: Math.round(Number(vb[1])), height: Math.round(Number(vb[2])) };
    }
  } catch { /* dimensions are a nicety */ }
  return { width: null, height: null };
}

export function insertAsset(db: DB, workspaceId: string, bytes: Uint8Array, name: string): Omit<AssetRow, "bytes"> {
  if (bytes.length === 0) throw new Problem(422, "invalid-asset", "Empty file", "The upload has no bytes.");
  if (bytes.length > MAX_ASSET_BYTES) throw new Problem(413, "too-large", "Asset too large", `At most ${MAX_ASSET_BYTES / 1024 / 1024} MB.`);
  const type = sniff(bytes);
  if (!type) throw new Problem(415, "unsupported-asset", "Not an image we accept", "PNG, JPEG, WebP or SVG, judged by the file's own bytes (not its name or declared type).");
  if (type === "image/svg+xml") {
    const problem = svgProblems(new TextDecoder().decode(bytes));
    if (problem) throw new Problem(422, "unsafe-svg", "Unsafe SVG", `${problem}.`);
  }
  const { width, height } = dimensions(type, bytes);
  const row = {
    id: newId("ast"), workspace_id: workspaceId, type, name: name.replace(/[^\w .-]+/g, "").slice(0, 120), size: bytes.length,
    width, height, sha256: createHash("sha256").update(bytes).digest("hex"), created_at: now(),
  };
  db.prepare("INSERT INTO assets (id, workspace_id, type, name, size, width, height, sha256, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(row.id, row.workspace_id, row.type, row.name, row.size, row.width, row.height, row.sha256, bytes, row.created_at);
  return row;
}

export function getAsset(db: DB, id: string): AssetRow | undefined {
  return db.prepare("SELECT * FROM assets WHERE id = ?").get(id) as AssetRow | undefined;
}

export function getWorkspaceAsset(db: DB, workspaceId: string, id: string): AssetRow | undefined {
  return db.prepare("SELECT * FROM assets WHERE id = ? AND workspace_id = ?").get(id, workspaceId) as AssetRow | undefined;
}

export function listAssets(db: DB, workspaceId: string): Omit<AssetRow, "bytes">[] {
  return db.prepare("SELECT id, workspace_id, type, name, size, width, height, sha256, created_at FROM assets WHERE workspace_id = ? ORDER BY created_at DESC").all(workspaceId) as unknown as Omit<AssetRow, "bytes">[];
}

export const assetResource = (a: Omit<AssetRow, "bytes">) => ({ id: a.id, ref: `asset:${a.id}`, type: a.type, name: a.name, size: a.size, width: a.width, height: a.height, sha256: a.sha256, created_at: a.created_at, url: `/assets/${a.id}` });

/** Headers every asset is served with: never sniffed, and an SVG runs nothing. */
export function assetHeaders(type: string): Record<string, string> {
  return {
    "content-type": type,
    "x-content-type-options": "nosniff",
    "cache-control": "public, max-age=31536000, immutable",
    "content-security-policy": type === "image/svg+xml" ? "default-src 'none'; style-src 'unsafe-inline'; sandbox" : "default-src 'none'",
    "cross-origin-resource-policy": "same-origin",
  };
}
