import propositionTemplate from './proposition.html'
import { setTitle } from '../ui.js'
import { getPropositions } from '../data.js'

export async function renderPropositionPage({ app, name, isCurrent }) {
  const propositions = await getPropositions()
  if (!isCurrent()) return false

  const proposition = propositions.find(item => item.name === name)
  if (!proposition) return false

  setTitle(proposition.name)
  app.innerHTML = propositionTemplate
  app.querySelector('[data-proposition-heading]').textContent = `Proposition ${proposition.name}`
  app.querySelector('[data-proposition-name]').textContent = proposition.name
  app.querySelector('[data-proposition-description]').textContent = proposition.description || 'N/A'
  return true
}
