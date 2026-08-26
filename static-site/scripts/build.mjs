import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import {
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build as bundle } from 'esbuild'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const SITE_DIR = resolve(SCRIPT_DIR, '..')
const DEFAULT_DATABASE_DIR = resolve(SITE_DIR, '../../SmallCategories/database')
const SOURCE_DIR = resolve(SITE_DIR, 'src')
const FINAL_DIR = resolve(SITE_DIR, 'dist')
const TEMP_DIR = resolve(SITE_DIR, '.dist-tmp')
const PUBLIC_FILES = ['.nojekyll', '_headers', 'favicon.svg', 'index.html']
const SHARD_SIZE = 2048
const PROPOSITION_BITS = 18
const DATA_VERSION = 'v5'

function parseArgs(argv) {
  const result = { databaseDir: DEFAULT_DATABASE_DIR, websiteDataDir: null }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--database' && argv[i + 1]) {
      result.databaseDir = resolve(argv[++i])
      continue
    }
    if (argv[i] === '--website-data' && argv[i + 1]) {
      result.websiteDataDir = resolve(argv[++i])
      continue
    }
    if (argv[i] === '--help') {
      console.log('Usage: node scripts/build.mjs [--database /path/to/database] [--website-data /path/to/website-data]')
      process.exit(0)
    }
    throw new Error(`Unknown or incomplete argument: ${argv[i]}`)
  }
  return result
}

