/**
 * sage public API — exposed on window.__sage__
 *
 * This is what browser extensions / AI agents consume.
 * Methods: scan, getNode, click, fill.
 */

import { scan } from "./scanner.ts";
import type {
  ActionResult,
  SageConfig,
  SageNode,
  SageScanResult,
} from "./types.ts";
import {
  getNativeValueSetter,
  isHTMLElement,
  isInputElement,
  isSelectElement,
  isTextAreaElement,
} from "./utils.ts";

export interface SageAPI {
  version: string;
  /** Number of nodes in the last scan. */
  readonly nodeCount: number;
  /** Scan the page and return structured result. */
  scan(config?: Partial<SageConfig>): SageScanResult;
  /** Get a single node by its [index] from the last scan. */
  getNode(index: number): SageNode | null;
  /** Click an element by its [index]. */
  click(index: number): ActionResult;
  /** Fill an input/textarea/select by its [index]. */
  fill(index: number, value: string): ActionResult;
}

const VERSION = "0.0.0";

export function createSageAPI(): SageAPI {
  /** Cache of last scan result — click/fill/getNode look up nodes here. */
  let lastScan: SageScanResult | null = null;

  function getNodeByIndex(index: number): SageNode | null {
    if (!lastScan) return null;
    return lastScan.nodes.find((n) => n.index === index) ?? null;
  }

  const api: SageAPI = {
    version: VERSION,

    get nodeCount() {
      return lastScan?.nodes.length ?? 0;
    },

    scan(config?: Partial<SageConfig>): SageScanResult {
      lastScan = scan(config);
      return lastScan;
    },

    getNode(index: number): SageNode | null {
      return getNodeByIndex(index);
    },

    click(index: number): ActionResult {
      const node = getNodeByIndex(index);
      if (!node) return { success: false, error: `Element [${index}] not found` };

      const el = node.element;
      if (!el || !el.isConnected) {
        return { success: false, error: "Element detached from DOM" };
      }
      if ((el as HTMLButtonElement).disabled) {
        return { success: false, error: "Element is disabled" };
      }

      // Scroll into view first
      try {
        const scrollable = el as Element & { scrollIntoViewIfNeeded?: (c?: boolean) => void };
        if (typeof scrollable.scrollIntoViewIfNeeded === "function") {
          scrollable.scrollIntoViewIfNeeded(true);
        } else {
          el.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
        }
      } catch {
        // scrollIntoView can throw on detached subtrees, ignore
      }

      // Full pointer event sequence (W3C spec order)
      // This matters for React components, hover menus, drag handles, etc.
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;

      // Hit-test: find the deepest element at click coordinates
      const doc = el.ownerDocument;
      const hitTarget = doc.elementFromPoint(x, y);
      const target =
        isHTMLElement(hitTarget) && el.contains(hitTarget)
          ? (hitTarget as HTMLElement)
          : el;

      const pointerOpts = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerType: "mouse" as const };
      const mouseOpts = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 };

      // Hover
      target.dispatchEvent(new PointerEvent("pointerover", pointerOpts));
      target.dispatchEvent(new PointerEvent("pointerenter", { ...pointerOpts, bubbles: false }));
      target.dispatchEvent(new MouseEvent("mouseover", mouseOpts));
      target.dispatchEvent(new MouseEvent("mouseenter", { ...mouseOpts, bubbles: false }));

      // Press
      target.dispatchEvent(new PointerEvent("pointerdown", pointerOpts));
      target.dispatchEvent(new MouseEvent("mousedown", mouseOpts));

      // Focus the original element (nearest focusable ancestor)
      el.focus({ preventScroll: true });

      // Release
      target.dispatchEvent(new PointerEvent("pointerup", pointerOpts));
      target.dispatchEvent(new MouseEvent("mouseup", mouseOpts));

      // Click activation
      target.click();

      return { success: true };
    },

    fill(index: number, value: string): ActionResult {
      const node = getNodeByIndex(index);
      if (!node) return { success: false, error: `Element [${index}] not found` };

      const el = node.element;
      if (!el || !el.isConnected) {
        return { success: false, error: "Element detached from DOM" };
      }
      if ((el as HTMLInputElement).disabled) {
        return { success: false, error: "Element is disabled" };
      }

      // --- Select ---
      if (isSelectElement(el)) {
        const options = Array.from(el.options);
        // 3-level match: exact textContent → exact value → case-insensitive text
        const match =
          options.find((o) => o.textContent?.trim() === value.trim()) ??
          options.find((o) => o.value === value) ??
          options.find(
            (o) => o.textContent?.trim().toLowerCase() === value.trim().toLowerCase()
          );
        if (!match) {
          const available = options
            .map((o) => o.textContent?.trim() || o.value)
            .filter(Boolean)
            .join(", ");
          return {
            success: false,
            error: `Option "${value}" not found. Available: ${available}`,
          };
        }
        el.value = match.value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { success: true };
      }

      // --- Input / Textarea ---
      if (isInputElement(el) || isTextAreaElement(el)) {
        // Focus first (React forms need this for proper state tracking)
        el.focus({ preventScroll: true });

        // Use native value setter to bypass React's synthetic property
        const setter = getNativeValueSetter(el);
        if (setter) {
          setter.call(el, value);
        } else {
          el.value = value;
        }
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { success: true };
      }

      // --- ContentEditable ---
      if (el.isContentEditable) {
        el.focus({ preventScroll: true });
        el.textContent = value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { success: true };
      }

      return { success: false, error: "Element is not fillable" };
    },
  };

  return api;
}

/**
 * Initialize sage: create API and expose on window.__sage__
 */
export function initSage(): SageAPI {
  const api = createSageAPI();
  (window as any).__sage__ = api;
  console.log(`[sage] v${VERSION} initialized. Use window.__sage__.scan() to start.`);
  return api;
}
