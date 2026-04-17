/**
 * sage scanner — walks the DOM, collects sg-* annotated and interactive
 * elements, and serializes them into a text representation that LLMs can
 * parse and act on.
 *
 * Design notes:
 * - Two attribute prefix styles: `sg-*` (primary, recommended) and
 *   `data-sg-*` (W3C-compliant fallback). Short prefix takes precedence.
 * - Elements with `sg-entity` get their children folded — the entity
 *   string acts as a one-line summary. AI can still drill down via
 *   getNode() later.
 * - Interactive elements (button/input/select/textarea/a/contenteditable)
 *   are always included, even without sg-* attributes, so the AI can
 *   operate the full page.
 */

import type {
  SageAttributes,
  SageConfig,
  SageNode,
  SageScanResult,
} from "./types.ts";

// ===== Constants =====

const SG_SHORT = "sg-";
const SG_LONG = "data-sg-";
const DEFAULT_MAX_TEXT = 100;

/** Tags that are always considered interactive, regardless of attributes. */
const INTERACTIVE_TAGS = new Set([
  "A",
  "BUTTON",
  "INPUT",
  "SELECT",
  "TEXTAREA",
]);

/** Tags to skip entirely — never interesting for AI. */
const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "SVG",
  "LINK",
  "META",
  "HEAD",
]);

// ===== Attribute reading =====

/**
 * Read all sg-* (and data-sg-*) attributes from an element.
 * Short prefix `sg-*` takes precedence over `data-sg-*`.
 */
function readAttributes(el: HTMLElement): SageAttributes {
  const attrs: SageAttributes = {};
  const seen = new Set<string>();

  // Pass 1 — short prefix sg-* (primary)
  // "data-sg-kind" starts with "d", not "s", so startsWith("sg-") already
  // excludes it — no extra guard needed.
  for (const attr of el.attributes) {
    if (!attr.name.startsWith(SG_SHORT)) continue;
    const key = attr.name.slice(SG_SHORT.length);
    assignAttribute(attrs, key, attr.value);
    seen.add(key);
  }

  // Pass 2 — long prefix (W3C fallback, only for keys not already set)
  for (const attr of el.attributes) {
    if (!attr.name.startsWith(SG_LONG)) continue;
    const key = attr.name.slice(SG_LONG.length);
    if (seen.has(key)) continue;
    assignAttribute(attrs, key, attr.value);
  }

  return attrs;
}

function assignAttribute(
  attrs: SageAttributes,
  key: string,
  value: string
): void {
  switch (key) {
    case "id":
      attrs.id = value;
      break;
    case "kind":
      attrs.kind = value;
      break;
    case "title":
      attrs.title = value;
      break;
    case "desc":
      attrs.desc = value;
      break;
    case "entity":
      attrs.entity = value;
      break;
    case "tool":
      attrs.tool = value;
      break;
    case "ignore":
      attrs.ignore = value === "true" || value === "";
      break;
  }
}

/** Does this element carry at least one sg-* or data-sg-* attribute? */
function hasSageAttributes(el: HTMLElement): boolean {
  for (const attr of el.attributes) {
    if (attr.name.startsWith(SG_SHORT) || attr.name.startsWith(SG_LONG)) return true;
  }
  return false;
}

// ===== Interactive detection =====

/** Is this element natively interactive (user can click/type on it)? */
function isInteractive(el: HTMLElement): boolean {
  if (INTERACTIVE_TAGS.has(el.tagName)) return true;
  if (el.isContentEditable) return true;
  if (el.getAttribute("role") === "button") return true;
  if (el.hasAttribute("onclick")) return true;
  if (el.tabIndex >= 0 && el.tagName !== "DIV" && el.tagName !== "SPAN")
    return true;
  return false;
}

// ===== Text extraction =====

/** Get visible text content, collapsed whitespace, truncated. */
function getVisibleText(el: HTMLElement, maxLen: number): string {
  const raw = el.textContent ?? "";
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLen) return collapsed;
  return collapsed.slice(0, maxLen);
}

// ===== Relevant HTML attributes =====

/** Pick out HTML attributes that help AI understand what this element is. */
function getRelevantAttrs(el: HTMLElement): Record<string, string> {
  const result: Record<string, string> = {};
  const tag = el.tagName;

  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type;
    if (type && type !== "text") result.type = type;
    const placeholder = el.getAttribute("placeholder");
    if (placeholder) result.placeholder = placeholder;
    const value = (el as HTMLInputElement).value;
    if (value) result.value = value;
  }

  if (tag === "TEXTAREA") {
    const placeholder = el.getAttribute("placeholder");
    if (placeholder) result.placeholder = placeholder;
  }

  if (tag === "A") {
    const href = el.getAttribute("href");
    if (href) result.href = href;
  }

  const role = el.getAttribute("role");
  if (role) result.role = role;

  return result;
}

// ===== DOM walk =====

/**
 * Recursively walk the DOM tree starting from `root`, collecting elements
 * that are either sg-* annotated or interactive.
 *
 * Returns a tree of SageNode, plus a flat list (by side-effect on `flat`).
 */
