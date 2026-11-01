// Update a node's children to match a markup string, touching only what
// differs. `el.innerHTML = markup` rebuilds every node, which (a) replays the
// CSS entry animation of everything on screen, (b) drops a finger that is
// mid-press, and (c) resets scroll, focus and playing media. Someone else's
// answer landing should change a number, not the screen.
//
// The result is the same tree innerHTML would build. Positional on purpose: no
// keys, no moves, a node of a different kind is simply replaced. A subtree
// marked data-keep is left alone when the new markup has the same key there.
export function morph(el, markup) {
  const tpl = document.createElement('template');
  tpl.innerHTML = markup;
  patchChildren(el, tpl.content);
}

function patchChildren(a, b) {
  const old = [...a.childNodes];
  const next = [...b.childNodes];
  for (let i = 0; i < Math.max(old.length, next.length); i++) {
    const o = old[i];
    const x = next[i];
    if (!x) { o.remove(); continue; }
    if (!o) { a.appendChild(x); continue; }
    if (o.nodeType !== x.nodeType || o.nodeName !== x.nodeName) { o.replaceWith(x); continue; }
    if (o.nodeType !== 1) { if (o.data !== x.data) o.data = x.data; continue; }
    if (o.dataset.keep && o.dataset.keep === x.dataset.keep) continue;
    if (o.isEqualNode(x)) continue;
    patchAttrs(o, x);
    patchChildren(o, x);
    // Typed-in state outranks the attribute once a user has touched a control;
    // the markup is the truth for a checkbox, radio or option.
    if (o.localName === 'input' && (o.type === 'checkbox' || o.type === 'radio')) o.checked = x.checked;
    else if (o.localName === 'option') o.selected = x.selected;
  }
}

function patchAttrs(o, x) {
  for (const { name, value } of [...x.attributes]) if (o.getAttribute(name) !== value) o.setAttribute(name, value);
  for (const { name } of [...o.attributes]) if (!x.hasAttribute(name)) o.removeAttribute(name);
}
