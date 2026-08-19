let manifestPromise
let propositionsPromise
let factsPromise
const metadataPromises = new Map()

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

export function getManifest() {
  manifestPromise ??= fetchJson('manifest.json')
  return manifestPromise
}

export function getPropositions() {
  propositionsPromise ??= fetchJson('propositions.json')
  return propositionsPromise
}

export function getFacts(manifest) {
  if (!manifest.factsAvailable) return Promise.resolve(null)
  factsPromise ??= fetchBinary('facts.bin').then(buffer => {
    if (buffer.byteLength !== manifest.categoryCount * 8) {
      throw new Error(`Fact data has ${buffer.byteLength} bytes; expected ${manifest.categoryCount * 8}`)
    }
    return new DataView(buffer)
  })
  return factsPromise
}

export function getCellMetadata(cell) {
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

export async function getCategoryMetadata(cell, index) {
  return (await getCellMetadata(cell)).get(index) || null
}

export function factsAt(view, ordinal) {
  if (!view) return { knownMask: 0, valueMask: 0 }
  const byteOffset = ordinal * 8
  return {
    knownMask: view.getUint32(byteOffset, true),
    valueMask: view.getUint32(byteOffset + 4, true),
  }
}

export function categoryLabel(morphisms, objects, index) {
  return `SmallCat(${morphisms},${objects},${index})`
}

export function categoryHref(morphisms, objects, index) {
  return `/category/${morphisms}/${objects}/${index}`
}

export function findCell(manifest, morphisms, objects) {
  return manifest.cells.find(cell => cell.morphisms === morphisms && cell.objects === objects)
}

export function ordinalToCategory(manifest, ordinal) {
  const cell = manifest.cells.find(candidate => ordinal >= candidate.offset && ordinal < candidate.offset + candidate.count)
  if (!cell) return null
  return { ...cell, index: ordinal - cell.offset }
}

export async function loadCategoryTable(cell, index) {
  const shardIndex = Math.floor(index / cell.shardSize)
  const shard = await fetchJson(`categories/${cell.morphisms}-${cell.objects}-${shardIndex}.json`)
  const table = shard.tables[index - shard.start]
  if (!table) throw new Error(`Category index ${index} is missing from its data shard`)
  return table
}
