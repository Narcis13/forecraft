import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32, deflateSync } from "node:zlib";
import { Problem } from "../../src/api/http.ts";
import {
  assetHeaders, assetResource, getAsset, getWorkspaceAsset, insertAsset, listAssets, MAX_ASSET_BYTES, sniff, svgProblems,
} from "../../src/assets/index.ts";
import { openDb, type DB } from "../../src/db/index.ts";

// ── Fixtures: real, small files built from their formats ────────────────────

const text = (s: string) => new TextEncoder().encode(s);

/** A valid PNG, w x h, black. */
function png(w: number, h: number): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const scanlines = Buffer.alloc((w * 3 + 1) * h);
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(scanlines)), chunk("IEND", Buffer.alloc(0)),
  ]));
}

/** The skeleton of a baseline JPEG: SOI, a JFIF APP0 segment, a SOF0 frame header, EOI. */
function jpeg(w: number, h: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xd9,
  ]);
}

/** A WebP container with an extended (VP8X) header: canvas sizes are stored as width-1 and height-1 in 24 bits. */
function webp(w: number, h: number): Uint8Array {
  const b = Buffer.alloc(30);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(22, 4);
  b.write("WEBP", 8, "ascii");
  b.write("VP8X", 12, "ascii");
  b.writeUInt32LE(10, 16);
  b.writeUIntLE(w - 1, 24, 3);
  b.writeUIntLE(h - 1, 27, 3);
  return new Uint8Array(b);
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><rect width="40" height="20" fill="#1f3a8a"/></svg>';

function database(): { db: DB; ws: string } {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)").run("ws_test", "Test", "2026-01-01T00:00:00.000Z");
  db.prepare("INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)").run("ws_other", "Other", "2026-01-01T00:00:00.000Z");
  return { db, ws: "ws_test" };
}

const count = (db: DB) => (db.prepare("SELECT COUNT(*) AS n FROM assets").get() as { n: number }).n;

/** The Problem a call throws. */
function problemOf(fn: () => unknown): Problem {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof Problem, `expected a Problem, got ${String(err)}`);
    return err;
  }
  return assert.fail("expected a Problem");
}

// ── sniff ───────────────────────────────────────────────────────────────────

test("sniff recognises PNG, JPEG, WebP and SVG by their bytes", () => {
  assert.equal(sniff(png(2, 2)), "image/png");
  assert.equal(sniff(jpeg(2, 2)), "image/jpeg");
  assert.equal(sniff(webp(2, 2)), "image/webp");
  assert.equal(sniff(text(SVG)), "image/svg+xml");
});

test("sniff recognises the usual ways an SVG file starts", () => {
  const variants = [
    '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    '<?xml version="1.0"?>\n<!-- made by hand -->\n<svg></svg>',
    '<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg></svg>',
    "﻿<svg></svg>",
    "  \n\t<svg></svg>",
    "<SVG></SVG>",
    "<svg\nxmlns='http://www.w3.org/2000/svg'></svg>",
  ];
  for (const v of variants) assert.equal(sniff(text(v)), "image/svg+xml", JSON.stringify(v.slice(0, 30)));
});

test("sniff: a script disguised as a PNG is null", () => {
  for (const body of ["<script>alert(1)</script>", "<script>fetch('/api/v1/keys')</script>", "<html><script>alert(1)</script></html>", "<img src=x onerror=alert(1)>"]) {
    assert.equal(sniff(text(body)), null, body);
  }
});

test("sniff: HTML that merely contains an <svg> is not an SVG", () => {
  assert.equal(sniff(text("<html><body><svg></svg></body></html>")), null);
  assert.equal(sniff(text("<!DOCTYPE html><svg></svg>")), null);
  assert.equal(sniff(text("<svgfoo></svgfoo>")), null);
  assert.equal(sniff(text("hello <svg></svg>")), null);
  // No whitespace or > after the tag name: not what a browser reads as an SVG root either.
  assert.equal(sniff(text("<svg/onload=alert(1)>")), null);
});

