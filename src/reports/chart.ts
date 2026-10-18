// Charts: the one thing Faqir does not draw (FAQIR-UPSTREAM.md #36 proposes a
// `chart` primitive with exactly these semantics). Bar, column and line, laid
// out here as plain geometry and drawn by templates/reports/blocks/chart.faqir as
// inline SVG. No colour is written: shapes carry data-series / data-role and
// print.css fills them from Faqir tokens, in greys that stay apart on a
// monochrome laser printer. Value axes start at zero; figures label the marks
// directly; the same numbers are printed as a table under the chart.

export interface ChartSvg {
  viewBox: string;
  label: string;
  grid: { x1: number; y1: number; x2: number; y2: number; role: string }[];
  rects: { x: number; y: number; w: number; h: number; series: string }[];
  paths: { d: string; series: string }[];
  dots: { x: number; y: number; r: number; series: string }[];
  texts: { x: number; y: number; text: string; anchor: string; role: string }[];
}

const W = 640;
const r1 = (n: number) => Math.round(n * 10) / 10;

/** 0 … a "nice" maximum with 3–5 steps (1, 2, 2.5, 5 × 10ⁿ). */
export function niceScale(max: number, min = 0): { top: number; bottom: number; step: number } {
  const span = Math.max(max, 0) - Math.min(min, 0) || 1;
  const raw = span / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  return { top: Math.ceil(Math.max(max, 0) / step) * step || step, bottom: Math.floor(Math.min(min, 0) / step) * step, step };
}

export function layoutChart(
  kind: "bar" | "column" | "line",
  labels: string[],
  series: { name: string; values: number[] }[],
  fmt: (v: number) => string,
  title: string,
  tick: (v: number) => string = fmt,
): ChartSvg {
  const out: ChartSvg = { viewBox: "", label: "", grid: [], rects: [], paths: [], dots: [], texts: [] };
  const all = series.flatMap((s) => s.values);
  const scale = niceScale(Math.max(0, ...all), Math.min(0, ...all));
  const n = Math.max(labels.length, 1);
  const legend = series.length > 1 && kind !== "line";
  out.label = `${title}: ${labels.map((l, i) => `${l} ${series.map((s) => `${series.length > 1 ? s.name + " " : ""}${fmt(s.values[i] ?? 0)}`).join(", ")}`).join("; ")}`;

  if (kind === "bar") {
    // Horizontal bars: categories down the side, values along a zero-based axis.
    const labelW = Math.min(200, 24 + Math.max(...labels.map((l) => l.length), 4) * 6.2);
    const rowH = series.length > 1 ? 14 * series.length + 10 : 24;
    const top = legend ? 26 : 8;
    const H = top + n * rowH + 22;
    const x0 = labelW, x1 = W - 70;
    const sx = (v: number) => x0 + ((v - scale.bottom) / (scale.top - scale.bottom)) * (x1 - x0);
    for (let v = scale.bottom; v <= scale.top + 1e-9; v += scale.step) {
      out.grid.push({ x1: r1(sx(v)), y1: top - 4, x2: r1(sx(v)), y2: top + n * rowH, role: v === 0 ? "axis" : "grid" });
      out.texts.push({ x: r1(sx(v)), y: top + n * rowH + 14, text: tick(v), anchor: "middle", role: "tick" });
    }
    labels.forEach((l, i) => {
      const yRow = top + i * rowH;
      out.texts.push({ x: x0 - 8, y: r1(yRow + rowH / 2 + 4), text: l, anchor: "end", role: "category" });
      series.forEach((s, j) => {
        const v = s.values[i] ?? 0;
        const h = series.length > 1 ? 11 : 14;
        const y = series.length > 1 ? yRow + 5 + j * 14 : yRow + (rowH - h) / 2;
        const a = sx(Math.min(0, v)), b = sx(Math.max(0, v));
        out.rects.push({ x: r1(a), y: r1(y), w: r1(Math.max(b - a, 0.5)), h, series: String(j + 1) });
        out.texts.push({ x: r1(v >= 0 ? b + 4 : a - 4), y: r1(y + h / 2 + 3.5), text: fmt(v), anchor: v >= 0 ? "start" : "end", role: "value" });
      });
    });
    if (legend) addLegend(out, series, 8);
    out.viewBox = `0 0 ${W} ${r1(H)}`;
    return out;
  }

  // Column and line: categories along the bottom.
  const H = 260;
  const top = legend ? 34 : 16;
  const y0 = H - 30, y1 = top;
  const x0 = 64, x1 = W - (kind === "line" ? 96 : 8);
  const sy = (v: number) => y0 - ((v - scale.bottom) / (scale.top - scale.bottom)) * (y0 - y1);
  for (let v = scale.bottom; v <= scale.top + 1e-9; v += scale.step) {
    out.grid.push({ x1: x0, y1: r1(sy(v)), x2: x1, y2: r1(sy(v)), role: v === 0 ? "axis" : "grid" });
    out.texts.push({ x: x0 - 8, y: r1(sy(v) + 3.5), text: tick(v), anchor: "end", role: "tick" });
  }
  const band = (x1 - x0) / n;
  labels.forEach((l, i) => out.texts.push({ x: r1(x0 + band * (i + 0.5)), y: y0 + 16, text: l, anchor: "middle", role: "category" }));

  if (kind === "column") {
    const groupW = Math.min(band * 0.7, 28 * series.length + 12);
    const colW = groupW / series.length;
    labels.forEach((_l, i) => series.forEach((s, j) => {
      const v = s.values[i] ?? 0;
      const x = x0 + band * (i + 0.5) - groupW / 2 + j * colW;
      const a = sy(Math.max(0, v)), b = sy(Math.min(0, v));
      out.rects.push({ x: r1(x + 1), y: r1(a), w: r1(colW - 2), h: r1(Math.max(b - a, 0.5)), series: String(j + 1) });
      if (series.length <= 2 || n <= 6) out.texts.push({ x: r1(x + colW / 2), y: r1(v >= 0 ? a - 4 : b + 11), text: fmt(v), anchor: "middle", role: "value" });
    }));
    if (legend) addLegend(out, series, 12);
  } else {
    series.forEach((s, j) => {
      const pts = s.values.map((v, i) => [x0 + band * (i + 0.5), sy(v)] as const);
      out.paths.push({ d: pts.map(([x, y], i) => `${i ? "L" : "M"}${r1(x)} ${r1(y)}`).join(" "), series: String(j + 1) });
      pts.forEach(([x, y]) => out.dots.push({ x: r1(x), y: r1(y), r: 2.6, series: String(j + 1) }));
      const last = pts.at(-1);
      // A direct label at the line's end replaces a legend.
      if (last) out.texts.push({ x: r1(last[0] + 8), y: r1(last[1] + 3.5), text: series.length > 1 ? `${s.name} ${fmt(s.values.at(-1)!)}` : fmt(s.values.at(-1)!), anchor: "start", role: "value" });
    });
  }
  out.viewBox = `0 0 ${W} ${H}`;
  return out;
}

function addLegend(out: ChartSvg, series: { name: string }[], y: number) {
  let x = 0;
  series.forEach((s, j) => {
    out.rects.push({ x, y, w: 10, h: 10, series: String(j + 1) });
    out.texts.push({ x: x + 15, y: y + 9, text: s.name, anchor: "start", role: "legend" });
    x += 30 + s.name.length * 6.5;
  });
}
