// Shows the interface in the reader's language by swapping, in place, every
// text and label that a catalog entry names whole (ui-translate-logic.ts;
// docs/specs/ogm-italian-ui.md). Only a text node's value or an attribute's
// value is ever written: no node is added, moved or removed, so React keeps
// owning the page, and a text React writes again in English is swapped again.
// Story text, names and what people write sit under translate="no" and are
// never read.

import { sentenceTranslator, type UiTranslator } from "@/lib/language/ui-translate-logic";

export const TRANSLATED_ATTRIBUTES = ["title", "placeholder", "aria-label", "alt"] as const;

const LEFT_ALONE = '[translate="no"], script, style, textarea, code, [contenteditable=""], [contenteditable="true"]';

function leftAlone(element: Element | null): boolean {
  return !element || element.closest(LEFT_ALONE) !== null;
}

// A server's line in the chronicle, read sentence by sentence when it has
// no entry whole (src/app/campaigns/[campaignId]/MessageParts.tsx).
const BY_SENTENCE = "[data-ui-sentences]";

// `chronicle` reads the server's lines (the same catalog, with the SRD's
// Italian names in its slots); the rest of the page reads `whole`.
export function startUiTranslation(root: Element, whole: UiTranslator, chronicle: UiTranslator = whole): () => void {
  const bySentence = sentenceTranslator(chronicle);
  const translatorFor = (element: Element | null) => (element?.closest(BY_SENTENCE) ? bySentence : whole);
  // What this layer last wrote, so its own writes are not read back as
  // English (a translation may itself be some other entry's English).
  const wroteText = new WeakMap<Node, string>();
  // The English a written node held, for when React rewrites only one of a
  // joined element's texts (a new name): the others are read as English again.
  const englishOf = new WeakMap<Node, string>();
  const english = (node: Node) => (wroteText.get(node) === node.nodeValue ? (englishOf.get(node) ?? "") : (node.nodeValue ?? ""));
  const wroteAttribute = new WeakMap<Element, Map<string, string>>();

  // React writes "{name}'s turn" as two text nodes side by side: the
  // element's texts are read as one, and the translation goes in the first,
  // the others left empty (never removed).
  const joined = (parent: Element): boolean => {
    const nodes = Array.from(parent.childNodes);
    if (nodes.length < 2 || nodes.some((child) => child.nodeType !== Node.TEXT_NODE)) {
      return false;
    }
    if (nodes.every((child) => wroteText.get(child) === child.nodeValue)) {
      return true;
    }
    const englishTexts = nodes.map(english);
    const translated = translatorFor(parent)(englishTexts.join(""));
    if (translated === null) {
      return false;
    }
    nodes.forEach((child, index) => {
      const value = index === 0 ? translated : "";
      englishOf.set(child, englishTexts[index]);
      wroteText.set(child, value);
      child.nodeValue = value;
    });
    return true;
  };

  const text = (node: Node) => {
    const value = node.nodeValue;
    if (value === null || wroteText.get(node) === value || leftAlone(node.parentElement)) {
      return;
    }
    if (node.parentElement && joined(node.parentElement)) {
      return;
    }
    const translated = translatorFor(node.parentElement)(value);
    if (translated !== null) {
      englishOf.set(node, value);
      wroteText.set(node, translated);
      node.nodeValue = translated;
    }
  };

  const attribute = (element: Element, name: string) => {
    const value = element.getAttribute(name);
    const wrote = wroteAttribute.get(element);
    if (value === null || wrote?.get(name) === value || leftAlone(element)) {
      return;
    }
    const translated = whole(value);
    if (translated !== null) {
      (wrote ?? wroteAttribute.set(element, new Map()).get(element)!).set(name, translated);
      element.setAttribute(name, translated);
    }
  };

  const walk = (start: Node) => {
    if (start.nodeType === Node.TEXT_NODE) {
      text(start);
      return;
    }
    if (start.nodeType !== Node.ELEMENT_NODE || leftAlone(start as Element)) {
      return;
    }
    const walker = (start.ownerDocument ?? document).createTreeWalker(start, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.nodeType === Node.ELEMENT_NODE && (node as Element).matches(LEFT_ALONE) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    for (let node: Node | null = walker.currentNode; node; node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) {
        text(node);
      } else {
        for (const name of TRANSLATED_ATTRIBUTES) {
          attribute(node as Element, name);
        }
      }
    }
  };

  walk(root);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "characterData") {
        text(record.target);
      } else if (record.type === "attributes" && record.attributeName) {
        attribute(record.target as Element, record.attributeName);
      } else {
        record.addedNodes.forEach(walk);
      }
    }
  });
  observer.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...TRANSLATED_ATTRIBUTES],
  });
  return () => observer.disconnect();
}
