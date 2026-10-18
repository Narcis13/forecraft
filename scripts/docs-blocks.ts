// node scripts/docs-blocks.ts — prints the block reference for docs/reports.md
// from the model itself (BLOCKS), so the docs cannot drift from what is accepted.
import { BLOCKS } from "../src/reports/model.ts";

const kind = (k: Record<string, unknown>): string => {
  switch (k.k) {
    case "text": return "template text";
    case "expr": return "expression";
    case "md": return "markdown";
    case "bool": return "true/false";
    case "asset": return "asset:ast_…";
    case "source": return "Faqir template source";
    case "blocks": return "blocks";
    case "columns": return "2–3 lists of blocks";
    case "enum": return (k.values as string[]).map((v) => `\`${v}\``).join(" · ");
    case "list": return `list of ${kind(k.of as Record<string, unknown>)}`;
    case "object": return `{ ${Object.entries(k.props as Record<string, Record<string, unknown>>).map(([n, p]) => `${n}${p.required ? "" : "?"}`).join(", ")} }`;
  }
  return String(k.k);
};

const groups = ["structure", "data", "content", "office", "advanced"];
const out: string[] = [];
for (const g of groups) {
  out.push(`### ${g[0]!.toUpperCase()}${g.slice(1)}`, "");
  for (const [name, spec] of Object.entries(BLOCKS).filter(([, s]) => s.group === g)) {
    out.push(`#### \`${name}\``, "", spec.does, "");
    const props = Object.entries(spec.props);
    if (props.length) {
      out.push("| Prop | Kind |", "|---|---|");
      for (const [p, k] of props) out.push(`| \`${p}\`${(k as { required?: boolean }).required ? " (required)" : ""} | ${kind(k as Record<string, unknown>)} |`);
      out.push("");
    }
    out.push("```jsonc", JSON.stringify(spec.example, null, 2), "```", "");
  }
}
console.log(out.join("\n"));
