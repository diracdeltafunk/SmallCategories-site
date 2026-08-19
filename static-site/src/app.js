import { mountCategoryVisualization } from './visualization.js'

const app = document.querySelector('#app')
const numberFormat = new Intl.NumberFormat('en-US')
const CAT_API_URL = 'https://api.thecatapi.com/v1/images/search?limit=1'

let manifestPromise
let propositionsPromise
let factsPromise
let katexRendererPromise
const metadataPromises = new Map()
let routeGeneration = 0
let visualizationCleanup = () => {}

function escapeHtml(value) {
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

function iconText(name, text, options) {
  return `<span class="icon-text">${icon(name, options)}<span>${text}</span></span>`
}

function dataUrl(path) {
  return new URL(`/data/v3/${path}`, window.location.origin).toString()
}

async function fetchJson(path) {
  const response = await fetch(dataUrl(path))
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`)
  return response.json()
}

async function fetchBinary(path) {
  const response = await fetch(dataUrl(path))
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`)
  return response.arrayBuffer()
}

function getManifest() {
  manifestPromise ??= fetchJson('manifest.json')
  return manifestPromise
}

function getKatexRenderer() {
  katexRendererPromise ??= import('katex/contrib/auto-render').then(module => module.default)
  return katexRendererPromise
}

function getPropositions() {
  propositionsPromise ??= fetchJson('propositions.json')
  return propositionsPromise
}

function getFacts(manifest) {
  if (!manifest.factsAvailable) return Promise.resolve(null)
  factsPromise ??= fetchBinary('facts.bin').then(buffer => {
    if (buffer.byteLength !== manifest.categoryCount * 8) {
      throw new Error(`Fact data has ${buffer.byteLength} bytes; expected ${manifest.categoryCount * 8}`)
    }
    return new DataView(buffer)
  })
  return factsPromise
}

function getCellMetadata(cell) {
  if (!cell.metadataCount) return Promise.resolve(new Map())
  const key = `${cell.morphisms}-${cell.objects}`
  if (!metadataPromises.has(key)) {
    metadataPromises.set(key, fetchJson(`metadata/${key}.json`).then(rows =>
      new Map(rows.map(row => [row[0], {
        friendlyName: row[1],
        description: row[2],
      }]))))
  }
  return metadataPromises.get(key)
}

async function getCategoryMetadata(cell, index) {
  return (await getCellMetadata(cell)).get(index) || null
}

function factsAt(view, ordinal) {
  if (!view) return { knownMask: 0, valueMask: 0 }
  const byteOffset = ordinal * 8
  return {
    knownMask: view.getUint32(byteOffset, true),
    valueMask: view.getUint32(byteOffset + 4, true),
  }
}

function categoryLabel(morphisms, objects, index) {
  return `SmallCat(${morphisms},${objects},${index})`
}

function categoryHref(morphisms, objects, index) {
  return `/category/${morphisms}/${objects}/${index}`
}

function findCell(manifest, morphisms, objects) {
  return manifest.cells.find(cell => cell.morphisms === morphisms && cell.objects === objects)
}

function ordinalToCategory(manifest, ordinal) {
  const cell = manifest.cells.find(candidate => ordinal >= candidate.offset && ordinal < candidate.offset + candidate.count)
  if (!cell) return null
  return { ...cell, index: ordinal - cell.offset }
}

function setTitle(title) {
  document.title = title ? `${title} · SmallCats` : 'SmallCats'
}

function hero(title, tone = '', iconName = '') {
  const bulmaTone = { teal: 'primary', green: 'success', dark: 'dark' }[tone] || tone || 'link'
  const heading = iconName ? iconText(iconName, title) : title
  return `<section class="hero is-${bulmaTone} is-small"><div class="hero-body"><div class="container"><h1 class="title">${heading}</h1></div></div></section>`
}

function setCurrentNavigation(path) {
  const firstSegment = path.split('/').filter(Boolean)[0] || ''
  for (const link of document.querySelectorAll('.nav-links a')) {
    const segment = new URL(link.href).pathname.split('/').filter(Boolean)[0] || ''
    if (segment === firstSegment && firstSegment !== 'random') link.setAttribute('aria-current', 'page')
    else link.removeAttribute('aria-current')
  }
}

function showError(error) {
  console.error(error)
  setTitle('Error')
  app.innerHTML = `${hero('Something went wrong', 'dark', 'triangle-exclamation')}
    <section class="section container">
      <div class="notification is-danger is-light">
        <strong>The static SmallCats preview could not load this page.</strong>
        <p>${escapeHtml(error.message || error)}</p>
      </div>
    </section>`
}

function navigate(path, { replace = false } = {}) {
  if (replace) window.history.replaceState({}, '', path)
  else window.history.pushState({}, '', path)
  renderRoute()
}

