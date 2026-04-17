// ===== sg-* attribute values read from DOM =====

export interface SageAttributes {
  id?: string;
  kind?: string;
  title?: string;
  desc?: string;
  entity?: string;
  tool?: string;
  ignore?: boolean;
}

// ===== A single node in the scan result =====

export interface SageNode {
  /** Sequential index for AI to reference: [0], [1], [2]... */
  index: number;
  /** Lowercase tag name: "button", "div", "input", etc. */
  tag: string;
  /** All sg-* attributes found on this element. */
  sg: SageAttributes;
  /** Key HTML attributes relevant for AI (type, placeholder, value, role). */
  attrs: Record<string, string>;
  /** Visible text content, truncated to ~100 chars. */
  text: string;
  /** Live DOM reference — needed for click() / fill() later. */
  element: HTMLElement;
  /** Is this element natively interactive (button/input/select/a/textarea)? */
  interactive: boolean;
  /** Does this element carry any sg-* attribute? */
  hasSageAttrs: boolean;
  /** Bounding rect at scan time (for viewport filtering, scroll-into-view). */
  rect: { top: number; left: number; width: number; height: number };
  /** Nesting depth in the sage tree (root = 0). */
  depth: number;
  /**
   * If this node has sg-entity, children are folded (not expanded in scan
   * output). The entity string serves as a summary. AI can still get the
   * children by calling getNode() on this node's index later.
   */
  folded: boolean;
  /** Child sage nodes. Empty if folded or no annotated/interactive children. */
  children: SageNode[];
}

// ===== Scan result =====

export interface SageScanResult {
  /** Serialized text representation of the page — this is what gets sent to LLM. */
  text: string;
  /** Flat list of all collected nodes (depth-first order, same as index order). */
  nodes: SageNode[];
  /** Total count of interactive elements found. */
  interactiveCount: number;
  /** Total count of elements with sg-* attributes. */
  sageCount: number;
  /** Page-level metadata. */
  page: {
    title: string;
    url: string;
    viewport: { width: number; height: number };
    scroll: { top: number; height: number };
  };
}

// ===== Scan config (optional overrides) =====

export interface SageConfig {
  /** Root element to start scanning from. Default: document.body. */
  root?: HTMLElement;
  /** Max chars of visible text to include per node. Default: 100. */
  maxTextLength?: number;
}
