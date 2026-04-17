/**
 * Shared utilities — iframe-safe type guards and DOM helpers.
 *
 * Why not use `instanceof HTMLInputElement`? Because instanceof fails
 * when the element comes from a different JS realm (e.g. an iframe).
 * The element's constructor is a DIFFERENT HTMLInputElement than the
 * one in the outer window. Using tagName is always safe.
 */

// ===== Type guards (iframe-safe) =====

export function isHTMLElement(el: unknown): el is HTMLElement {
  return !!el && (el as Node).nodeType === 1;
}

export function isInputElement(el: Element): el is HTMLInputElement {
  return el.tagName === "INPUT";
}

export function isTextAreaElement(el: Element): el is HTMLTextAreaElement {
  return el.tagName === "TEXTAREA";
}

export function isSelectElement(el: Element): el is HTMLSelectElement {
  return el.tagName === "SELECT";
}

// ===== Native value setter =====

/**
 * Get the native value setter from the element's prototype chain.
 *
 * React intercepts the `value` property on input/textarea elements.
 * To trigger React's onChange properly, we need to call the ORIGINAL
 * setter from the prototype, not the intercepted one on the instance.
 *
 * Using Object.getPrototypeOf (instead of HTMLInputElement.prototype)
 * makes this work even for elements inside iframes.
 */
export function getNativeValueSetter(
  element: HTMLInputElement | HTMLTextAreaElement
): ((value: string) => void) | null {
  const descriptor = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(element) as object,
    "value"
  );
  return (descriptor?.set as ((value: string) => void) | undefined) ?? null;
}
