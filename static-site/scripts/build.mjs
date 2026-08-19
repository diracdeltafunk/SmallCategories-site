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

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const SITE_DIR = resolve(SCRIPT_DIR, '..')
const DEFAULT_DATABASE_DIR = resolve(SITE_DIR, '../../SmallCategories/database')
const SOURCE_DIR = resolve(SITE_DIR, 'src')
const FINAL_DIR = resolve(SITE_DIR, 'dist')
const TEMP_DIR = resolve(SITE_DIR, '.dist-tmp')
const SHARD_SIZE = 512

function parseArgs(argv) {
  const result = { databaseDir: DEFAULT_DATABASE_DIR, exportDir: null }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--database' && argv[i + 1]) {
      result.databaseDir = resolve(argv[++i])
      continue
    }
    if (argv[i] === '--export' && argv[i + 1]) {
      result.exportDir = resolve(argv[++i])
      continue
    }
    if (argv[i] === '--help') {
      console.log('Usage: node scripts/build.mjs [--database /path/to/database] [--export /path/to/export]')
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
  const path = join(outputDir, 'data', 'categories', `${morphisms}-${objects}-${shardIndex}.json`)
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

async function loadExport(exportDir) {
  if (!exportDir) return null
  await ensureDirectory(exportDir, 'Supabase export directory')

  const exportManifest = JSON.parse(await readFile(join(exportDir, 'export-manifest.json'), 'utf8'))
  if (exportManifest.schemaVersion !== 1) {
    throw new Error(`Unsupported export schema version: ${exportManifest.schemaVersion}`)
  }
  const propositions = JSON.parse(await readFile(join(exportDir, 'propositions.json'), 'utf8'))
  if (!Array.isArray(propositions) || propositions.length > 32) {
    throw new Error('The export must contain an array of at most 32 propositions')
  }
  propositions.forEach((proposition, bit) => {
    if (proposition.bit !== bit || typeof proposition.id !== 'string' || typeof proposition.name !== 'string') {
      throw new Error(`Invalid proposition at bit ${bit}`)
    }
  })

  const recordsByKey = new Map()
  const ids = new Set()
  const input = createInterface({
    input: createReadStream(join(exportDir, 'categories.ndjson'), { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })
  let lineNumber = 0
  for await (const line of input) {
    lineNumber += 1
    if (!line.trim()) continue
    const record = JSON.parse(line)
    const requiredIntegers = [record.morphisms, record.objects, record.sourceIndex]
    if (requiredIntegers.some(value => !Number.isInteger(value) || value < 0)) {
      throw new Error(`categories.ndjson:${lineNumber} has invalid category coordinates`)
    }
    if (typeof record.id !== 'string' || !/^[0-9a-f-]+$/i.test(record.id)) {
      throw new Error(`categories.ndjson:${lineNumber} has an invalid category ID`)
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
    if (recordsByKey.has(key)) throw new Error(`Duplicate exported multiplication table at line ${lineNumber}`)
    if (ids.has(record.id)) throw new Error(`Duplicate exported category ID at line ${lineNumber}`)
    recordsByKey.set(key, record)
    ids.add(record.id)
  }
  if (recordsByKey.size !== exportManifest.categoryCount) {
    throw new Error(`Export manifest expected ${exportManifest.categoryCount} categories but found ${recordsByKey.size}`)
  }
  if (propositions.length !== exportManifest.propositionCount) {
    throw new Error(`Export manifest expected ${exportManifest.propositionCount} propositions but found ${propositions.length}`)
  }
  return {
    exportManifest,
    propositions,
    recordsByKey,
    facts: [],
    legacyIds: {},
    matchedCategories: 0,
    relationCount: 0,
    remappedIndexes: 0,
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

async function compileCell(databaseDir, outputDir, filename, morphisms, objects, offset, migration) {
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
    if (migration) {
      const key = categoryRecordKey(morphisms, objects, tableSha256(table))
      const record = migration.recordsByKey.get(key)
      if (record) {
        migration.recordsByKey.delete(key)
        migration.matchedCategories += 1
        migration.relationCount += countBits(record.knownMask)
        if (record.sourceIndex !== count) migration.remappedIndexes += 1
        migration.legacyIds[record.id] = [morphisms, objects, count]
        metadata.push([count, record.id, record.friendlyName, record.description])
        migration.facts.push(record.knownMask, record.valueMask)
      } else {
        migration.facts.push(0, 0)
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
    await writeJson(join(outputDir, 'data', 'metadata', `${morphisms}-${objects}.json`), metadata)
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
  const { databaseDir, exportDir } = parseArgs(process.argv.slice(2))
  await ensureDirectory(SOURCE_DIR, 'Static source directory')
  await ensureDirectory(databaseDir, 'Category database directory')
  const migration = await loadExport(exportDir)

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
  await cp(SOURCE_DIR, TEMP_DIR, { recursive: true })
  await cp(join(TEMP_DIR, 'index.html'), join(TEMP_DIR, '404.html'))

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
      migration,
    )
    if (!cell) continue
    cells.push(cell)
    categoryCount += cell.count
    console.log(`${file.morphisms},${file.objects}: ${cell.count.toLocaleString()} categories`)
  }

  if (migration?.recordsByKey.size) {
    const examples = [...migration.recordsByKey.values()]
      .slice(0, 3)
      .map(record => `${record.id} (${record.morphisms},${record.objects},${record.sourceIndex})`)
      .join(', ')
    throw new Error(
      `${migration.recordsByKey.size} exported categories could not be matched to canonical tables. ` +
      `Examples: ${examples}`
    )
  }
  if (migration && migration.relationCount !== migration.exportManifest.relationCount) {
    throw new Error(
      `Export manifest expected ${migration.exportManifest.relationCount} facts but matched ${migration.relationCount}`
    )
  }

  if (migration) {
    const facts = Buffer.alloc(migration.facts.length * 4)
    migration.facts.forEach((value, index) => facts.writeUInt32LE(value >>> 0, index * 4))
    await writeFile(join(TEMP_DIR, 'data', 'facts.bin'), facts)
    await writeJson(join(TEMP_DIR, 'data', 'legacy-ids.json'), migration.legacyIds)
  }

  const manifest = {
    schemaVersion: 2,
    categoryCount,
    propositionCount: migration?.propositions.length || 0,
    relationCount: migration?.relationCount || 0,
    metadataCategoryCount: migration?.matchedCategories || 0,
    factsAvailable: Boolean(migration),
    legacyIdsAvailable: Boolean(migration),
    cells,
  }
  await writeJson(join(TEMP_DIR, 'data', 'manifest.json'), manifest)
  await writeJson(join(TEMP_DIR, 'data', 'propositions.json'), migration?.propositions || [])

  await rm(FINAL_DIR, { recursive: true, force: true })
  await rename(TEMP_DIR, FINAL_DIR)

  const sourceBytes = await Promise.all(databaseFiles.map(async file => {
    const text = await readFile(join(databaseDir, file.filename))
    return text.byteLength
  }))
  console.log(`Built ${categoryCount.toLocaleString()} categories from ${sourceBytes.reduce((a, b) => a + b, 0).toLocaleString()} source bytes.`)
  if (migration) {
    console.log(
      `Matched ${migration.matchedCategories.toLocaleString()} exported UUIDs and ` +
      `${migration.relationCount.toLocaleString()} facts by multiplication-table fingerprint.`,
    )
    if (migration.remappedIndexes) {
      console.log(`Safely remapped ${migration.remappedIndexes.toLocaleString()} categories whose indexes changed.`)
    }
  }
  console.log(`Output: ${FINAL_DIR}`)
}

build().catch(async error => {
  await rm(TEMP_DIR, { recursive: true, force: true }).catch(() => {})
  console.error(error.stack || error.message)
  process.exitCode = 1
})