async function renderHome() {
  const manifest = await getManifest()
  setTitle('')
  app.innerHTML = `
    <section class="hero home-hero">
      <div class="hero-body"><div class="container">
        <h1 class="title">😺 Welcome to SmallCategories!</h1>
        <p class="lead block">The SmallCategories Project is a database of isomorphism classes of small finite categories.</p>
        <p class="block">There are <strong>${numberFormat.format(manifest.categoryCount)}</strong> categories in this build, including every category with at most seven morphisms. Browsing and queries run entirely in your browser.</p>
        <div class="notification is-warning is-light icon-notification">
          ${icon('triangle-exclamation', { large: true })}
          <span>SmallCats.info is in active development. The database and functionality are not yet complete, and all data is subject to change.</span>
        </div>
        ${manifest.factsAvailable ? '' : `<div class="notification is-info is-light">Proposition data is not included in this build.</div>`}
        <div class="buttons">
          <a class="button is-link is-light is-outlined" href="/random" data-link>${iconText('shuffle', 'Random')}</a>
          <a class="button is-primary is-light is-outlined" href="/query" data-link>${iconText('magnifying-glass', 'Query')}</a>
          <a class="button is-info is-light is-outlined" href="https://github.com/diracdeltafunk/SmallCategories">${iconText('github', 'Database Info', { brand: true })}</a>
        </div>
      </div>
      </div>
    </section>`
}

