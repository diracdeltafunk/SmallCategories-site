import propositionsTemplate from './propositions.html'
import { escapeHtml, iconText, setTitle } from '../ui.js'
import { getPropositions } from '../data.js'

export async function renderPropositionsPage({ app, isCurrent }) {
  const propositions = await getPropositions()
  if (!isCurrent()) return

  setTitle('Propositions')
  app.innerHTML = propositionsTemplate
  app.querySelector('[data-propositions-content]').innerHTML = propositions.length === 0
    ? '<div class="notification is-info is-light">No proposition definitions are included in this build.</div>'
    : `<div class="table-wrap"><table><thead><tr><th>${iconText('link', 'Name')}</th><th>Description</th></tr></thead><tbody>
      ${propositions.map(prop => `<tr><td><a href="/proposition/${encodeURIComponent(prop.name)}" data-link>${escapeHtml(prop.name)}</a></td><td>${escapeHtml(prop.description || '')}</td></tr>`).join('')}
    </tbody></table></div>`
}
