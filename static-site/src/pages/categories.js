import categoriesTemplate from './categories.html'
import { escapeHtml, iconText, setTitle } from '../ui.js'
import {
  categoryHref,
  categoryLabel,
  findCell,
  getCellMetadata,
  getManifest,
} from '../data.js'

async function renderBrowseResults({ app, cell, page, isCurrent, onError }) {
  const results = app.querySelector('#browse-results')
  if (!results || !isCurrent()) return
  if (!cell) {
    results.innerHTML = '<div class="notification is-danger is-light">That part of the database is not available.</div>'
    return
  }

  const pageSize = 10
  const pages = Math.ceil(cell.count / pageSize)
  const start = (page - 1) * pageSize
  const rows = Array.from({ length: Math.min(pageSize, cell.count - start) }, (_, offset) => start + offset)
  const metadata = await getCellMetadata(cell)
  if (!isCurrent()) return

  results.innerHTML = `
    ${pages > 1 ? `<div class="pagination">
      <button class="button is-link is-light" type="button" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>Previous</button>
      <span>Page ${page} of ${pages}</span>
      <button class="button is-link is-light" type="button" data-page="${page + 1}" ${page === pages ? 'disabled' : ''}>Next</button>
    </div>` : ''}
    <div class="table-wrap"><table>
      <thead><tr><th>${iconText('link', 'ID')}</th><th>Name</th></tr></thead>
      <tbody>${rows.map(index => `<tr>
        <td><a href="${categoryHref(cell.morphisms, cell.objects, index)}" data-link>${categoryLabel(cell.morphisms, cell.objects, index)}</a></td>
        <td class="${metadata.get(index)?.friendlyName ? '' : 'muted'}">${escapeHtml(metadata.get(index)?.friendlyName || 'N/A')}</td>
      </tr>`).join('')}</tbody>
    </table></div>`

  for (const button of results.querySelectorAll('[data-page]')) {
    button.addEventListener('click', () => {
      renderBrowseResults({
        app,
        cell,
        page: Number(button.dataset.page),
        isCurrent,
        onError,
      }).catch(error => {
        if (isCurrent()) onError(error)
      })
    })
  }
}

export async function renderCategoriesPage({ app, isCurrent, onError }) {
  const manifest = await getManifest()
  if (!isCurrent()) return

  const morphismCounts = [...new Set(manifest.cells.map(cell => cell.morphisms))]
  setTitle('Categories')
  app.innerHTML = categoriesTemplate

  const form = app.querySelector('#browse-form')
  const morphisms = form.elements.morphisms
  const objects = form.elements.objects
  const submit = form.querySelector('[type="submit"]')

  morphisms.insertAdjacentHTML(
    'beforeend',
    morphismCounts.map(value => `<option value="${value}">${value}</option>`).join(''),
  )

  morphisms.addEventListener('change', () => {
    const selected = Number(morphisms.value)
    const objectCounts = manifest.cells
      .filter(cell => cell.morphisms === selected)
      .map(cell => cell.objects)
    objects.innerHTML = `<option value="">Select…</option>${objectCounts.map(value => `<option value="${value}">${value}</option>`).join('')}`
    objects.disabled = false
    submit.disabled = true
  })
  objects.addEventListener('change', () => { submit.disabled = !objects.value })
  form.addEventListener('submit', event => {
    event.preventDefault()
    const cell = findCell(manifest, Number(morphisms.value), Number(objects.value))
    renderBrowseResults({ app, cell, page: 1, isCurrent, onError }).catch(error => {
      if (isCurrent()) onError(error)
    })
  })
}
