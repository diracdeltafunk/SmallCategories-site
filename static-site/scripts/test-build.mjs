import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const SITE_DIR = resolve(SCRIPT_DIR, '..')
const DIST_DIR = join(SITE_DIR, 'dist')
const DATA_DIR = join(DIST_DIR, 'data', 'v3')

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

  const manifest = JSON.parse(await readFile(join(DATA_DIR, 'manifest.json'), 'utf8'))
  assert(manifest.categoryCount === 1, 'wrong category count')
  assert(manifest.propositionCount === 2, 'wrong proposition count')
  assert(manifest.relationCount === 2, 'wrong relation count')
  assert(manifest.schemaVersion === 3, 'wrong compiled schema version')
  assert(manifest.factsAvailable, 'fact data was not enabled')
  assert(!('legacyIdsAvailable' in manifest), 'legacy ID support leaked into the manifest')
  assert(manifest.metadataCategoryCount === 1, 'wrong metadata category count')

  const facts = await readFile(join(DATA_DIR, 'facts.bin'))
  assert(facts.readUInt32LE(0) === 3, 'wrong known-fact mask')
  assert(facts.readUInt32LE(4) === 1, 'wrong fact-value mask')

  const metadata = JSON.parse(await readFile(join(DATA_DIR, 'metadata', '1-1.json'), 'utf8'))
  assert(metadata[0][1] === 'Terminal test category', 'friendly name was not compiled')
  const indexHtml = await readFile(join(DIST_DIR, 'index.html'), 'utf8')
  const appBundleName = /src="\/(app-[A-Z0-9]+\.js)"/.exec(indexHtml)?.[1]
  const styleBundleName = /href="\/(styles-[A-Z0-9]+\.css)"/.exec(indexHtml)?.[1]
  assert(appBundleName && styleBundleName, 'fingerprinted assets were not linked from the app shell')
  assert(indexHtml.includes('fa-solid fa-shuffle'), 'the original navbar icon was not retained')
  assert(!indexHtml.includes('/support') && !indexHtml.toLowerCase().includes('ko-fi'), 'retired support links leaked into the app shell')
  const bundledApp = await readFile(join(DIST_DIR, appBundleName), 'utf8')
  assert(!bundledApp.includes('legacy-ids'), 'legacy ID route support leaked into the browser bundle')
  assert(!bundledApp.includes('/support') && !bundledApp.toLowerCase().includes('ko-fi'), 'retired support page leaked into the browser bundle')
  assert(bundledApp.includes('"paw"') && bundledApp.includes('"check"'), 'page icons were not included in the browser bundle')
  assert(bundledApp.includes('api.thecatapi.com/v1/images/search?limit=1'), 'the Small Cat API request was not included')
  assert(bundledApp.includes('Small cats provided by') && !bundledApp.includes('x-api-key'), 'the Small Cat attribution or API-key guard is missing')
  assert(bundledApp.includes('Each nonempty cell is complete') && bundledApp.includes('stats-table'), 'the statistics table explanation was not retained')
  const bundledStyles = await readFile(join(DIST_DIR, styleBundleName), 'utf8')
  assert(bundledStyles.includes('#app:focus{outline:none}'), 'the application focus outline was not suppressed')
  const outputFiles = await readdir(DIST_DIR)
  assert(!outputFiles.includes('pages'), 'source page templates leaked into the published site')
  assert(outputFiles.some(filename => /^fa-solid-900-[A-Z0-9]+\.woff2$/.test(filename)), 'the solid icon font was not emitted')
  assert(outputFiles.some(filename => /^fa-brands-400-[A-Z0-9]+\.woff2$/.test(filename)), 'the brand icon font was not emitted')
  console.log('Static export build fixture passed.')
} finally {
  await rm(temporary, { recursive: true, force: true })
}