function walk(
  root: HTMLElement,
  depth: number,
  flat: SageNode[],
  maxText: number
): SageNode[] {
  const children: SageNode[] = [];

  for (const child of root.children) {
    if (!(child instanceof HTMLElement)) continue;
    if (SKIP_TAGS.has(child.tagName)) continue;

    const sg = readAttributes(child);

    // sg-ignore: skip this element and its entire subtree
    if (sg.ignore) continue;

    const hasSg = hasSageAttributes(child);
    const interactive = isInteractive(child);

    // Only include elements that have sg-* attrs or are interactive.
    // But we ALWAYS recurse into children (unless folded) — a plain <div>
    // wrapper with no sg-* might contain annotated children.
    const include = hasSg || interactive;

    if (include) {
      const rect = child.getBoundingClientRect();
      const node: SageNode = {
        index: flat.length,
        tag: child.tagName.toLowerCase(),
        sg,
        attrs: getRelevantAttrs(child),
        text: getVisibleText(child, maxText),
        element: child,
        interactive,
        hasSageAttrs: hasSg,
        rect: {
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        },
        depth,
        folded: !!sg.entity,
        children: [],
      };

      flat.push(node);

      // If this node has sg-entity, children are folded — don't recurse.
      // The entity string serves as a summary for AI.
      if (!sg.entity) {
        node.children = walk(child, depth + 1, flat, maxText);
      }

      children.push(node);
    } else {
      // Not included, but still recurse — its descendants may be interesting.
      const deeper = walk(child, depth, flat, maxText);
      children.push(...deeper);
    }
  }

  return children;
}

// ===== Serialization =====

/**
 * Serialize a tree of SageNodes into a text format that LLMs can parse.
 *
 * Output looks like:
 *   [0]<div sg-title="控制台" sg-kind="page" sg-id="console">Some text />
 *     [1]<button sg-kind="action">Click me />
 *       [2]<input sg-kind="field" placeholder="Search" />
 */
function serialize(nodes: SageNode[], depth: number = 0): string {
  const lines: string[] = [];
  const indent = "\t".repeat(depth);

  for (const node of nodes) {
    let line = `${indent}[${node.index}]<${node.tag}`;

    // sg-* attributes
    if (node.sg.title) line += ` sg-title="${esc(node.sg.title)}"`;
    if (node.sg.kind) line += ` sg-kind="${esc(node.sg.kind)}"`;
    if (node.sg.desc) line += ` sg-desc="${esc(node.sg.desc)}"`;
    if (node.sg.tool) line += ` sg-tool="${esc(node.sg.tool)}"`;
    if (node.sg.entity) line += ` sg-entity="${esc(node.sg.entity)}"`;
    if (node.sg.id) line += ` sg-id="${esc(node.sg.id)}"`;

    // Relevant HTML attributes
    for (const [key, value] of Object.entries(node.attrs)) {
      line += ` ${key}="${esc(value)}"`;
    }

    // Folded indicator
    if (node.folded && node.element.children.length > 0) {
      line += " hasChildren";
    }

    // Text content
    const text = node.text;
    if (text) {
      line += `>${text} />`;
    } else {
      line += ` />`;
    }

    lines.push(line);

    // Recurse into children (only if not folded)
    if (!node.folded && node.children.length > 0) {
      lines.push(serialize(node.children, depth + 1));
    }
  }

  return lines.join("\n");
}

function esc(s: string): string {
  return s.replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

// ===== Public API =====

/**
 * Scan the page and return a structured representation.
 *
 * This is the main entry point of sage's scanner. It:
 * 1. Walks the DOM from the given root (default: document.body)
 * 2. Collects elements that have sg-* attributes or are interactive
 * 3. Builds a tree structure (respecting sg-entity folding)
 * 4. Serializes into text for LLM consumption
 * 5. Returns both the text and the raw node list (for click/fill/getNode)
 */
export function scan(config?: Partial<SageConfig>): SageScanResult {
  const root = config?.root ?? document.body;
  const maxText = config?.maxTextLength ?? DEFAULT_MAX_TEXT;

  const flat: SageNode[] = [];
  const tree = walk(root, 0, flat, maxText);

  const interactiveCount = flat.filter((n) => n.interactive).length;
  const sageCount = flat.filter((n) => n.hasSageAttrs).length;

  // Page metadata
  const page = {
    title: document.title,
    url: location.href,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    scroll: {
      top: window.scrollY,
      height: document.documentElement.scrollHeight,
    },
  };

  // Header
  const header = `Current Page: [${page.title}](${page.url})\nViewport: ${page.viewport.width}x${page.viewport.height}, scroll: ${page.scroll.top}/${page.scroll.height}`;

  // Scroll context
  const abovePixels = Math.round(page.scroll.top);
  const belowPixels = Math.round(
    page.scroll.height - page.scroll.top - page.viewport.height
  );
  const scrollAbove = abovePixels > 50 ? `\n... ${abovePixels}px above ...\n` : "";
  const scrollBelow = belowPixels > 50 ? `\n\n... ${belowPixels}px below ...` : "";

  // Combine
  const body = serialize(tree);
  const text = header + "\n" + scrollAbove + "\n" + body + scrollBelow;

  return { text, nodes: flat, interactiveCount, sageCount, page };
}