async function ensureDirectory(path, label) {
  const details = await stat(path).catch(() => null)
  if (!details?.isDirectory()) {
    throw new Error(`${label} is not a directory: ${path}`)
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value)}\n`, 'utf8')
}

// Each shard carries the propositions of the categories in it, so a category
// page needs exactly one request and no global fact file.
async function writeShard(outputDir, morphisms, objects, shardIndex, start, tables, masks) {
  const path = join(outputDir, 'data', DATA_VERSION, 'categories', `${morphisms}-${objects}-${shardIndex}.json`)
  await writeJson(path, {
    morphisms,
    objects,
    start,
    tables,
    masks,
  })
}

// The only thing here that a human wrote: names and descriptions.  Every other
// property of a category is computed from its multiplication table, so there is
// nothing to join and nothing that can fall out of step with the database.
async function loadNames(websiteDataDir) {
  if (!websiteDataDir) return { rows: [], propositions: [] }
  const propositions = JSON.parse(await readFile(join(websiteDataDir, 'propositions.json'), 'utf8'))
  const rows = JSON.parse(await readFile(join(websiteDataDir, 'names.json'), 'utf8'))
  for (const [position, row] of rows.entries()) {
    if (!Number.isInteger(row.morphisms) || !Number.isInteger(row.objects) || !Number.isInteger(row.index)) {
      throw new Error(`names.json[${position}] needs integer morphisms, objects and index`)
    }
    if (!row.name && !row.description) {
      throw new Error(`names.json[${position}] has neither a name nor a description`)
    }
  }
  return { rows, propositions }
}

async function compileCell(databaseDir, outputDir, filename, morphisms, objects, offset, names) {
  const path = join(databaseDir, filename)
  const propositionsPath = join(databaseDir, `props${morphisms}-${objects}.txt`)
  let masks
  try {
    masks = (await readFile(propositionsPath, 'utf8')).split('\n').filter(Boolean).map(Number)
  } catch {
    throw new Error(`${propositionsPath} is missing; run generate-database.sh to write it`)
  }

  const input = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })

  let count = 0
  let shardIndex = 0
  let shardStart = 0
  let tables = []
  let shardMasks = []
  const bitmaps = Array.from({ length: PROPOSITION_BITS }, () => [])
  const trueCounts = new Array(PROPOSITION_BITS).fill(0)

  for await (const line of input) {
    if (!line.trim()) continue
    const table = JSON.parse(line)
    if (!Array.isArray(table) || table.length !== morphisms
      || table.some(row => !Array.isArray(row) || row.length !== morphisms)) {
      throw new Error(`${filename}:${count + 1} is not a ${morphisms} x ${morphisms} table`)
    }
    const mask = masks[count]
    if (mask === undefined) {
      throw new Error(`${propositionsPath} has fewer rows than ${filename}`)
    }
    for (let bit = 0; bit < PROPOSITION_BITS; bit += 1) {
      const set = (mask >> bit) & 1
      bitmaps[bit].push(set)
      trueCounts[bit] += set
    }
    tables.push(table)
    shardMasks.push(mask)
    count += 1
    if (tables.length === SHARD_SIZE) {
      await writeShard(outputDir, morphisms, objects, shardIndex, shardStart, tables, shardMasks)
      shardIndex += 1
      shardStart = count
      tables = []
      shardMasks = []
    }
  }

  if (tables.length > 0) {
    await writeShard(outputDir, morphisms, objects, shardIndex, shardStart, tables, shardMasks)
    shardIndex += 1
  }
  if (count === 0) {
    console.warn(`Warning: ${filename} contains no category rows and was omitted.`)
    return null
  }
  if (masks.length !== count) {
    throw new Error(`${propositionsPath} has ${masks.length} rows but ${filename} has ${count}`)
  }

  // A proposition that is true of every category in the cell, or of none, is
  // already answered by its count -- only the mixed ones need a bitmap.
  for (let bit = 0; bit < PROPOSITION_BITS; bit += 1) {
    if (trueCounts[bit] === 0 || trueCounts[bit] === count) continue
    const packed = Buffer.alloc(Math.ceil(count / 8))
    bitmaps[bit].forEach((set, index) => {
      if (set) packed[index >> 3] |= 1 << (index & 7)
    })
    const target = join(outputDir, 'data', DATA_VERSION, 'bitmaps', `${morphisms}-${objects}-${bit}.bin`)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, packed)
  }

  const metadata = names
    .filter(row => row.morphisms === morphisms && row.objects === objects)
    .map(row => {
      if (row.index >= count) {
        throw new Error(`names.json refers to index ${row.index} of a ${count}-category cell`)
      }
      return [row.index, row.name ?? null, row.description ?? null]
    })
  if (metadata.length > 0) {
    await writeJson(join(outputDir, 'data', DATA_VERSION, 'metadata', `${morphisms}-${objects}.json`), metadata)
  }

  return {
    morphisms,
    objects,
    count,
    offset,
    shardSize: SHARD_SIZE,
    shards: shardIndex,
    metadataCount: metadata.length,
    trueCounts,
  }
}

async function build() {
  const { databaseDir, websiteDataDir } = parseArgs(process.argv.slice(2))
  await ensureDirectory(SOURCE_DIR, 'Static source directory')
  await ensureDirectory(databaseDir, 'Category database directory')
  const { rows: names, propositions } = await loadNames(websiteDataDir)

  const databaseFiles = (await readdir(databaseDir))
    .map(filename => {
      const match = /^cats(\d+)-(\d+)\.txt$/.exec(filename)
      return match
        ? { filename, morphisms: Number(match[1]), objects: Number(match[2]) }
        : null
    })
    .filter(Boolean)
    .sort((a, b) => a.morphisms - b.morphisms || a.objects - b.objects)

  if (databaseFiles.length === 0) {
    throw new Error(`No cats<n>-<k>.txt files found in ${databaseDir}`)
  }

  await rm(TEMP_DIR, { recursive: true, force: true })
  await mkdir(TEMP_DIR, { recursive: true })
  await Promise.all(PUBLIC_FILES.map(filename =>
    cp(join(SOURCE_DIR, filename), join(TEMP_DIR, filename))))

  const cells = []
  let categoryCount = 0
  for (const file of databaseFiles) {
    const cell = await compileCell(
      databaseDir,
      TEMP_DIR,
      file.filename,
      file.morphisms,
      file.objects,
      categoryCount,
      names,
    )
    if (!cell) continue
    cells.push(cell)
    categoryCount += cell.count
    console.log(`${file.morphisms},${file.objects}: ${cell.count.toLocaleString()} categories`)
  }

  // Every proposition of every category is known, so the manifest carries the
  // per-cell true-counts.  A query can answer any cell where a proposition is
  // constant from these alone, and only fetches a bitmap for the mixed ones.
  const manifest = {
    schemaVersion: 4,
    categoryCount,
    propositionCount: propositions.length,
    propositionBits: PROPOSITION_BITS,
    metadataCategoryCount: cells.reduce((total, cell) => total + cell.metadataCount, 0),
    cells,
  }
  await writeJson(join(TEMP_DIR, 'data', DATA_VERSION, 'manifest.json'), manifest)
  await writeJson(join(TEMP_DIR, 'data', DATA_VERSION, 'propositions.json'), propositions)
  await bundle({
    entryPoints: {
      app: join(SOURCE_DIR, 'app.js'),
      styles: join(SOURCE_DIR, 'styles.css'),
    },
    outdir: TEMP_DIR,
    entryNames: '[name]-[hash]',
    chunkNames: 'chunks/[name]-[hash]',
    assetNames: '[name]-[hash]',
    bundle: true,
    format: 'esm',
    splitting: true,
    loader: {
      '.html': 'text',
      '.ttf': 'file',
      '.woff': 'file',
      '.woff2': 'file',
    },
    minify: true,
    sourcemap: true,
    target: ['es2022'],
  })
  const bundledFiles = await readdir(TEMP_DIR)
  const appBundle = bundledFiles.find(filename => /^app-[A-Z0-9]+\.js$/.test(filename))
  const styleBundle = bundledFiles.find(filename => /^styles-[A-Z0-9]+\.css$/.test(filename))
  if (!appBundle || !styleBundle) throw new Error('Could not identify fingerprinted application assets')
  const indexPath = join(TEMP_DIR, 'index.html')
  const indexHtml = (await readFile(indexPath, 'utf8'))
    .replace('/app.js', `/${appBundle}`)
    .replace('/styles.css', `/${styleBundle}`)
  await writeFile(indexPath, indexHtml, 'utf8')

  await rm(FINAL_DIR, { recursive: true, force: true })
  await rename(TEMP_DIR, FINAL_DIR)

  const sourceBytes = await Promise.all(databaseFiles.map(async file => {
    const text = await readFile(join(databaseDir, file.filename))
    return text.byteLength
  }))
  console.log(`Built ${categoryCount.toLocaleString()} categories from ${sourceBytes.reduce((a, b) => a + b, 0).toLocaleString()} source bytes.`)
  console.log(
    `${names.length} named categories and ${propositions.length} propositions, ` +
    `computed from the tables with no join.`,
  )
  console.log(`Output: ${FINAL_DIR}`)
}

build().catch(async error => {
  await rm(TEMP_DIR, { recursive: true, force: true }).catch(() => {})
  console.error(error.stack || error.message)
  process.exitCode = 1
})