async function renderCategories() {
  const manifest = await getManifest()
  const morphismCounts = [...new Set(manifest.cells.map(cell => cell.morphisms))]

  setTitle('Categories')
  app.innerHTML = `${hero('Browse Categories', '', 'list')}
    <section class="section container">
      <div class="grid two">
        <form class="box" id="browse-form">
          <div class="field">
            <label for="browse-morphisms">Morphisms</label>
            <select id="browse-morphisms" name="morphisms" required>
              <option value="">Select…</option>
              ${morphismCounts.map(value => `<option value="${value}">${value}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="browse-objects">Objects</label>
            <select id="browse-objects" name="objects" required disabled>
              <option value="">Select morphisms first…</option>
            </select>
          </div>
          <p><button class="button is-link" type="submit" disabled>View</button></p>
        </form>
        <div id="browse-results"></div>
      </div>
    </section>`

  const form = document.querySelector('#browse-form')
  const morphisms = form.elements.morphisms
  const objects = form.elements.objects
  const submit = form.querySelector('[type="submit"]')

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
    renderBrowseResults(cell, 1).catch(showError)
  })
}

async function renderBrowseResults(cell, page) {
  const results = document.querySelector('#browse-results')
  if (!cell) {
    results.innerHTML = '<div class="notification is-danger is-light">That part of the database is not available.</div>'
    return
  }
  const pageSize = 10
  const pages = Math.ceil(cell.count / pageSize)
  const start = (page - 1) * pageSize
  const rows = Array.from({ length: Math.min(pageSize, cell.count - start) }, (_, offset) => start + offset)
  const metadata = await getCellMetadata(cell)
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
    button.addEventListener('click', () => renderBrowseResults(cell, Number(button.dataset.page)).catch(showError))
  }
}

async function renderPropositions() {
  const propositions = await getPropositions()
  setTitle('Propositions')
  app.innerHTML = `${hero('Browse Propositions', '', 'toggle-on')}
    <section class="section container">
      ${propositions.length === 0
        ? '<div class="notification is-info is-light">No proposition definitions are included in this build.</div>'
        : `<div class="table-wrap"><table><thead><tr><th>${iconText('link', 'Name')}</th><th>Description</th></tr></thead><tbody>
          ${propositions.map(prop => `<tr><td><a href="/proposition/${encodeURIComponent(prop.name)}" data-link>${escapeHtml(prop.name)}</a></td><td>${escapeHtml(prop.description || '')}</td></tr>`).join('')}
        </tbody></table></div>`}
    </section>`
}

async function renderProposition(name) {
  const propositions = await getPropositions()
  const proposition = propositions.find(item => item.name === name)
  if (!proposition) return renderNotFound()
  setTitle(proposition.name)
  app.innerHTML = `${hero(`Proposition ${escapeHtml(proposition.name)}`, 'green', 'paw')}
    <section class="section container">
      <div class="box">
        <dl>
          <dt><strong>Name</strong></dt><dd><code>${escapeHtml(proposition.name)}</code></dd>
          <dt><strong>Description</strong></dt><dd>${escapeHtml(proposition.description || 'N/A')}</dd>
        </dl>
      </div>
    </section>`
}

function boundValue(formData, name, fallback) {
  const raw = String(formData.get(name) || '').trim()
  if (raw === '') return fallback
  const value = Number(raw)
  return Number.isInteger(value) ? value : NaN
}

async function renderQuery() {
  const [manifest, propositions] = await Promise.all([getManifest(), getPropositions()])
  setTitle('Query')
  app.innerHTML = `${hero('Query', 'teal', 'magnifying-glass')}
    <section class="section container">
      <form class="box" id="query-form">
        <div class="form-grid">
          <div class="field"><label for="morphisms-lb">Minimum morphisms</label><input id="morphisms-lb" name="morphisms_lb" type="number" min="0" placeholder="0"></div>
          <div class="field"><label for="morphisms-ub">Maximum morphisms</label><input id="morphisms-ub" name="morphisms_ub" type="number" min="0" placeholder="No maximum"></div>
          <div class="field"><label for="objects-lb">Minimum objects</label><input id="objects-lb" name="objects_lb" type="number" min="0" placeholder="0"></div>
          <div class="field"><label for="objects-ub">Maximum objects</label><input id="objects-ub" name="objects_ub" type="number" min="0" placeholder="No maximum"></div>
        </div>
        ${propositions.length > 0 ? `<div class="grid two">
          <fieldset><legend>Satisfying</legend><div class="checkboxes">${propositions.map(prop => `<label><input type="checkbox" name="true_prop" value="${prop.bit}"> ${escapeHtml(prop.name)}</label>`).join('')}</div></fieldset>
          <fieldset><legend>Not satisfying</legend><div class="checkboxes">${propositions.map(prop => `<label><input type="checkbox" name="false_prop" value="${prop.bit}"> ${escapeHtml(prop.name)}</label>`).join('')}</div></fieldset>
        </div>` : '<div class="notification is-info is-light">This build supports numeric queries only because it contains no proposition data.</div>'}
        <p><button class="button is-primary" type="submit">${iconText('magnifying-glass', 'Search')}</button></p>
      </form>
      <div id="query-results"></div>
    </section>`

  document.querySelector('#query-form').addEventListener('submit', async event => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const bounds = {
      morphismsLb: boundValue(formData, 'morphisms_lb', 0),
      morphismsUb: boundValue(formData, 'morphisms_ub', Number.MAX_SAFE_INTEGER),
      objectsLb: boundValue(formData, 'objects_lb', 0),
      objectsUb: boundValue(formData, 'objects_ub', Number.MAX_SAFE_INTEGER),
    }
    if (Object.values(bounds).some(Number.isNaN)) {
      document.querySelector('#query-results').innerHTML = '<div class="notification is-danger is-light">Bounds must be whole numbers.</div>'
      return
    }
    const trueProps = formData.getAll('true_prop')
    const falseProps = formData.getAll('false_prop')
    if ((trueProps.length || falseProps.length) && !manifest.factsAvailable) {
      document.querySelector('#query-results').innerHTML = '<div class="notification is-danger is-light">Proposition facts are not available in this build.</div>'
      return
    }
    try {
      await renderQueryResults(manifest, propositions, bounds, trueProps, falseProps)
    } catch (error) {
      showError(error)
    }
  })
}

function matchesPropositions(facts, trueBits, falseBits) {
  return trueBits.every(bit => (facts.knownMask & bit) !== 0 && (facts.valueMask & bit) !== 0) &&
    falseBits.every(bit => (facts.knownMask & bit) !== 0 && (facts.valueMask & bit) === 0)
}

async function renderQueryResults(manifest, propositions, bounds, truePropBits, falsePropBits) {
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
  document.querySelector('#query-results').innerHTML = `<div class="box">
    ${count === 0 ? '<p>No categories matched.</p>' : `<div class="table-wrap"><table><thead><tr><th>${iconText('link', 'ID')}</th><th>Name</th></tr></thead><tbody>
      ${namedRows.map(row => `<tr><td><a href="${categoryHref(row.morphisms, row.objects, row.index)}" data-link>${categoryLabel(row.morphisms, row.objects, row.index)}</a></td><td class="${row.metadata?.friendlyName ? '' : 'muted'}">${escapeHtml(row.metadata?.friendlyName || 'N/A')}</td></tr>`).join('')}
    </tbody></table></div><p class="help">Showing ${numberFormat.format(rows.length)} of ${numberFormat.format(count)} results.</p>`}
  </div>`
}

async function loadCategoryTable(cell, index) {
  const shardIndex = Math.floor(index / cell.shardSize)
  const shard = await fetchJson(`categories/${cell.morphisms}-${cell.objects}-${shardIndex}.json`)
  const table = shard.tables[index - shard.start]
  if (!table) throw new Error(`Category index ${index} is missing from its data shard`)
  return table
}

function renderMatrix(table, morphisms) {
  if (morphisms === 0) return '<p>The empty category has no morphisms or multiplication table.</p>'
  return `<div class="table-wrap"><table class="matrix"><tbody>
    <tr><th><i>row</i> ∘ <i>col</i></th>${Array.from({ length: morphisms }, (_, i) => `<th>${i}</th>`).join('')}</tr>
    ${table.map((row, rowIndex) => `<tr><th>${rowIndex}</th>${row.map(value => `<td>${value < morphisms ? value : '<span class="undefined">/</span>'}</td>`).join('')}</tr>`).join('')}
  </tbody></table></div>`
}

function renderCategoryFacts(propositions, facts, factsAvailable) {
  if (!factsAvailable) {
    return '<div class="notification is-info is-light">Proposition values are not included in this build.</div>'
  }
  const known = propositions.filter(proposition => (facts.knownMask & (2 ** proposition.bit)) !== 0)
  if (known.length === 0) return '<p class="muted">No proposition values are known for this category.</p>'
  return `<div class="fact-list">
    ${known.map(proposition => {
      const value = (facts.valueMask & (2 ** proposition.bit)) !== 0
      return `<a class="tag is-${value ? 'success' : 'danger'}" href="/proposition/${encodeURIComponent(proposition.name)}" data-link aria-label="${escapeHtml(proposition.name)}: ${value ? 'true' : 'false'}">${iconText(value ? 'check' : 'xmark', escapeHtml(proposition.name))}</a>`
    }).join('')}
  </div>`
}

async function renderCategory(morphisms, objects, index) {
  const manifest = await getManifest()
  const cell = findCell(manifest, morphisms, objects)
  if (!cell || index < 0 || index >= cell.count) return renderNotFound()
  const [table, metadata, propositions, factData] = await Promise.all([
    loadCategoryTable(cell, index),
    getCategoryMetadata(cell, index),
    getPropositions(),
    getFacts(manifest),
  ])
  const facts = factsAt(factData, cell.offset + index)
  const label = categoryLabel(morphisms, objects, index)
  setTitle(label)
  app.innerHTML = `${hero(label, 'green', 'paw')}
    <section class="section container">
      <div class="grid two">
        <div>
          <h2>Quick Reference</h2>
          <div class="table-wrap"><table class="table is-striped is-fullwidth">
            <tr><th>Canonical ID</th><td>${label}</td></tr>
            <tr><th>Morphisms</th><td>${morphisms}</td></tr>
            <tr><th>Objects</th><td>${objects}</td></tr>
            <tr><th>Index</th><td>${index}</td></tr>
            <tr><th>Name</th><td class="${metadata?.friendlyName ? '' : 'muted'}">${escapeHtml(metadata?.friendlyName || 'N/A')}</td></tr>
            <tr><th>Description</th><td class="${metadata?.description ? '' : 'muted'}">${escapeHtml(metadata?.description || 'N/A')}</td></tr>
          </table></div>
        </div>
        <div>
          <h2>Visualization</h2>
          ${morphisms > 0 ? `<div class="box viz-box">
            <div class="viz-toolbar"><span class="help">Drag the objects to rearrange the quiver.</span><button class="button is-small is-light" type="button" data-reset-viz>${iconText('rotate-left', 'Reset layout')}</button></div>
            <div class="viz" id="category-viz"></div>
          </div><p class="help">Morphisms 0 through ${objects - 1} are identities, shown as objects.</p>` : '<p>The empty category has no quiver.</p>'}
        </div>
      </div>
    </section>
    <section class="section container">
      <div class="grid two">
        <div><h2>Table</h2>${renderMatrix(table, morphisms)}${morphisms > 0 ? '<p class="help">“/” indicates an undefined composition.</p>' : ''}</div>
        <div><h2>Facts</h2>${renderCategoryFacts(propositions, facts, manifest.factsAvailable)}</div>
      </div>
    </section>`
  visualizationCleanup = mountCategoryVisualization(
    document.querySelector('#category-viz'),
    table,
    objects,
    morphisms,
  )
}

async function renderStats() {
  const manifest = await getManifest()
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
  app.innerHTML = `${hero('Statistics', 'green', 'chart-simple')}
    <section class="section">
      <div class="level">
        <div class="level-item has-text-centered"><div><p class="heading">Categories</p><p class="title">${numberFormat.format(manifest.categoryCount)}</p></div></div>
        <div class="level-item has-text-centered"><div><p class="heading">Propositions</p><p class="title">${numberFormat.format(manifest.propositionCount)}</p></div></div>
        <div class="level-item has-text-centered"><div><p class="heading">Prop. Values</p><p class="title">${numberFormat.format(manifest.relationCount || 0)}</p></div></div>
      </div>
    </section>
    <section class="section container">
      <div class="notification is-info is-light methodology-callout">
        ${icon('circle-check', { large: true })}
        <div>
          <p><strong>These counts have a second, structural check.</strong></p>
          <p>Read how the categories are enumerated, how connected components verify the totals, and why published and earlier SmallCats totals differ.</p>
          <p><a class="button is-info is-light is-outlined" href="/enumeration" data-link>${iconText('magnifying-glass-chart', 'Enumeration & verification')}</a></p>
        </div>
      </div>
      <div class="table-container"><table class="table is-bordered stats-table">
        <thead><tr><th>Objects →<br>Morphisms ↓</th>${Array.from({ length: maxObjects + 1 }, (_, i) => `<th>${i}</th>`).join('')}<th>Total</th></tr></thead>
        <tbody>${rows.join('')}<tr><th>Total</th>${columnTotals.map(total => `<th>${numberFormat.format(total)}</th>`).join('')}<th>${numberFormat.format(manifest.categoryCount)}</th></tr></tbody>
      </table></div>
      <p class="help stats-help">
        This table shows the number of categories in this build with a given number of objects and morphisms.
        <br>Each nonempty cell is complete: the database contains every isomorphism class of categories with the corresponding numbers of objects and morphisms.
        <br>There are no categories with fewer morphisms than objects, or with zero objects and more than zero morphisms, so these cells are blank and grayed out.
        <br>Other blank cells indicate that this build does not yet contain categories with those numbers of objects and morphisms, even though such categories exist.
        <br>Green cells indicate a stable value; see <a href="https://oeis.org/A125701">A125701</a>.
      </p>
    </section>`
}

async function renderEnumeration(generation) {
  const renderMathInElement = await getKatexRenderer()
  if (generation !== routeGeneration) return
  setTitle('Enumeration & Verification')
  app.innerHTML = String.raw`${hero('Enumeration & Verification', 'info', 'magnifying-glass-chart')}
    <section class="section container">
      <div class="content methodology-content">
        <p class="lead">SmallCats is built by turning the category axioms into a finite constraint problem. For each pair $(n,k)$, the program finds every composition table with $n$ morphisms and $k$ objects, then keeps one table from each possible relabelling. Here is how that translation works, how we check the result, and why two of our counts differ from those reported by Cruttwell and Leblanc.</p>

        <h2>${iconText('list-ol', 'Representing a category by a table')}</h2>
        <p>Fix nonnegative integers $n$ and $k$. Let $T(n,k)$ be the number of isomorphism classes of categories with $n$ morphisms and $k$ objects. The morphisms include the $k$ identities, so necessarily $k\leq n$. We count categories up to isomorphism, not merely up to equivalence, and take $T(0,0)=1$ for the empty category.</p>
        <p>We label the morphisms by $M$, reserving the subset $O$ for the identities:</p>
        $$
        M=\{0,\dots,n-1\},
        \qquad
        O=\{0,\dots,k-1\}\subseteq M.
        $$
        <p>Here each object is identified with its identity morphism. For $f\in M$, write $d(f)$ and $c(f)$ for the identity morphisms of its domain and codomain; in particular, $d(i)=c(i)=i$ for $i\in O$. We store composition in an $n\times n$ table $A$, using the extra value $n$ to mean that a composite is undefined:</p>
        $$
        A_{f,g}=
        \begin{cases}
        f\circ g, &amp; d(f)=c(g),\\
        n, &amp; d(f)\neq c(g).
        \end{cases}
        $$
        <p>Our convention is that $f\circ g$ means “first $g$, then $f$.” The identity and associativity axioms become the constraints</p>
        $$
        A_{f,d(f)}=f=A_{c(f),f}
        $$
        <p>and</p>
        $$
        A_{A_{f,g},h}=A_{f,A_{g,h}}
        $$
        <p>whenever $d(f)=c(g)$ and $d(g)=c(h)$. Together with the domain, codomain, and composability constraints, these are exactly the category axioms in multiplication-table form. We give this finite constraint problem to <a href="https://github.com/minion/minion">Minion</a>, which enumerates every labelled solution.</p>

        <h2>${iconText('gears', 'Removing the labels')}</h2>
        <p>Of course, one category usually appears under many labellings. The $k$ identity morphisms may be permuted among themselves, and the other $n-k$ morphisms may be permuted among themselves. Thus the relevant relabelling group is</p>
        $$
        G_{n,k}=S_k\times S_{n-k},
        $$
        <p>where $S_r$ is the symmetric group on $r$ labels. Extend each $\sigma\in G_{n,k}$ by setting $\sigma(n)=n$, so that the undefined value remains fixed. The relabelled table is</p>
        $$
        (\sigma\cdot A)_{f,g}
        =\sigma\!\left(A_{\sigma^{-1}(f),\sigma^{-1}(g)}\right).
        $$
        <p>Two tables describe isomorphic categories exactly when they lie in the same orbit of this action. We read tables row by row and choose</p>
        $$
        \operatorname{can}(A)=\min_{\sigma\in G_{n,k}}(\sigma\cdot A)
        $$
        <p>in lexicographic order. Replacing every solution by $\operatorname{can}(A)$ and retaining one copy leaves exactly one representative of each isomorphism class.</p>
        <p>For the larger cells, we divide the same search into smaller pieces according to intrinsic data such as the number of nonidentity idempotents, non-idempotent endomorphisms, and inverse pairs between distinct objects. Each category has one definite combination of these counts, so it appears in exactly one piece. We then reunite the results and canonicalize under the full group $G_{n,k}$.</p>

        <h2>${iconText('circle-check', 'Checking the stored tables')}</h2>
        <p>Once the tables are generated, a separate validator reads them back in and reconstructs every identity, domain, codomain, and defined composite. It then checks the type of every composite and every associativity equation. All $249{,}382$ tables in the current database pass.</p>
        <p>Next, for each table $A$, we compute every permitted relabelling and verify that $\operatorname{can}(A)=A$. Across the whole database this means checking $4{,}054{,}192{,}164$ relabelled tables. Finally, we encode the composition tables as colored graphs and canonicalize those graphs independently; no two entries in a cell are isomorphic.</p>
        <p>These checks tell us that every stored row is a genuine category and that no category has been stored twice. They do not, by themselves, tell us whether a row is missing. For that we use a second count, based on connected components.</p>

        <h2>${iconText('diagram-project', 'Counting connected components')}</h2>
        <p>Form a graph whose vertices are the objects of a category. Each nonidentity morphism $f\colon x\to y$ supplies an undirected edge between $x$ and $y$. We call the category connected when this graph is connected. Every finite category is uniquely a disjoint union of connected categories.</p>
        <p>Let $C(n,k)$ be the number of connected categories with $n$ morphisms and $k$ objects. Since a general category is a finite multiset of connected categories, we have the formal power-series identity</p>
        <div class="methodology-formula">
        $$
        \sum_{n\geq 0}\sum_{k=0}^{n}T(n,k)x^ny^k
        =
        \prod_{n\geq 1}\prod_{k=1}^{n}
        \left(1-x^ny^k\right)^{-C(n,k)}.
        $$
        </div>
        <p>Here is why. One fixed connected category with $n$ morphisms and $k$ objects may appear zero times, once, twice, and so on. Its possible contributions are</p>
        $$
        1+x^ny^k+x^{2n}y^{2k}+\cdots
        =\frac{1}{1-x^ny^k}.
        $$
        <p>There are $C(n,k)$ connected isomorphism classes of that size, which gives the exponent $C(n,k)$. Multiplying over all sizes constructs every finite multiset of connected categories, and hence every finite category.</p>
        <p>Consequently, the connected counts in smaller cells determine the number $D(n,k)$ of disconnected categories before we inspect the $(n,k)$ file:</p>
        $$
        D(n,k)=
        [x^ny^k]
        \prod_{a=1}^{n-1}\prod_{b=1}^{a}
        \left(1-x^ay^b\right)^{-C(a,b)},
        \qquad
        T(n,k)=C(n,k)+D(n,k).
        $$
        <p>We check more than the final coefficient. If a component size $(a,b)$ occurs $r$ times and there are $c=C(a,b)$ connected categories of that size, then there are $\binom{c+r-1}{r}$ ways to choose those components. Multiplying over the distinct component sizes gives the exact number of categories with that component pattern. Every disconnected component pattern in every populated cell occurs with the expected multiplicity.</p>
        <p>This calculation determines the disconnected part of a cell, but it cannot detect a missing connected category: that still requires the exhaustive search or a separate argument. This distinction is exactly what we need for the two disputed cells.</p>

        <h2>${iconText('scale-balanced', 'The disputed and corrected counts')}</h2>
        <div class="table-container"><table class="table is-bordered is-striped methodology-table">
          <thead><tr><th>Morphisms</th><th>Objects</th><th>Cruttwell–Leblanc</th><th>Earlier SmallCats</th><th>Current SmallCats</th></tr></thead>
          <tbody>
            <tr><td>9</td><td>3</td><td>60,201</td><td>60,322</td><td><strong>60,322</strong></td></tr>
            <tr><td>10</td><td>4</td><td>65,922</td><td>68,815</td><td><strong>68,990</strong></td></tr>
          </tbody>
        </table></div>

        <h3>9 morphisms and 3 objects</h3>
        <p>Start with the part that does not depend on the search in this cell. The smaller connected counts give</p>
        $$
        D(9,3)=56{,}754.
        $$
        <p>The original, unsplit SmallCats search finds $C(9,3)=3{,}568$ connected categories. Therefore</p>
        $$
        T(9,3)=56{,}754+3{,}568=60{,}322.
        $$
        <p>The Cruttwell–Leblanc total would instead imply</p>
        $$
        C(9,3)=60{,}201-56{,}754=3{,}447,
        $$
        <p>so their total has a connected contribution $121$ smaller than ours. Their <a href="https://www.reluctantm.com/gcruttw/publications/ams2014CruttwellCountingFiniteCats.pdf">presentation</a> says that this is where their program changed to counting connected categories and reconstructing the disconnected ones, making that stage the natural place to investigate. Without their code or intermediate output, however, we cannot distinguish an error in the connected search from an error in the reconstruction or reporting.</p>

        <h3>10 morphisms and 4 objects</h3>
        <p>Here the reported value $65{,}922$ cannot satisfy the component formula. Even if we use Cruttwell and Leblanc’s lower value at $(9,3)$, their smaller counts produce</p>
        $$
        D_{\mathrm{CL}}(10,4)=67{,}392&gt;65{,}922.
        $$
        <p>There would already be more disconnected categories than their proposed total. Using the corrected value $T(9,3)=60{,}322$ instead gives</p>
        $$
        D(10,4)=67{,}513.
        $$
        <p>It remains to count the connected categories. An exhaustive search gives $1{,}465$ connected <em>skeletal</em> categories, meaning that no two distinct objects are isomorphic.</p>
        <p>Every nonskeletal category is obtained from its skeleton $S$ by replacing a skeleton object $x$ with $m_x$ isomorphic copies. The resulting category $\mathcal C$ has</p>
        $$
        \sum_x m_x=4,
        \qquad
        |\operatorname{Mor}(\mathcal C)|
        =\sum_{x,y\in\operatorname{Ob}(S)}
        m_xm_y\,|\operatorname{Hom}_S(x,y)|.
        $$
        <p>If the skeleton has one object, then that object is copied four times, and its identity morphism alone produces $4^2=16$ morphisms. If the skeleton has two objects, their multiplicities are either $(3,1)$ or $(2,2)$. The identity morphisms contribute $3^2+1^2=10$ or $2^2+2^2=8$ morphisms, and connectedness requires at least one morphism between the two objects, contributing another $3$ or $4$. Thus the two-object cases have at least $13$ or $12$ morphisms.</p>
        <p>A nonskeletal category in the $(10,4)$ cell must therefore have a three-object skeleton with multiplicities $(2,1,1)$. Such a connected skeleton has at least five morphisms. Duplicating one object adds three identity-derived morphisms and at least one copy of an incident morphism, so it adds at least four altogether. A skeleton which expands to exactly ten morphisms can consequently have only five or six morphisms.</p>
        <p>We now filter the complete $(5,3)$ and $(6,3)$ lists to their connected skeletal entries, mark each possible object to duplicate, and quotient those marked choices by automorphisms of the skeleton. Exactly $12$ isomorphism classes remain.</p>
        <p>Hence</p>
        $$
        C(10,4)=1{,}465+12=1{,}477
        $$
        <p>and finally</p>
        $$
        \begin{aligned}
        T(10,4)
        &amp;=D(10,4)+C(10,4)\\
        &amp;=67{,}513+1{,}477\\
        &amp;=68{,}990.
        \end{aligned}
        $$
        <p>The earlier SmallCats file contained $68{,}815$ categories. It lacked $163$ disconnected categories and the $12$ nonskeletal connected categories above, for a total of $175$ additional isomorphism classes.</p>

        <div class="buttons methodology-links">
          <a class="button is-link is-light is-outlined" href="https://github.com/diracdeltafunk/SmallCategories">${iconText('github', 'Generator and database', { brand: true })}</a>
          <a class="button is-info is-light is-outlined" href="https://oeis.org/A125697">${iconText('table-cells', 'OEIS category table')}</a>
          <a class="button is-success is-light is-outlined" href="/stats" data-link>${iconText('chart-simple', 'Back to statistics')}</a>
        </div>
      </div>
    </section>`
  renderMathInElement(document.querySelector('.methodology-content'), {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '$', right: '$', display: false },
    ],
    throwOnError: false,
    strict: 'warn',
    trust: false,
  })
}

function renderAbout() {
  setTitle('About')
  app.innerHTML = `${hero('About', 'info', 'question')}
    <section class="section container">
      <p>The SmallCategories Project produces, maintains, and publishes a database of small finite categories.</p>
      <p>The category tables are generated with the <a href="https://github.com/minion/minion">${iconText('github', 'Minion constraint solver', { brand: true })}</a>, then canonicalized to eliminate isomorphic copies. The <a href="https://github.com/diracdeltafunk/SmallCategories">${iconText('github', 'database source and generator', { brand: true })}</a> are public.</p>
      <p>This static version is generated from those canonical tables. It performs browsing and queries in the browser, so ordinary site usage requires neither a running application server nor an online SQL database.</p>
      <p>SmallCategories is a project by <a href="https://benspitz.com">Ben Spitz</a>. Contributions are welcome.</p>
    </section>`
}

async function renderSmallCat(generation) {
  setTitle('Small Cat')
  app.innerHTML = `${hero('Small Cat', '', 'paw')}
    <section class="section container" id="smolcat-content" aria-live="polite">
      <p class="loading">${icon('ellipsis', { animation: 'fade' })} Finding a small cat…</p>
    </section>`

  try {
    const response = await fetch(CAT_API_URL, { headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`The Cat API returned ${response.status}`)
    const cats = await response.json()
    const imageUrl = new URL(cats?.[0]?.url)
    if (imageUrl.protocol !== 'https:') throw new Error('The Cat API returned an invalid image URL')
    if (generation !== routeGeneration) return

    document.querySelector('#smolcat-content').innerHTML = `
      <img width="100" src="${escapeHtml(imageUrl.toString())}" alt="A small cat" referrerpolicy="no-referrer">
      <p class="help">Small cats provided by <a href="https://thecatapi.com">The Cat API</a>.</p>`
  } catch (error) {
    if (generation !== routeGeneration) return
    console.error(error)
    document.querySelector('#smolcat-content').innerHTML = '<p>Sorry, couldn\'t fetch a cat 😿. Maybe the API usage limit has been exceeded?</p>'
  }
}

function renderNotFound() {
  setTitle('Not Found')
  app.innerHTML = `${hero('404 · Not Found 😿', 'warning')}
    <section class="section container"><p>The requested page <code>${escapeHtml(window.location.pathname)}</code> could not be found.</p><p>If you think this is a bug, <a href="https://github.com/diracdeltafunk/SmallCategories-site/issues">report it ${icon('arrow-up-right-from-square')}</a>.</p><p><a class="button is-warning" href="/" data-link>Return home</a></p></section>`
}

async function renderRandom() {
  const manifest = await getManifest()
  const ordinal = Math.floor(Math.random() * manifest.categoryCount)
  const category = ordinalToCategory(manifest, ordinal)
  if (!category) throw new Error('Could not choose a random category')
  const path = categoryHref(category.morphisms, category.objects, category.index)
  window.history.replaceState({}, '', path)
  await renderCategory(category.morphisms, category.objects, category.index)
}

async function renderRoute() {
  visualizationCleanup()
  visualizationCleanup = () => {}
  const generation = ++routeGeneration
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  setCurrentNavigation(path)
  document.querySelector('#nav-links').classList.remove('is-active')
  document.querySelector('.nav-toggle').classList.remove('is-active')
  document.querySelector('.nav-toggle').setAttribute('aria-expanded', 'false')
  app.innerHTML = `<section class="section container"><p class="loading">${icon('ellipsis', { animation: 'fade' })} Loading…</p></section>`
  window.scrollTo({ top: 0, behavior: 'instant' })

  try {
    if (path === '/') await renderHome()
    else if (path === '/cats') await renderCategories()
    else if (path === '/props') await renderPropositions()
    else if (path === '/query' || path === '/query_mobile') await renderQuery()
    else if (path === '/stats') await renderStats()
    else if (path === '/enumeration') await renderEnumeration(generation)
    else if (path === '/about') renderAbout()
    else if (path === '/smolcats') await renderSmallCat(generation)
    else if (path === '/random') await renderRandom()
    else {
      const canonical = /^\/category\/(\d+)\/(\d+)\/(\d+)$/.exec(path)
      const proposition = /^\/proposition\/([^/]+)$/.exec(path)
      if (canonical) await renderCategory(Number(canonical[1]), Number(canonical[2]), Number(canonical[3]))
      else if (proposition) await renderProposition(decodeURIComponent(proposition[1]))
      else renderNotFound()
    }
    if (generation === routeGeneration) app.focus({ preventScroll: true })
  } catch (error) {
    if (generation === routeGeneration) showError(error)
  }
}

document.addEventListener('click', event => {
  const link = event.target.closest('a[data-link]')
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  const url = new URL(link.href)
  if (url.origin !== window.location.origin) return
  event.preventDefault()
  navigate(`${url.pathname}${url.search}${url.hash}`)
})

document.querySelector('.nav-toggle').addEventListener('click', event => {
  const links = document.querySelector('#nav-links')
  const open = links.classList.toggle('is-active')
  event.currentTarget.classList.toggle('is-active', open)
  event.currentTarget.setAttribute('aria-expanded', String(open))
})

window.addEventListener('popstate', renderRoute)
renderRoute()
