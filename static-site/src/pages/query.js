import {
  categoryHref,
  categoryLabel,
  factsAt,
  getCategoryMetadata,
  getFacts,
  getManifest,
  getPropositions,
} from '../data.js'
import { escapeHtml, iconText, numberFormat, setTitle } from '../ui.js'
import queryTemplate from './query.html'

function boundValue(formData, name, fallback) {
  const raw = String(formData.get(name) || '').trim()
  if (raw === '') return fallback
  const value = Number(raw)
  return Number.isInteger(value) ? value : NaN
}

function matchesPropositions(facts, trueBits, falseBits) {
  return trueBits.every(bit => (facts.knownMask & bit) !== 0 && (facts.valueMask & bit) !== 0) &&
    falseBits.every(bit => (facts.knownMask & bit) !== 0 && (facts.valueMask & bit) === 0)
}

async function renderQueryResults(app, manifest, propositions, bounds, truePropBits, falsePropBits, isLatest) {
  const cells = manifest.cells.filter(cell =>
    cell.morphisms >= bounds.morphismsLb &&
    cell.morphisms <= bounds.morphismsUb &&
    cell.objects >= bounds.objectsLb &&
    cell.objects <= bounds.objectsUb)
  const propositionBits = new Set(propositions.map(proposition => proposition.bit))
  const selectedBits = [...truePropBits, ...falsePropBits].map(Number)
  if (selectedBits.some(bit => !propositionBits.has(bit))) throw new Error('The query contains an unknown proposition')
  const trueBits = truePropBits.map(bit => 2 ** Number(bit))
  const falseBits = falsePropBits.map(bit => 2 ** Number(bit))
  const needsFacts = trueBits.length > 0 || falseBits.length > 0
  const factData = needsFacts ? await getFacts(manifest) : null
  if (!isLatest()) return
  let count = 0
  const rows = []

  for (const cell of cells) {
    for (let index = 0; index < cell.count; index += 1) {
      const facts = needsFacts ? factsAt(factData, cell.offset + index) : null
      if (needsFacts && !matchesPropositions(facts, trueBits, falseBits)) continue
      count += 1
      if (rows.length < 10) rows.push({ ...cell, index })
    }
  }

  const namedRows = await Promise.all(rows.map(async row => ({
    ...row,
    metadata: await getCategoryMetadata(row, row.index),
  })))
  if (!isLatest()) return
  app.querySelector('#query-results').innerHTML = `<div class="box">
    ${count === 0 ? '<p>No categories matched.</p>' : `<div class="table-wrap"><table><thead><tr><th>${iconText('link', 'ID')}</th><th>Name</th></tr></thead><tbody>
      ${namedRows.map(row => `<tr><td><a href="${categoryHref(row.morphisms, row.objects, row.index)}" data-link>${categoryLabel(row.morphisms, row.objects, row.index)}</a></td><td class="${row.metadata?.friendlyName ? '' : 'muted'}">${escapeHtml(row.metadata?.friendlyName || 'N/A')}</td></tr>`).join('')}
    </tbody></table></div><p class="help">Showing ${numberFormat.format(rows.length)} of ${numberFormat.format(count)} results.</p>`}
  </div>`
}

export async function renderQueryPage({ app, isCurrent, onError }) {
  const [manifest, propositions] = await Promise.all([getManifest(), getPropositions()])
  if (!isCurrent()) return

  setTitle('Query')
  app.innerHTML = queryTemplate
  const propositionContainer = app.querySelector('[data-query-propositions]')
  propositionContainer.innerHTML = propositions.length > 0
    ? `<div class="grid two">
        <fieldset><legend>Satisfying</legend><div class="checkboxes">${propositions.map(proposition => `<label><input type="checkbox" name="true_prop" value="${proposition.bit}"> ${escapeHtml(proposition.name)}</label>`).join('')}</div></fieldset>
        <fieldset><legend>Not satisfying</legend><div class="checkboxes">${propositions.map(proposition => `<label><input type="checkbox" name="false_prop" value="${proposition.bit}"> ${escapeHtml(proposition.name)}</label>`).join('')}</div></fieldset>
      </div>`
    : '<div class="notification is-info is-light">This build supports numeric queries only because it contains no proposition data.</div>'

  let submissionGeneration = 0
  app.querySelector('#query-form').addEventListener('submit', async event => {
    event.preventDefault()
    const submission = ++submissionGeneration
    const isLatest = () => isCurrent() && submission === submissionGeneration
    const formData = new FormData(event.currentTarget)
    const bounds = {
      morphismsLb: boundValue(formData, 'morphisms_lb', 0),
      morphismsUb: boundValue(formData, 'morphisms_ub', Number.MAX_SAFE_INTEGER),
      objectsLb: boundValue(formData, 'objects_lb', 0),
      objectsUb: boundValue(formData, 'objects_ub', Number.MAX_SAFE_INTEGER),
    }
    if (Object.values(bounds).some(Number.isNaN)) {
      app.querySelector('#query-results').innerHTML = '<div class="notification is-danger is-light">Bounds must be whole numbers.</div>'
      return
    }
    const trueProps = formData.getAll('true_prop')
    const falseProps = formData.getAll('false_prop')
    if ((trueProps.length || falseProps.length) && !manifest.factsAvailable) {
      app.querySelector('#query-results').innerHTML = '<div class="notification is-danger is-light">Proposition facts are not available in this build.</div>'
      return
    }
    try {
      await renderQueryResults(app, manifest, propositions, bounds, trueProps, falseProps, isLatest)
    } catch (error) {
      if (isLatest()) onError(error)
    }
  })
}
