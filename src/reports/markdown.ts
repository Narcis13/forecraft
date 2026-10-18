// Markdown for `text` and `callout` blocks, compiled at save time from marked's
// tokens into plain nodes the text partial draws: paragraphs, two heading
// levels, flat lists, and inline runs that are strong, emphasised, code or a
// link. Each run's text is template text, so {{ holes }} survive as holes and
// data lands as escaped text. HTML in markdown is refused, never passed on.

import { marked, type Token, type Tokens } from "marked";

export interface Run { text: string; b?: true; i?: true; code?: true; href?: string; br?: true }
export type MdBlock =
  | { t: "p"; runs: Run[] }
  | { t: "h3" | "h4"; runs: Run[] }
  | { t: "ul" | "ol"; items: Run[][] };

export type MdResult = { blocks: MdBlock[]; texts: string[] } | { errors: { detail: string; code: string }[] };

const OPEN = "";
const CLOSE = "";
const SAFE_URL = /^(https?:|mailto:|tel:)/i;

export function compileMarkdown(source: string): MdResult {
  // Holes out of marked's way: `{{ a * b }}` must not become emphasis.
  const holes: string[] = [];
  const masked = source.replace(/\{\{[\s\S]*?\}\}/g, (h) => `${OPEN}${holes.push(h) - 1}${CLOSE}`);
  const restore = (s: string) => s.replace(new RegExp(`${OPEN}(\\d+)${CLOSE}`, "g"), (_m, n) => holes[Number(n)]!);

  const errors: { detail: string; code: string }[] = [];
  const texts: string[] = [];
  const blocks: MdBlock[] = [];

  const inline = (tokens: Token[] | undefined, flags: Omit<Run, "text"> = {}, out: Run[] = []): Run[] => {
    for (const t of tokens ?? []) {
      switch (t.type) {
        case "text":
        case "escape": {
          const tt = t as Tokens.Text;
          if (tt.tokens?.length) inline(tt.tokens, flags, out);
          else push(out, { ...flags, text: restore(tt.text).replace(/\s*\n\s*/g, " ") });
          break;
        }
        case "strong": inline((t as Tokens.Strong).tokens, { ...flags, b: true }, out); break;
        case "em": inline((t as Tokens.Em).tokens, { ...flags, i: true }, out); break;
        case "del": inline((t as Tokens.Del).tokens, flags, out); break;
        case "codespan": push(out, { ...flags, code: true, text: restore((t as Tokens.Codespan).text) }); break;
        case "br": out.push({ text: "", br: true }); break;
        case "link": {
          const l = t as Tokens.Link;
          const href = restore(l.href);
          // A literal scheme before a hole is checked now; a hole that supplies the scheme is checked when it renders.
          const literal = href.split("{{")[0]!;
          if ((!href.includes("{{") || literal.includes(":")) && !SAFE_URL.test(literal.includes(":") ? literal : href)) errors.push({ code: "unsafe-url", detail: `Links are http(s), mailto or tel: ${JSON.stringify(href)}.` });
          inline(l.tokens, { ...flags, href }, out);
          break;
        }
        case "html": errors.push({ code: "html-refused", detail: `HTML is not allowed in markdown: ${JSON.stringify(t.raw.trim().slice(0, 40))}.` }); break;
        case "image": errors.push({ code: "image-refused", detail: "Images in markdown are not allowed: use an image block with an uploaded asset." }); break;
        default: push(out, { ...flags, text: restore(t.raw) });
      }
    }
    return out;
  };

  const push = (out: Run[], run: Run) => {
    if (!run.text) return;
    texts.push(run.text);
    if (run.href) texts.push(run.href);
    const last = out.at(-1);
    if (last && !last.br && last.b === run.b && last.i === run.i && last.code === run.code && last.href === run.href) last.text += run.text;
    else out.push(run);
  };

  let tokens: Token[];
  try {
    tokens = marked.lexer(masked, { gfm: true });
  } catch (err) {
    return { errors: [{ code: "bad-markdown", detail: String((err as Error).message) }] };
  }

  for (const t of tokens) {
    switch (t.type) {
      case "space": break;
      case "paragraph": blocks.push({ t: "p", runs: inline((t as Tokens.Paragraph).tokens) }); break;
      case "heading": {
        const h = t as Tokens.Heading;
        blocks.push({ t: h.depth <= 2 ? "h3" : "h4", runs: inline(h.tokens) });
        break;
      }
      case "list": {
        const l = t as Tokens.List;
        const items: Run[][] = [];
        const add = (list: Tokens.List) => {
          for (const item of list.items) {
            const runs: Run[] = [];
            for (const child of item.tokens) {
              if (child.type === "list") { if (runs.length) items.push([...runs]); runs.length = 0; add(child as Tokens.List); }
              else inline((child as Tokens.Text).tokens ?? [child], {}, runs);
            }
            if (runs.length) items.push(runs);
          }
        };
        add(l);
        blocks.push({ t: l.ordered ? "ol" : "ul", items });
        break;
      }
      case "blockquote": blocks.push({ t: "p", runs: inline((t as Tokens.Blockquote).tokens.flatMap((x) => (x as Tokens.Paragraph).tokens ?? [])) }); break;
      case "code": {
        const text = restore((t as Tokens.Code).text).replace(/\n/g, " ");
        texts.push(text);
        blocks.push({ t: "p", runs: [{ text, code: true }] });
        break;
      }
      case "hr": break;
      case "html": errors.push({ code: "html-refused", detail: `HTML is not allowed in markdown: ${JSON.stringify(t.raw.trim().slice(0, 40))}.` }); break;
      case "table": errors.push({ code: "table-refused", detail: "Tables in markdown are not allowed: use a table block." }); break;
      default: errors.push({ code: "unsupported", detail: `Unsupported markdown: ${t.type}.` });
    }
  }
  if (errors.length) return { errors };
  return { blocks, texts };
}
