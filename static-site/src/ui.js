export const numberFormat = new Intl.NumberFormat('en-US')

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function icon(name, { brand = false, large = false, animation = '' } = {}) {
  return `<span class="icon${large ? ' is-large' : ''}"><i class="fa-${brand ? 'brands' : 'solid'} fa-${name}${large ? ' fa-2x' : ''}${animation ? ` fa-${animation}` : ''}" aria-hidden="true"></i></span>`
}

export function iconText(name, text, options) {
  return `<span class="icon-text">${icon(name, options)}<span>${text}</span></span>`
}

export function setTitle(title) {
  document.title = title ? `${title} · SmallCats` : 'SmallCats'
}