test("sniff: random bytes, empty, text, GIF and other containers are null", () => {
  assert.equal(sniff(new Uint8Array(0)), null);
  assert.equal(sniff(new Uint8Array(500).map((_, i) => (i * 131 + 7) & 0xff)), null);
  assert.equal(sniff(text("hello world")), null);
  assert.equal(sniff(text("GIF89a\x01\x00\x01\x00")), null);
  assert.equal(sniff(new Uint8Array(40).fill(0)), null);
  // RIFF, but a WAV, not a WebP.
  const wav = new Uint8Array(webp(2, 2));
  wav.set(text("WAVE"), 8);
  assert.equal(sniff(wav), null);
});

test("sniff: truncated signatures are not enough", () => {
  assert.equal(sniff(png(2, 2).slice(0, 7)), null);
  assert.equal(sniff(jpeg(2, 2).slice(0, 2)), null);
  assert.equal(sniff(webp(2, 2).slice(0, 11)), null);
});

// ── svgProblems ─────────────────────────────────────────────────────────────

test("svgProblems passes a plain picture, including #fragment references", () => {
  assert.equal(svgProblems(SVG), null);
  assert.equal(svgProblems('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><linearGradient id="g"/></defs><rect fill="url(#g)"/><use href="#g"/><use xlink:href="#g"/></svg>'), null);
  assert.equal(svgProblems('<svg><style>.a { fill: red }</style><rect class="a"/></svg>'), null);
});

test("svgProblems refuses <script>, in any case and spacing", () => {
  for (const v of ["<svg><script>alert(1)</script></svg>", "<svg><SCRIPT >alert(1)</SCRIPT></svg>", "<svg><script\n type='text/javascript'>1</script></svg>"]) {
    assert.match(svgProblems(v)!, /<script>/, v);
  }
});

test("svgProblems refuses on* event handlers", () => {
  for (const v of [
    '<svg onload="alert(1)"></svg>',
    '<svg><rect onclick = "x()"/></svg>',
    '<svg><a onmouseover="x()"><rect/></a></svg>',
    '<svg\tonload="x()"></svg>',
    "<svg\nonfocusin='x()'></svg>",
    '<svg ONLOAD="x()"></svg>',
  ]) assert.match(svgProblems(v)!, /event handlers/, v);
});

test("svgProblems refuses <foreignObject>", () => {
  assert.match(svgProblems('<svg><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject></svg>')!, /foreignObject/);
  assert.match(svgProblems("<svg><FOREIGNOBJECT width=\"1\"/></svg>")!, /foreignObject/);
});

test("svgProblems refuses external href and xlink:href, javascript: and data: included", () => {
  for (const v of [
    '<svg><image href="https://evil.example/x.png"/></svg>',
    "<svg><image href='//evil.example/x.png'/></svg>",
    '<svg><use xlink:href="http://evil.example/x.svg#a"/></svg>',
    '<svg><a href="javascript:alert(1)"><rect/></a></svg>',
    '<svg><image href="data:image/png;base64,AAAA"/></svg>',
    '<svg><image href="local-file.png"/></svg>',
    '<svg><image href = "x.png"/></svg>',
  ]) assert.match(svgProblems(v)!, /references another file or URL/, v);
});

test("svgProblems refuses url() and @import that leave the document", () => {
  for (const v of [
    '<svg><rect fill="url(https://evil.example/x)"/></svg>',
    "<svg><rect style=\"fill:url('http://evil.example/x')\"/></svg>",
    '<svg><rect style="fill:url( &quot;x.svg#a&quot; )"/></svg>',
    '<svg><style>@import "https://evil.example/x.css";</style></svg>',
    "<svg><style>@import url(x.css);</style></svg>",
    '<svg><style>.a { background: url(data:image/png;base64,AAAA) }</style></svg>',
  ]) assert.match(svgProblems(v)!, /loads CSS or images from elsewhere/, v);
});

test("svgProblems: an unquoted href=javascript:… is refused too", () => {
  assert.notEqual(svgProblems("<svg><a href=javascript:alert(1)><rect/></a></svg>"), null);
});

