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
const SHARD_SIZE = 512
const DATA_VERSION = 'v4'

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

async function writeShard(outputDir, morphisms, objects, shardIndex, start, tables) {
  const path = join(outputDir, 'data', DATA_VERSION, 'categories', `${morphisms}-${objects}-${shardIndex}.json`)
  await writeJson(path, {
    morphisms,
    objects,
    start,
    tables,
  })
}

function tableSha256(table) {
  return createHash('sha256').update(JSON.stringify(table)).digest('hex')
}

function categoryRecordKey(morphisms, objects, digest) {
  return `${morphisms}-${objects}-${digest}`
}

function parseMask(value, label, lineNumber) {
  let mask
  try {
    mask = BigInt(value)
  } catch {
    throw new Error(`categories.ndjson:${lineNumber} has an invalid ${label}`)
  }
  if (mask < 0n || mask > 0xffffffffn) {
    throw new Error(`categories.ndjson:${lineNumber} ${label} is outside the 32-bit static format`)
  }
  return Number(mask)
}

async function loadWebsiteData(websiteDataDir) {
  if (!websiteDataDir) return null
  await ensureDirectory(websiteDataDir, 'Website data directory')

  const dataManifest = JSON.parse(await readFile(join(websiteDataDir, 'export-manifest.json'), 'utf8'))
  if (dataManifest.schemaVersion !== 2) {
    throw new Error(`Unsupported website-data schema version: ${dataManifest.schemaVersion}`)
  }
  const propositions = JSON.parse(await readFile(join(websiteDataDir, 'propositions.json'), 'utf8'))
  if (!Array.isArray(propositions) || propositions.length > 32) {
    throw new Error('Website data must contain an array of at most 32 propositions')
  }
  propositions.forEach((proposition, bit) => {
    if (proposition.bit !== bit || typeof proposition.name !== 'string') {
      throw new Error(`Invalid proposition at bit ${bit}`)
    }
  })

  const recordsByKey = new Map()
  const input = createInterface({
    input: createReadStream(join(websiteDataDir, 'categories.ndjson'), { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })
  let lineNumber = 0
  for await (const line of input) {
    lineNumber += 1
    if (!line.trim()) continue
    const record = JSON.parse(line)
    const requiredIntegers = [record.morphisms, record.objects]
    if (requiredIntegers.some(value => !Number.isInteger(value) || value < 0)) {
      throw new Error(`categories.ndjson:${lineNumber} has invalid category coordinates`)
    }
    if (typeof record.tableSha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(record.tableSha256)) {
      throw new Error(`categories.ndjson:${lineNumber} has an invalid table digest`)
    }
    record.knownMask = parseMask(record.knownMask, 'knownMask', lineNumber)
    record.valueMask = parseMask(record.valueMask, 'valueMask', lineNumber)
    const allowedMask = propositions.length === 32 ? 0xffffffff : (2 ** propositions.length) - 1
    if ((record.knownMask & allowedMask) >>> 0 !== record.knownMask >>> 0) {
      throw new Error(`categories.ndjson:${lineNumber} uses an unknown proposition bit`)
    }
    if ((record.valueMask & record.knownMask) >>> 0 !== record.valueMask >>> 0) {
      throw new Error(`categories.ndjson:${lineNumber} marks an unknown fact as true`)
    }
    const key = categoryRecordKey(record.morphisms, record.objects, record.tableSha256)
    if (recordsByKey.has(key)) throw new Error(`Duplicate website-data multiplication table at line ${lineNumber}`)
    recordsByKey.set(key, record)
  }
  if (recordsByKey.size !== dataManifest.categoryCount) {
    throw new Error(`Website-data manifest expected ${dataManifest.categoryCount} categories but found ${recordsByKey.size}`)
  }
  if (propositions.length !== dataManifest.propositionCount) {
    throw new Error(`Website-data manifest expected ${dataManifest.propositionCount} propositions but found ${propositions.length}`)
  }
  return {
    dataManifest,
    propositions,
    recordsByKey,
    facts: [],
    matchedCategories: 0,
    metadataCategoryCount: 0,
    relationCount: 0,
  }
}

function countBits(value) {
  let remaining = value >>> 0
  let count = 0
  while (remaining) {
    remaining &= remaining - 1
    count += 1
  }
  return count
}

async function compileCell(databaseDir, outputDir, filename, morphisms, objects, offset, websiteData) {
  const path = join(databaseDir, filename)
  const input = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })

  let count = 0
  let shardIndex = 0
  let shardStart = 0
  let tables = []
  const metadata = []

  for await (const line of input) {
    if (!line.trim()) continue
    const table = JSON.parse(line)
    if (!Array.isArray(table) || table.length !== morphisms) {
      throw new Error(`${filename}:${count + 1} is not a ${morphisms} x ${morphisms} table`)
    }
    if (table.some(row => !Array.isArray(row) || row.length !== morphisms)) {
      throw new Error(`${filename}:${count + 1} is not a ${morphisms} x ${morphisms} table`)
    }
    if (websiteData) {
      const key = categoryRecordKey(morphisms, objects, tableSha256(table))
      const record = websiteData.recordsByKey.get(key)
      if (record) {
        websiteData.recordsByKey.delete(key)
        websiteData.matchedCategories += 1
        websiteData.relationCount += countBits(record.knownMask)
        if (record.friendlyName || record.description) {
          metadata.push([count, record.friendlyName, record.description])
          websiteData.metadataCategoryCount += 1
        }
        websiteData.facts.push(record.knownMask, record.valueMask)
      } else {
        websiteData.facts.push(0, 0)
      }
    }
    tables.push(table)
    count += 1
    if (tables.length === SHARD_SIZE) {
      await writeShard(outputDir, morphisms, objects, shardIndex, shardStart, tables)
      shardIndex += 1
      shardStart = count
      tables = []
    }
  }

  if (tables.length > 0) {
    await writeShard(outputDir, morphisms, objects, shardIndex, shardStart, tables)
    shardIndex += 1
  }

  if (count === 0) {
    console.warn(`Warning: ${filename} contains no category rows and was omitted.`)
    return null
  }

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
  }
}

