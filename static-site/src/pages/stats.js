import { getManifest } from '../data.js'
import { numberFormat, setTitle } from '../ui.js'
import statsTemplate from './stats.html'

export async function renderStatsPage({ app, isCurrent }) {
  const manifest = await getManifest()
  if (!isCurrent()) return

  const maxMorphisms = Math.max(...manifest.cells.map(cell => cell.morphisms))
  const maxObjects = Math.max(...manifest.cells.map(cell => cell.objects))
  const counts = new Map(manifest.cells.map(cell => [`${cell.morphisms}-${cell.objects}`, cell.count]))
  const columnTotals = Array.from({ length: maxObjects + 1 }, () => 0)
  const rows = []

  for (let morphisms = 0; morphisms <= maxMorphisms; morphisms += 1) {
    let rowTotal = 0
    const cells = []
    for (let objects = 0; objects <= maxObjects; objects += 1) {
      const count = counts.get(`${morphisms}-${objects}`) || 0
      rowTotal += count
      columnTotals[objects] += count
      const impossible = morphisms < objects || (objects === 0 && morphisms > 0)
      const stable = count > 0 && 2 * morphisms <= 3 * objects
      cells.push(`<td class="${impossible ? 'impossible' : ''} ${stable ? 'has-text-success' : ''}">${count || ''}</td>`)
    }
    rows.push(`<tr><th>${morphisms}</th>${cells.join('')}<th>${numberFormat.format(rowTotal)}</th></tr>`)
  }

  setTitle('Statistics')
  app.innerHTML = statsTemplate
  app.querySelector('[data-stat="categories"]').textContent = numberFormat.format(manifest.categoryCount)
  app.querySelector('[data-stat="propositions"]').textContent = numberFormat.format(manifest.propositionCount)
  // Every proposition is known for every category, so this is just the product.
  app.querySelector('[data-stat="relations"]').textContent =
    numberFormat.format(manifest.categoryCount * manifest.propositionCount)
  app.querySelector('[data-stats-heading]').innerHTML = `
    <th>Objects →<br>Morphisms ↓</th>
    ${Array.from({ length: maxObjects + 1 }, (_, index) => `<th>${index}</th>`).join('')}
    <th>Total</th>`
  app.querySelector('[data-stats-body]').innerHTML = `
    ${rows.join('')}
    <tr><th>Total</th>${columnTotals.map(total => `<th>${numberFormat.format(total)}</th>`).join('')}<th>${numberFormat.format(manifest.categoryCount)}</th></tr>`
}