// ── insertAsset ─────────────────────────────────────────────────────────────

test("a PNG is stored with its width and height, and the bytes come back whole", () => {
  const { db, ws } = database();
  const bytes = png(32, 16);
  const row = insertAsset(db, ws, bytes, "logo.png");
  assert.match(row.id, /^ast_[A-Za-z0-9]{6,32}$/);
  assert.equal(row.type, "image/png");
  assert.equal(row.width, 32);
  assert.equal(row.height, 16);
  assert.equal(row.size, bytes.length);
  assert.equal(row.workspace_id, ws);
  assert.match(row.sha256, /^[0-9a-f]{64}$/);

  const stored = getAsset(db, row.id)!;
  assert.deepEqual(new Uint8Array(stored.bytes), bytes);
  assert.equal(stored.width, 32);
  assert.equal(stored.type, "image/png");
});

test("the same bytes always have the same sha256; different bytes do not", () => {
  const { db, ws } = database();
  const a = insertAsset(db, ws, png(4, 4), "a.png");
  const b = insertAsset(db, ws, png(4, 4), "b.png");
  const c = insertAsset(db, ws, png(5, 4), "c.png");
  assert.equal(a.sha256, b.sha256);
  assert.notEqual(a.sha256, c.sha256);
  assert.notEqual(a.id, b.id);
});

test("JPEG, WebP and SVG sizes are read from their own headers", () => {
  const { db, ws } = database();
  const j = insertAsset(db, ws, jpeg(120, 80), "photo.jpg");
  assert.deepEqual([j.type, j.width, j.height], ["image/jpeg", 120, 80]);
  const w = insertAsset(db, ws, webp(300, 200), "figure.webp");
  assert.deepEqual([w.type, w.width, w.height], ["image/webp", 300, 200]);
  const s = insertAsset(db, ws, text(SVG), "mark.svg");
  assert.deepEqual([s.type, s.width, s.height], ["image/svg+xml", 40, 20]);
  const bare = insertAsset(db, ws, text("<svg xmlns='http://www.w3.org/2000/svg'><rect/></svg>"), "bare.svg");
  assert.deepEqual([bare.width, bare.height], [null, null]);
});

test("the file name and declared type play no part: a PNG called .svg is a PNG", () => {
  const { db, ws } = database();
  assert.equal(insertAsset(db, ws, png(2, 2), "logo.svg").type, "image/png");
  assert.equal(insertAsset(db, ws, text(SVG), "logo.png").type, "image/svg+xml");
});

test("the stored name keeps letters, digits, spaces, dots, dashes and underscores", () => {
  const { db, ws } = database();
  assert.equal(insertAsset(db, ws, png(2, 2), "Q3 report_final-v2.png").name, "Q3 report_final-v2.png");
  assert.equal(insertAsset(db, ws, png(2, 2), '../../etc/<b>pass"wd</b>.png').name, "....etcbpasswdb.png");
  assert.equal(insertAsset(db, ws, png(2, 2), "x".repeat(300)).name.length, 120);
});

