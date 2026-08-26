let manifestPromise
let propositionsPromise
const metadataPromises = new Map()
const bitmapPromises = new Map()

function dataUrl(path) {
  return new URL(`/data/v5/${path}`, window.location.origin).toString()
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

/// A cell's categories that satisfy one proposition, as a packed bitmap.
///
/// Only propositions that are true of some but not all of the cell are stored:
/// when `trueCounts` says none or all, the answer is known without a request.
export function getPropositionBitmap(cell, bit) {
  const count = cell.trueCounts[bit]
  if (count === 0) return Promise.resolve({ all: false })
  if (count === cell.count) return Promise.resolve({ all: true })
  const key = `${cell.morphisms}-${cell.objects}-${bit}`
  if (!bitmapPromises.has(key)) {
    bitmapPromises.set(
      key,
      fetchBinary(`bitmaps/${key}.bin`).then(buffer => ({ bits: new Uint8Array(buffer) })),
    )
  }
  return bitmapPromises.get(key)
}

/// Whether the category at `index` in the cell satisfies the proposition.
export function bitmapHas(bitmap, index) {
  if (bitmap.bits) return (bitmap.bits[index >> 3] >> (index & 7) & 1) === 1
  return bitmap.all
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

/// One category: its multiplication table and its propositions, which travel
/// together in the same shard so a category page makes a single request.
export async function loadCategory(cell, index) {
  const shardIndex = Math.floor(index / cell.shardSize)
  const shard = await fetchJson(`categories/${cell.morphisms}-${cell.objects}-${shardIndex}.json`)
  const table = shard.tables[index - shard.start]
  if (!table) throw new Error(`Category index ${index} is missing from its data shard`)
  return { table, mask: shard.masks[index - shard.start] }
}
