const app = document.querySelector('#app')
const numberFormat = new Intl.NumberFormat('en-US')

let manifestPromise
let propositionsPromise
let factsPromise
let legacyIdsPromise
const metadataPromises = new Map()
let routeGeneration = 0

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function dataUrl(path) {
  return new URL(`/data/${path}`, window.location.origin).toString()
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

function getLegacyIds() {
  legacyIdsPromise ??= fetchJson('legacy-ids.json')
  return legacyIdsPromise
}

function getCellMetadata(cell) {
  if (!cell.metadataCount) return Promise.resolve(new Map())
  const key = `${cell.morphisms}-${cell.objects}`
  if (!metadataPromises.has(key)) {
    metadataPromises.set(key, fetchJson(`metadata/${key}.json`).then(rows =>
      new Map(rows.map(row => [row[0], {
        id: row[1],
        friendlyName: row[2],
        description: row[3],
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

function hero(title, tone = '') {
  return `<div class="hero ${tone}"><div class="container"><h1>${title}</h1></div></div>`
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
  app.innerHTML = `${hero('Something went wrong', 'dark')}
    <section class="section container">
      <div class="notice error">
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
    <section class="section container">
      <h1>😺 Welcome to SmallCategories!</h1>
      <p class="lead">The SmallCategories Project is a database of isomorphism classes of small finite categories.</p>
      <p>This static build contains <strong>${numberFormat.format(manifest.categoryCount)}</strong> categories and does not need an application server or an online database.</p>
      ${manifest.factsAvailable ? '' : `<div class="notice info">
        This is the parallel static migration. Supabase-only proposition data and legacy UUIDs will be added after a verified read-only export.
      </div>`}
      <div class="buttons">
        <a class="button" href="/random" data-link>Random category</a>
        <a class="button secondary" href="/query" data-link>Query</a>
        <a class="button secondary" href="https://github.com/diracdeltafunk/SmallCategories">Database source</a>
      </div>
    </section>`
}

async function renderCategories() {
  const manifest = await getManifest()
  const morphismCounts = [...new Set(manifest.cells.map(cell => cell.morphisms))]

  setTitle('Categories')
  app.innerHTML = `${hero('Browse Categories')}
    <section class="section container">
      <div class="grid two">
        <form class="panel" id="browse-form">
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
          <p><button class="button" type="submit" disabled>View</button></p>
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
    results.innerHTML = '<div class="notice error">That part of the database is not available.</div>'
    return
  }
  const pageSize = 10
  const pages = Math.ceil(cell.count / pageSize)
  const start = (page - 1) * pageSize
  const rows = Array.from({ length: Math.min(pageSize, cell.count - start) }, (_, offset) => start + offset)
  const metadata = await getCellMetadata(cell)
  results.innerHTML = `
    ${pages > 1 ? `<div class="pagination">
      <button class="button secondary" type="button" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>Previous</button>
      <span>Page ${page} of ${pages}</span>
      <button class="button secondary" type="button" data-page="${page + 1}" ${page === pages ? 'disabled' : ''}>Next</button>
    </div>` : ''}
    <div class="table-wrap"><table>
      <thead><tr><th>ID</th><th>Name</th></tr></thead>
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
  app.innerHTML = `${hero('Browse Propositions')}
    <section class="section container">
      ${propositions.length === 0
        ? '<div class="notice info">Proposition definitions will appear here after the Supabase export is merged.</div>'
        : `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Description</th></tr></thead><tbody>
          ${propositions.map(prop => `<tr><td><a href="/proposition/${encodeURIComponent(prop.id)}" data-link>${escapeHtml(prop.name)}</a></td><td>${escapeHtml(prop.description || '')}</td></tr>`).join('')}
        </tbody></table></div>`}
    </section>`
}

async function renderProposition(id) {
  const propositions = await getPropositions()
  const proposition = propositions.find(item => item.id === id)
  if (!proposition) return renderNotFound()
  setTitle(proposition.name)
  app.innerHTML = `${hero(`Proposition ${escapeHtml(proposition.name)}`, 'green')}
    <section class="section container">
      <div class="panel">
        <dl>
          <dt><strong>ID</strong></dt><dd>${escapeHtml(proposition.id)}</dd>
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
  app.innerHTML = `${hero('Query', 'teal')}
    <section class="section container">
      <form class="panel" id="query-form">
        <div class="form-grid">
          <div class="field"><label for="morphisms-lb">Minimum morphisms</label><input id="morphisms-lb" name="morphisms_lb" type="number" min="0" placeholder="0"></div>
          <div class="field"><label for="morphisms-ub">Maximum morphisms</label><input id="morphisms-ub" name="morphisms_ub" type="number" min="0" placeholder="No maximum"></div>
          <div class="field"><label for="objects-lb">Minimum objects</label><input id="objects-lb" name="objects_lb" type="number" min="0" placeholder="0"></div>
          <div class="field"><label for="objects-ub">Maximum objects</label><input id="objects-ub" name="objects_ub" type="number" min="0" placeholder="No maximum"></div>
        </div>
        ${propositions.length > 0 ? `<div class="grid two">
          <fieldset><legend>Satisfying</legend><div class="checkboxes">${propositions.map(prop => `<label><input type="checkbox" name="true_prop" value="${escapeHtml(prop.id)}"> ${escapeHtml(prop.name)}</label>`).join('')}</div></fieldset>
          <fieldset><legend>Not satisfying</legend><div class="checkboxes">${propositions.map(prop => `<label><input type="checkbox" name="false_prop" value="${escapeHtml(prop.id)}"> ${escapeHtml(prop.name)}</label>`).join('')}</div></fieldset>
        </div>` : '<div class="notice info">This first migration build supports numeric queries. Proposition filters will be enabled after the Supabase export.</div>'}
        <p><button class="button" type="submit">Search</button></p>
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
      document.querySelector('#query-results').innerHTML = '<div class="notice error">Bounds must be whole numbers.</div>'
      return
    }
    const trueProps = formData.getAll('true_prop')
    const falseProps = formData.getAll('false_prop')
    if ((trueProps.length || falseProps.length) && !manifest.factsAvailable) {
      document.querySelector('#query-results').innerHTML = '<div class="notice error">Proposition facts have not been imported into this build yet.</div>'
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

async function renderQueryResults(manifest, propositions, bounds, truePropIds, falsePropIds) {
  const cells = manifest.cells.filter(cell =>
    cell.morphisms >= bounds.morphismsLb &&
    cell.morphisms <= bounds.morphismsUb &&
    cell.objects >= bounds.objectsLb &&
    cell.objects <= bounds.objectsUb)
  const propositionById = new Map(propositions.map(proposition => [proposition.id, proposition]))
  const trueBits = truePropIds.map(id => 2 ** propositionById.get(id).bit)
  const falseBits = falsePropIds.map(id => 2 ** propositionById.get(id).bit)
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
  document.querySelector('#query-results').innerHTML = `<div class="panel">
    ${count === 0 ? '<p>No categories matched.</p>' : `<div class="table-wrap"><table><thead><tr><th>ID</th><th>Name</th></tr></thead><tbody>
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

function categoryVisualization(table, objects, morphisms) {
  if (morphisms === 0) return ''
  const width = 640
  const height = 260
  const centerX = width / 2
  const centerY = height / 2
  const radiusX = objects <= 2 ? 150 : 220
  const radiusY = objects <= 2 ? 65 : 90
  const positions = Array.from({ length: objects }, (_, index) => {
    if (objects === 1) return { x: centerX, y: centerY }
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / objects
    return { x: centerX + radiusX * Math.cos(angle), y: centerY + radiusY * Math.sin(angle) }
  })
  const groups = new Map()
  for (let morphism = objects; morphism < morphisms; morphism += 1) {
    const source = Array.from({ length: objects }, (_, i) => i).find(i => table[morphism][i] < morphisms)
    const target = Array.from({ length: objects }, (_, i) => i).find(i => table[i][morphism] < morphisms)
    if (source === undefined || target === undefined) continue
    const key = `${source}-${target}`
    const group = groups.get(key) || { source, target, members: [] }
    group.members.push(morphism)
    groups.set(key, group)
  }
  const edges = [...groups.values()].map(group => {
    const source = positions[group.source]
    const target = positions[group.target]
    const label = group.members.join(', ')
    if (group.source === group.target) {
      const x = source.x
      const y = source.y
      return `<path d="M ${x - 10} ${y - 16} C ${x - 45} ${y - 70}, ${x + 45} ${y - 70}, ${x + 10} ${y - 16}" fill="none" stroke="currentColor" marker-end="url(#arrow)"/>
        <text x="${x}" y="${y - 58}" text-anchor="middle">${label}</text>`
    }
    const labelX = (source.x + target.x) / 2
    const labelY = (source.y + target.y) / 2 - 8
    return `<line x1="${source.x}" y1="${source.y}" x2="${target.x}" y2="${target.y}" stroke="currentColor" marker-end="url(#arrow)"/>
      <text x="${labelX}" y="${labelY}" text-anchor="middle">${label}</text>`
  }).join('')
  const nodes = positions.map((position, index) => `<g transform="translate(${position.x} ${position.y})"><circle r="18" fill="#3e78ad"/><text y="5" fill="white" text-anchor="middle">${index}</text></g>`).join('')
  return `<div class="viz"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Category quiver">
    <defs><marker id="arrow" viewBox="0 0 10 10" refX="29" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor"/></marker></defs>
    <g font-family="system-ui, sans-serif" font-size="13">${edges}${nodes}</g>
  </svg></div>`
}

function renderCategoryFacts(propositions, facts, factsAvailable) {
  if (!factsAvailable) {
    return '<div class="notice info">Proposition values will be attached after the Supabase export.</div>'
  }
  const known = propositions.filter(proposition => (facts.knownMask & (2 ** proposition.bit)) !== 0)
  if (known.length === 0) return '<p class="muted">No proposition values are known for this category.</p>'
  return `<div class="table-wrap"><table><thead><tr><th>Proposition</th><th>Value</th></tr></thead><tbody>
    ${known.map(proposition => {
      const value = (facts.valueMask & (2 ** proposition.bit)) !== 0
      return `<tr><td><a href="/proposition/${encodeURIComponent(proposition.id)}" data-link>${escapeHtml(proposition.name)}</a></td><td>${value ? 'True' : 'False'}</td></tr>`
    }).join('')}
  </tbody></table></div>`
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
  app.innerHTML = `${hero(label, 'green')}
    <section class="section container">
      <div class="grid two">
        <div>
          <h2>Quick Reference</h2>
          <div class="table-wrap"><table>
            <tr><th>Canonical ID</th><td>${label}</td></tr>
            <tr><th>Morphisms</th><td>${morphisms}</td></tr>
            <tr><th>Objects</th><td>${objects}</td></tr>
            <tr><th>Index</th><td>${index}</td></tr>
            ${metadata ? `<tr><th>Legacy UUID</th><td><code>${escapeHtml(metadata.id)}</code></td></tr>` : ''}
            <tr><th>Name</th><td class="${metadata?.friendlyName ? '' : 'muted'}">${escapeHtml(metadata?.friendlyName || 'N/A')}</td></tr>
            <tr><th>Description</th><td class="${metadata?.description ? '' : 'muted'}">${escapeHtml(metadata?.description || 'N/A')}</td></tr>
          </table></div>
        </div>
        <div>
          <h2>Visualization</h2>
          ${categoryVisualization(table, objects, morphisms)}
          ${morphisms > 0 ? `<p class="help">Morphisms 0 through ${objects - 1} are identities, shown as objects.</p>` : ''}
        </div>
      </div>
    </section>
    <section class="section container">
      <div class="grid two">
        <div><h2>Table</h2>${renderMatrix(table, morphisms)}${morphisms > 0 ? '<p class="help">“/” indicates an undefined composition.</p>' : ''}</div>
        <div><h2>Facts</h2>${renderCategoryFacts(propositions, facts, manifest.factsAvailable)}</div>
      </div>
    </section>`
}

async function renderLegacyCategory(id) {
  const manifest = await getManifest()
  if (manifest.legacyIdsAvailable) {
    const location = (await getLegacyIds())[id]
    if (!location) return renderNotFound()
    const path = categoryHref(location[0], location[1], location[2])
    window.history.replaceState({}, '', path)
    return renderCategory(location[0], location[1], location[2])
  }
  setTitle('Legacy category link')
  app.innerHTML = `${hero('Legacy category link', 'dark')}
    <section class="section container">
      <div class="notice error">
        The Supabase UUID map has not been imported into this migration build yet. This route will be preserved before production cutover.
      </div>
    </section>`
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
      cells.push(`<td class="number ${impossible ? 'impossible' : ''} ${stable ? 'stable' : ''}">${count || ''}</td>`)
    }
    rows.push(`<tr><th class="number">${morphisms}</th>${cells.join('')}<th class="number">${numberFormat.format(rowTotal)}</th></tr>`)
  }
  setTitle('Statistics')
  app.innerHTML = `${hero('Statistics', 'green')}
    <section class="section container">
      <div class="grid three">
        <div class="card"><span class="muted">Categories</span><strong class="stat">${numberFormat.format(manifest.categoryCount)}</strong></div>
        <div class="card"><span class="muted">Propositions</span><strong class="stat">${numberFormat.format(manifest.propositionCount)}</strong></div>
        <div class="card"><span class="muted">Known facts</span><strong class="stat">${numberFormat.format(manifest.relationCount || 0)}</strong></div>
      </div>
    </section>
    <section class="section container">
      <div class="table-wrap"><table>
        <thead><tr><th>Morphisms ↓<br>Objects →</th>${Array.from({ length: maxObjects + 1 }, (_, i) => `<th class="number">${i}</th>`).join('')}<th class="number">Total</th></tr></thead>
        <tbody>${rows.join('')}<tr><th>Total</th>${columnTotals.map(total => `<th class="number">${numberFormat.format(total)}</th>`).join('')}<th class="number">${numberFormat.format(manifest.categoryCount)}</th></tr></tbody>
      </table></div>
      <p class="help">Every displayed count is compiled directly from the canonical category files used for this build.</p>
    </section>`
}

function renderAbout() {
  setTitle('About')
  app.innerHTML = `${hero('About')}
    <section class="section container">
      <p>The SmallCategories Project produces, maintains, and publishes a database of small finite categories.</p>
      <p>The category tables are generated with the <a href="https://github.com/minion/minion">Minion constraint solver</a>, then canonicalized to eliminate isomorphic copies. The <a href="https://github.com/diracdeltafunk/SmallCategories">database source and generator</a> are public.</p>
      <p>This static version is generated from those canonical tables. It performs browsing and queries in the browser, so ordinary site usage requires neither a running application server nor an online SQL database.</p>
      <p>SmallCategories is a project by <a href="https://benspitz.com">Ben Spitz</a>. Contributions are welcome.</p>
    </section>`
}

function renderSupport() {
  setTitle('Support')
  app.innerHTML = `${hero('Support', 'dark')}
    <section class="section container">
      <p>The static migration is intended to make normal website hosting free. Donations remain useful for domain registration and the computational work needed to extend the category database.</p>
      <p><a class="button" href="https://ko-fi.com/B0B3DOCLE">Support SmallCategories on Ko-fi</a></p>
    </section>`
}

function renderSmallCat() {
  setTitle('Small Cat')
  app.innerHTML = `${hero('Small Cat')}
    <section class="section container"><p style="font-size:6rem;margin:0" aria-label="A small cat">🐈</p><p class="help">The static site does not transmit an API key to a third-party cat service.</p></section>`
}

function renderNotFound() {
  setTitle('Not Found')
  app.innerHTML = `${hero('404 · Not Found', 'dark')}
    <section class="section container"><p>The requested page <code>${escapeHtml(window.location.pathname)}</code> could not be found.</p><p><a class="button" href="/" data-link>Return home</a></p></section>`
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
  const generation = ++routeGeneration
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  setCurrentNavigation(path)
  document.querySelector('#nav-links').classList.remove('open')
  document.querySelector('.nav-toggle').setAttribute('aria-expanded', 'false')
  app.innerHTML = '<section class="section container"><p class="loading">Loading…</p></section>'
  window.scrollTo({ top: 0, behavior: 'instant' })

  try {
    if (path === '/') await renderHome()
    else if (path === '/cats') await renderCategories()
    else if (path === '/props') await renderPropositions()
    else if (path === '/query' || path === '/query_mobile') await renderQuery()
    else if (path === '/stats') await renderStats()
    else if (path === '/about') renderAbout()
    else if (path === '/support') renderSupport()
    else if (path === '/smolcats') renderSmallCat()
    else if (path === '/random') await renderRandom()
    else {
      const canonical = /^\/category\/(\d+)\/(\d+)\/(\d+)$/.exec(path)
      const legacy = /^\/category\/([^/]+)$/.exec(path)
      const proposition = /^\/proposition\/([^/]+)$/.exec(path)
      if (canonical) await renderCategory(Number(canonical[1]), Number(canonical[2]), Number(canonical[3]))
      else if (legacy) await renderLegacyCategory(decodeURIComponent(legacy[1]))
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
  const open = links.classList.toggle('open')
  event.currentTarget.setAttribute('aria-expanded', String(open))
})

window.addEventListener('popstate', renderRoute)
renderRoute()