test("a script disguised as a PNG is a 415 and stores nothing", () => {
  const { db, ws } = database();
  const p = problemOf(() => insertAsset(db, ws, text("<script>alert(1)</script>"), "logo.png"));
  assert.equal(p.status, 415);
  assert.match(p.type, /unsupported-asset$/);
  assert.match(p.message, /judged by the file's own bytes/);
  assert.equal(count(db), 0);
});

test("random bytes, text and a GIF are 415", () => {
  const { db, ws } = database();
  for (const bytes of [new Uint8Array(300).map((_, i) => (i * 37 + 11) & 0xff), text("just words"), text("GIF89a......"), text("<svg/onload=alert(1)>")]) {
    assert.equal(problemOf(() => insertAsset(db, ws, bytes, "x.png")).status, 415);
  }
  assert.equal(count(db), 0);
});

test("an unsafe SVG is a 422 with the reason, and stores nothing", () => {
  const { db, ws } = database();
  const cases: [string, RegExp][] = [
    ['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', /<script>/],
    ['<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>', /event handlers/],
    ['<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><p>hi</p></foreignObject></svg>', /foreignObject/],
    ['<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/x.png"/></svg>', /another file or URL/],
    ['<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(https://evil.example/x)"/></svg>', /elsewhere/],
  ];
  for (const [svg, reason] of cases) {
    const p = problemOf(() => insertAsset(db, ws, text(svg), "logo.svg"));
    assert.equal(p.status, 422, svg);
    assert.match(p.type, /unsafe-svg$/);
    assert.match(p.message, reason);
  }
  assert.equal(count(db), 0);
});

test("an empty upload is a 422 and an oversized one a 413", () => {
  const { db, ws } = database();
  const empty = problemOf(() => insertAsset(db, ws, new Uint8Array(0), "x.png"));
  assert.equal(empty.status, 422);
  assert.match(empty.type, /invalid-asset$/);
  const big = problemOf(() => insertAsset(db, ws, new Uint8Array(MAX_ASSET_BYTES + 1), "x.png"));
  assert.equal(big.status, 413);
  assert.match(big.type, /too-large$/);
  assert.equal(count(db), 0);
});

test("a file of exactly the limit is accepted when it is an image", () => {
  const { db, ws } = database();
  const big = new Uint8Array(MAX_ASSET_BYTES);
  big.set(png(2, 2));
  const row = insertAsset(db, ws, big, "huge.png");
  assert.equal(row.size, MAX_ASSET_BYTES);
});

test("an asset belongs to its workspace", () => {
  const { db, ws } = database();
  const row = insertAsset(db, ws, png(3, 3), "a.png");
  assert.ok(getWorkspaceAsset(db, ws, row.id));
  assert.equal(getWorkspaceAsset(db, "ws_other", row.id), undefined);
  assert.equal(getAsset(db, "ast_nope"), undefined);
  assert.equal(insertAsset(db, "ws_other", png(3, 3), "b.png").workspace_id, "ws_other");
  assert.deepEqual(listAssets(db, ws).map((a) => a.id), [row.id]);
  assert.equal(listAssets(db, "ws_other").length, 1);
});

test("an asset needs a real workspace", () => {
  const { db } = database();
  assert.throws(() => insertAsset(db, "ws_missing", png(2, 2), "x.png"), /FOREIGN KEY/);
});

test("listAssets omits the bytes, newest first", () => {
  const { db, ws } = database();
  const first = insertAsset(db, ws, png(2, 2), "first.png");
  db.prepare("UPDATE assets SET created_at = '2026-01-01T00:00:00.000Z' WHERE id = ?").run(first.id);
  const second = insertAsset(db, ws, png(3, 3), "second.png");
  const listed = listAssets(db, ws);
  assert.deepEqual(listed.map((a) => a.id), [second.id, first.id]);
  assert.ok(listed.every((a) => !("bytes" in a)));
});

test("assetResource gives the reference a definition cites and the URL it is served at", () => {
  const { db, ws } = database();
  const row = insertAsset(db, ws, png(8, 4), "mark.png");
  const resource = assetResource(row);
  assert.equal(resource.ref, `asset:${row.id}`);
  assert.equal(resource.url, `/assets/${row.id}`);
  assert.deepEqual([resource.type, resource.width, resource.height, resource.name], ["image/png", 8, 4, "mark.png"]);
  assert.ok(!("bytes" in resource) && !("workspace_id" in resource));
});

test("assets are served nosniff with a locked-down CSP; an SVG runs nothing", () => {
  const png = assetHeaders("image/png");
  assert.equal(png["content-type"], "image/png");
  assert.equal(png["x-content-type-options"], "nosniff");
  assert.equal(png["content-security-policy"], "default-src 'none'");
  assert.equal(png["cross-origin-resource-policy"], "same-origin");
  const svg = assetHeaders("image/svg+xml");
  assert.match(svg["content-security-policy"]!, /default-src 'none'/);
  assert.match(svg["content-security-policy"]!, /sandbox/);
  assert.equal(svg["x-content-type-options"], "nosniff");
  assert.match(svg["cache-control"]!, /immutable/);
});
