const list = document.querySelector('#initiative-list');
const message = document.querySelector('#initiative-message');
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}
async function load() {
  try {
    const response = await fetch('/api/actions');
    if (!response.ok) throw new Error();
    const { actions } = await response.json();
    list.replaceChildren();
    for (const action of actions) {
      const link = el('a', null, 'initiative-card');
      link.href = '/actions/' + action.slug;
      const media = el('div', null, 'initiative-media');
      if (action.image) {
        const image = document.createElement('img');
        image.src = action.image; image.alt = ''; image.loading = 'lazy';
        image.addEventListener('error', () => image.remove()); media.append(image);
      } else media.append(el('span', 'זיכרון שהופך למעשה', 'initiative-placeholder'));
      const body = el('div', null, 'initiative-body');
      body.append(el('h3', action.title), el('p', action.description));
      body.append(el('span', action.destination === '/chuppah' ? 'לפרטים ולבחירת תאריך ←' : 'לצפייה ולפרטים ↗', 'initiative-cta'));
      link.append(media, body); list.append(link);
    }
    message.textContent = actions.length ? '' : 'יוזמות נוספות יופיעו כאן בקרוב.';
  } catch {
    message.textContent = 'לא ניתן לטעון את היוזמות כרגע.';
    const retry = el('button', 'נסו שוב', 'secondary');
    retry.type = 'button'; retry.addEventListener('click', load); message.append(' ', retry);
  } finally { list.setAttribute('aria-busy', 'false'); }
}
load();
