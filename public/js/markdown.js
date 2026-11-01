// Minimal markdown shared by the browser (in-app rules sheet, public/js/games.js)
// and the server (SEO rules pages, server.mjs): headings, paragraphs, ordered
// and unordered lists, tables, **bold**, *italic*, [links](url). Input is
// escaped first via the caller's `esc`.
export function renderMarkdown(md, esc) {
  const lines = md.replace(/\r/g, '').split('\n');
  let out = '';
  let list = null;
  let table = null; // { head: bool, rows: [] }
  const inline = (s) => esc(s)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" rel="noopener">$1</a>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');
  const closeList = () => { if (list) { out += `</${list}>`; list = null; } };
  const closeTable = () => {
    if (!table) return;
    const [head, ...body] = table.rows;
    out += '<table>';
    if (head) out += `<thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>`;
    if (body.length) out += `<tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
    out += '</table>';
    table = null;
  };
  const close = () => { closeList(); closeTable(); };
  for (const line of lines) {
    let m;
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const cells = line.trim().slice(1, -1).split('|').map((c) => c.trim());
      if (!table) { closeList(); table = { rows: [] }; }
      if (/^:?-+:?$/.test(cells.join('')) && table.rows.length === 1) continue; // header separator row
      table.rows.push(cells);
      continue;
    }
    closeTable();
    // Indentation isn't tracked (this renderer has no true nesting): a
    // bullet or number under a list item still renders as a flat item,
    // which beats leaking the raw "- " marker into a paragraph. A numbered
    // item carries its own `value` so numbering survives a bullet sub-list
    // splitting one <ol> into two.
    if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) { closeList(); out += `<h${m[1].length + 1}>${inline(m[2])}</h${m[1].length + 1}>`; }
    else if ((m = /^\s*(\d+)\.\s+(.*)$/.exec(line))) { if (list !== 'ol') { closeList(); out += '<ol>'; list = 'ol'; } out += `<li value="${m[1]}">${inline(m[2])}</li>`; }
    else if ((m = /^\s*[-*]\s+(.*)$/.exec(line))) { if (list !== 'ul') { closeList(); out += '<ul>'; list = 'ul'; } out += `<li>${inline(m[1])}</li>`; }
    else if (!line.trim()) closeList();
    else { closeList(); out += `<p>${inline(line)}</p>`; }
  }
  close();
  return out;
}