async function build() {
  const { databaseDir, websiteDataDir } = parseArgs(process.argv.slice(2))
  await ensureDirectory(SOURCE_DIR, 'Static source directory')
  await ensureDirectory(databaseDir, 'Category database directory')
  const websiteData = await loadWebsiteData(websiteDataDir)

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
      websiteData,
    )
    if (!cell) continue
    cells.push(cell)
    categoryCount += cell.count
    console.log(`${file.morphisms},${file.objects}: ${cell.count.toLocaleString()} categories`)
  }

  if (websiteData?.recordsByKey.size) {
    const examples = [...websiteData.recordsByKey.values()]
      .slice(0, 3)
      .map(record => `(${record.morphisms},${record.objects},${record.tableSha256.slice(0, 12)}…)`)
      .join(', ')
    throw new Error(
      `${websiteData.recordsByKey.size} website-data categories could not be matched to canonical tables. ` +
      `Examples: ${examples}`
    )
  }
  if (websiteData && websiteData.relationCount !== websiteData.dataManifest.relationCount) {
    throw new Error(
      `Website-data manifest expected ${websiteData.dataManifest.relationCount} facts but matched ${websiteData.relationCount}`
    )
  }

  if (websiteData) {
    const facts = Buffer.alloc(websiteData.facts.length * 4)
    websiteData.facts.forEach((value, index) => facts.writeUInt32LE(value >>> 0, index * 4))
    await writeFile(join(TEMP_DIR, 'data', DATA_VERSION, 'facts.bin'), facts)
  }

  const manifest = {
    schemaVersion: 3,
    categoryCount,
    propositionCount: websiteData?.propositions.length || 0,
    relationCount: websiteData?.relationCount || 0,
    metadataCategoryCount: websiteData?.metadataCategoryCount || 0,
    factsAvailable: Boolean(websiteData),
    cells,
  }
  await writeJson(join(TEMP_DIR, 'data', DATA_VERSION, 'manifest.json'), manifest)
  await writeJson(join(TEMP_DIR, 'data', DATA_VERSION, 'propositions.json'), websiteData?.propositions || [])
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
  if (websiteData) {
    console.log(
      `Matched ${websiteData.matchedCategories.toLocaleString()} website-data categories and ` +
      `${websiteData.relationCount.toLocaleString()} facts by multiplication-table fingerprint.`,
    )
  }
  console.log(`Output: ${FINAL_DIR}`)
}

build().catch(async error => {
  await rm(TEMP_DIR, { recursive: true, force: true }).catch(() => {})
  console.error(error.stack || error.message)
  process.exitCode = 1
})
