// Generic set-up form for a game's meta.options (stepper | choice | multi |
// toggle). Used by pass-and-play set-up and by the host in the lobby.
import { esc } from './ui.js';

export function optionsForm(schema, values, { disabled = false, id = '' } = {}) {
  const dis = disabled ? 'disabled' : '';
  const rows = schema.map((o) => {
    const v = values[o.key];
    let control = '';
    if (o.type === 'stepper') {
      control = `<div class="stepper">
        <button type="button" data-step="-1" data-key="${esc(o.key)}" aria-label="Less ${esc(o.label)}" ${dis || (v <= o.min ? 'disabled' : '')}>&minus;</button>
        <output>${esc(v)}${esc(o.suffix || '')}</output>
        <button type="button" data-step="1" data-key="${esc(o.key)}" aria-label="More ${esc(o.label)}" ${dis || (v >= o.max ? 'disabled' : '')}>+</button>
      </div>`;
    } else if (o.type === 'choice' || o.type === 'multi') {
      const on = (c) => (o.type === 'multi' ? (v || []).includes(c.value) : v === c.value);
      control = `<div class="chips" role="${o.type === 'multi' ? 'group' : 'radiogroup'}" aria-label="${esc(o.label)}">${o.choices.map((c) => `<button type="button" class="chip ${on(c) ? 'on' : ''}" role="${o.type === 'multi' ? 'checkbox' : 'radio'}" aria-checked="${on(c)}" data-key="${esc(o.key)}" data-val="${esc(c.value)}" ${dis}>${esc(c.label)}</button>`).join('')}</div>`;
    } else if (o.type === 'toggle') {
      control = `<button type="button" class="toggle ${v ? 'on' : ''}" role="switch" aria-checked="${!!v}" data-key="${esc(o.key)}" ${dis}><span></span></button>`;
    }
    return `<div class="opt opt-${o.type}"><span class="opt-label">${esc(o.label)}</span>${control}</div>`;
  }).join('');
  return `<div class="opts" ${id ? `id="${esc(id)}"` : ''}>${rows}</div>`;
}

// Wire clicks; calls onChange(newValues) and re-renders itself in place.
export function wireOptionsForm(el, schema, values, onChange) {
  let vals = structuredClone(values);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-key]');
    if (!b || b.disabled) return;
    const o = schema.find((x) => x.key === b.dataset.key);
    if (!o) return;
    if (o.type === 'stepper') {
      const next = Math.min(o.max, Math.max(o.min, vals[o.key] + Number(b.dataset.step) * (o.step || 1)));
      if (next === vals[o.key]) return;
      vals[o.key] = next;
    } else if (o.type === 'choice') {
      const c = o.choices.find((x) => String(x.value) === b.dataset.val);
      vals[o.key] = c.value;
    } else if (o.type === 'multi') {
      const c = o.choices.find((x) => String(x.value) === b.dataset.val);
      const set = new Set(vals[o.key]);
      if (set.has(c.value)) {
        if (set.size === 1) {
          b.classList.add('shake');
          setTimeout(() => b.classList.remove('shake'), 400);
          return; // at least one stays on
        }
        set.delete(c.value);
      } else set.add(c.value);
      vals[o.key] = o.choices.map((x) => x.value).filter((x) => set.has(x));
    } else if (o.type === 'toggle') {
      vals[o.key] = !vals[o.key];
    }
    if (navigator.vibrate) try { navigator.vibrate(6); } catch { /* fine */ }
    const fresh = document.createElement('div');
    fresh.innerHTML = optionsForm(schema, vals, { id: el.id });
    el.innerHTML = fresh.firstElementChild.innerHTML;
    onChange(structuredClone(vals));
  });
  return { set(v) { vals = structuredClone(v); } };
}
