import {
  categoryLabel,
  findCell,
  getCategoryMetadata,
  getManifest,
  getPropositions,
  loadCategory,
} from '../data.js'
import { escapeHtml, iconText, setTitle } from '../ui.js'
import { mountCategoryVisualization } from '../visualization.js'
import categoryTemplate from './category.html'

function renderMatrix(table, morphisms) {
  if (morphisms === 0) return '<p>The empty category has no morphisms or multiplication table.</p>'
  return `<div class="table-wrap"><table class="matrix"><tbody>
    <tr><th><i>row</i> ∘ <i>col</i></th>${Array.from({ length: morphisms }, (_, index) => `<th>${index}</th>`).join('')}</tr>
    ${table.map((row, rowIndex) => `<tr><th>${rowIndex}</th>${row.map(value => `<td>${value < morphisms ? value : '<span class="undefined">/</span>'}</td>`).join('')}</tr>`).join('')}
  </tbody></table></div>`
}

// Every proposition is known for every category, so there is no longer an
// "unknown" case to render.
function renderCategoryFacts(propositions, mask) {
  return `<div class="fact-list">
    ${propositions.map(proposition => {
      const value = (mask & (2 ** proposition.bit)) !== 0
      return `<a class="tag is-${value ? 'success' : 'danger'}" href="/proposition/${encodeURIComponent(proposition.name)}" data-link aria-label="${escapeHtml(proposition.name)}: ${value ? 'true' : 'false'}">${iconText(value ? 'check' : 'xmark', escapeHtml(proposition.name))}</a>`
    }).join('')}
  </div>`
}

function setText(app, selector, value) {
  app.querySelector(selector).textContent = value
}

export async function renderCategoryPage({ app, morphisms, objects, index, isCurrent }) {
  const manifest = await getManifest()
  const cell = findCell(manifest, morphisms, objects)
  if (!cell || index < 0 || index >= cell.count) return { found: false, cleanup: () => {} }

  const [category, metadata, propositions] = await Promise.all([
    loadCategory(cell, index),
    getCategoryMetadata(cell, index),
    getPropositions(),
  ])
  if (!isCurrent()) return { found: true, stale: true, cleanup: () => {} }

  const { table, mask } = category
  const label = categoryLabel(morphisms, objects, index)
  setTitle(label)
  app.innerHTML = categoryTemplate
  setText(app, '[data-category-title]', label)
  setText(app, '[data-category-label]', label)
  setText(app, '[data-category-morphisms]', morphisms)
  setText(app, '[data-category-objects]', objects)
  setText(app, '[data-category-index]', index)

  const name = app.querySelector('[data-category-name]')
  name.textContent = metadata?.friendlyName || 'N/A'
  name.classList.toggle('muted', !metadata?.friendlyName)
  const description = app.querySelector('[data-category-description]')
  description.textContent = metadata?.description || 'N/A'
  description.classList.toggle('muted', !metadata?.description)

  const visualization = app.querySelector('[data-category-visualization]')
  visualization.innerHTML = morphisms > 0
    ? `<div class="box viz-box">
        <div class="viz-toolbar"><span class="help">Drag the objects to rearrange the quiver.</span><button class="button is-small is-light" type="button" data-reset-viz>${iconText('rotate-left', 'Reset layout')}</button></div>
        <div class="viz" id="category-viz"></div>
      </div><p class="help">Morphisms 0 through ${objects - 1} are identities, shown as objects.</p>`
    : '<p>The empty category has no quiver.</p>'
  app.querySelector('[data-category-table]').innerHTML = `${renderMatrix(table, morphisms)}${morphisms > 0 ? '<p class="help">“/” indicates an undefined composition.</p>' : ''}`
  app.querySelector('[data-category-facts]').innerHTML = renderCategoryFacts(propositions, mask)

  return {
    found: true,
    cleanup: mountCategoryVisualization(app.querySelector('#category-viz'), table, objects, morphisms),
  }
}
