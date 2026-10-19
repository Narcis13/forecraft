// @ui:controller barcode
// @ui:provides render update destroy

/**
 * Code 128-B encoder and SVG renderer.
 *
 * Code set B covers printable ASCII (U+0020–U+007E), which keeps the public
 * contract predictable while supporting document identifiers, URLs, and
 * ordinary business text. The generated symbol includes a modulo-103 check
 * character, the stop pattern, and ten-module quiet zones on both sides.
 */

const CODE128_PATTERNS = Object.freeze([
  "212222", "222122", "222221", "121223", "121322", "131222",
  "122213", "122312", "132212", "221213", "221312", "231212",
  "112232", "122132", "122231", "113222", "123122", "123221",
  "223211", "221132", "221231", "213212", "223112", "312131",
  "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321",
  "112313", "132113", "132311", "211313", "231113", "231311",
  "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131",
  "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124",
  "121421", "141122", "141221", "112214", "112412", "122114",
  "122411", "142112", "142211", "241211", "221114", "413111",
  "241112", "134111", "111242", "121142", "121241", "114212",
  "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141",
  "411131", "211412", "211214", "211232", "2331112",
]);

const START_B = 104;
const STOP = 106;
const QUIET_ZONE = 10;
const BAR_HEIGHT = 50;

function encodeCode128B(value) {
  if (!value) throw new Error("value is empty");

  const data = [];
  let inputIndex = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint < 32 || codePoint > 126) {
      const printable = JSON.stringify(character);
      throw new Error(
        `unsupported character ${printable} at index ${inputIndex}; Code 128-B accepts printable ASCII only`,
      );
    }
    data.push(codePoint - 32);
    inputIndex += character.length;
  }

  let weighted = START_B;
  for (let i = 0; i < data.length; i++) weighted += data[i] * (i + 1);
  const checksum = weighted % 103;
  const codewords = [START_B, ...data, checksum, STOP];
  const pattern = codewords.map((value) => CODE128_PATTERNS[value]).join("");

  return { checksum, codewords, pattern };
}

function patternToSVG(encoded) {
  const patternWidth = [...encoded.pattern].reduce((sum, width) => sum + Number(width), 0);
  const totalWidth = patternWidth + QUIET_ZONE * 2;

  let x = QUIET_ZONE;
  let isBar = true;
  let pathData = "";
  for (const digit of encoded.pattern) {
    const width = Number(digit);
    if (isBar) pathData += `M${x},0h${width}v${BAR_HEIGHT}h-${width}z`;
    x += width;
    isBar = !isBar;
  }

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${totalWidth} ${BAR_HEIGHT}`);
  svg.setAttribute("width", String(totalWidth));
  svg.setAttribute("height", String(BAR_HEIGHT));
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("data-part", "svg");
  svg.setAttribute("data-checksum", String(encoded.checksum));
  svg.setAttribute("data-pattern", encoded.pattern);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");

  const background = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  background.setAttribute("width", String(totalWidth));
  background.setAttribute("height", String(BAR_HEIGHT));
  background.setAttribute("fill", "var(--color-bg, #fff)");
  svg.appendChild(background);

  const bars = document.createElementNS("http://www.w3.org/2000/svg", "path");
  bars.setAttribute("d", pathData);
  bars.setAttribute("fill", "var(--color-fg, #000)");
  svg.appendChild(bars);

  return svg;
}

export function createBarcode(root) {
  if (root._faqirBarcode) return root._faqirBarcode;

  function removeGeneratedSVG() {
    const svg = root.querySelector(":scope > [data-part='svg']");
    if (svg) svg.remove();
  }

  function render() {
    removeGeneratedSVG();
    const value = root.getAttribute("data-value") || "";

    if (!value) {
      root.dataset.state = "empty";
      return;
    }

    try {
      const svg = patternToSVG(encodeCode128B(value));
      const caption = root.querySelector(":scope > [data-part='caption']");
      if (caption) root.insertBefore(svg, caption);
      else root.appendChild(svg);
      root.dataset.state = "ready";
    } catch (error) {
      root.dataset.state = "error";
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[barcode] Failed to encode: ${message}`);
    }
  }

  function update(newValue) {
    if (newValue !== undefined) root.setAttribute("data-value", newValue);
    render();
  }

  const observer = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => mutation.attributeName === "data-value")) render();
  });
  observer.observe(root, { attributes: true, attributeFilter: ["data-value"] });

  function destroy() {
    observer.disconnect();
    removeGeneratedSVG();
    if (["empty", "ready", "error"].includes(root.dataset.state)) delete root.dataset.state;
    delete root._faqirBarcode;
  }

  const api = { render, update, destroy };
  root._faqirBarcode = api;
  render();
  return api;
}
