import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const SITE_DIR = resolve(SCRIPT_DIR, '..')
const DIST_DIR = join(SITE_DIR, 'dist')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function jsonLine(value) {
  return `${JSON.stringify(value)}\n`
}

const temporary = await mkdtemp(join(tmpdir(), 'smallcats-static-test-'))
try {
  const database = join(temporary, 'database')
  const exported = join(temporary, 'export')
  await mkdir(database)
  await mkdir(exported)

  const table = [[0]]
  const digest = createHash('sha256').update(JSON.stringify(table)).digest('hex')
  const propositions = [
    { name: 'true_fact', description: 'Known true', bit: 0 },
    { name: 'false_fact', description: 'Known false', bit: 1 },
  ]

  await writeFile(join(database, 'cats1-1.txt'), jsonLine(table))
  await writeFile(join(exported, 'propositions.json'), jsonLine(propositions))
  await writeFile(join(exported, 'export-manifest.json'), jsonLine({
    schemaVersion: 2,
    categoryCount: 1,
    propositionCount: 2,
    relationCount: 2,
  }))
  await writeFile(join(exported, 'categories.ndjson'), jsonLine({
    morphisms: 1,
    objects: 1,
    tableSha256: digest,
    friendlyName: 'Terminal test category',
    description: 'Fixture metadata',
    knownMask: '3',
    valueMask: '1',
  }))

  const { stdout } = await execFileAsync(process.execPath, [
    join(SCRIPT_DIR, 'build.mjs'),
    '--database', database,
    '--export', exported,
  ], { cwd: SITE_DIR })
  assert(stdout.includes('Matched 1 exported categories'), 'category matching was not reported')

  const manifest = JSON.parse(await readFile(join(DIST_DIR, 'data', 'manifest.json'), 'utf8'))
  assert(manifest.categoryCount === 1, 'wrong category count')
  assert(manifest.propositionCount === 2, 'wrong proposition count')
  assert(manifest.relationCount === 2, 'wrong relation count')
  assert(manifest.schemaVersion === 3, 'wrong compiled schema version')
  assert(manifest.factsAvailable, 'fact data was not enabled')
  assert(!('legacyIdsAvailable' in manifest), 'legacy ID support leaked into the manifest')
  assert(manifest.metadataCategoryCount === 1, 'wrong metadata category count')

  const facts = await readFile(join(DIST_DIR, 'data', 'facts.bin'))
  assert(facts.readUInt32LE(0) === 3, 'wrong known-fact mask')
  assert(facts.readUInt32LE(4) === 1, 'wrong fact-value mask')

  const metadata = JSON.parse(await readFile(join(DIST_DIR, 'data', 'metadata', '1-1.json'), 'utf8'))
  assert(metadata[0][1] === 'Terminal test category', 'friendly name was not compiled')
  const bundledApp = await readFile(join(DIST_DIR, 'app.js'), 'utf8')
  assert(!bundledApp.includes('legacy-ids'), 'legacy ID route support leaked into the browser bundle')
  console.log('Static export build fixture passed.')
} finally {
  await rm(temporary, { recursive: true, force: true })
}
