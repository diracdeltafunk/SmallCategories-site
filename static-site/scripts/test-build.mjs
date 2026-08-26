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
const DATA_VERSION = 'v5'
const DATA_DIR = join(DIST_DIR, 'data', DATA_VERSION)

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function jsonLine(value) {
  return `${JSON.stringify(value)}\n`
}

const temporary = await mkdtemp(join(tmpdir(), 'smallcats-static-test-'))
try {
  const database = join(temporary, 'database')
  const websiteData = join(temporary, 'website-data')
  await mkdir(database)
  await mkdir(websiteData)

  // Two categories in one cell so a proposition can be mixed across it, which is
  // the only case that produces a bitmap.
  const propositions = [
    { name: 'true_fact', description: 'Known true', bit: 0 },
    { name: 'false_fact', description: 'Known false', bit: 1 },
  ]

  await writeFile(join(database, 'cats1-1.txt'), jsonLine([[0]]))
  await writeFile(join(database, 'props1-1.txt'), '1\n')
  await writeFile(join(database, 'cats2-1.txt'), jsonLine([[0, 1], [1, 1]]) + jsonLine([[0, 1], [1, 0]]))
  await writeFile(join(database, 'props2-1.txt'), '0\n2\n')
  await writeFile(join(websiteData, 'propositions.json'), jsonLine(propositions))
  await writeFile(join(websiteData, 'names.json'), jsonLine([{
    morphisms: 1,
    objects: 1,
    index: 0,
    name: 'Terminal test category',
    description: 'Fixture metadata',
  }]))

  const { stdout } = await execFileAsync(process.execPath, [
    join(SCRIPT_DIR, 'build.mjs'),
    '--database', database,
    '--website-data', websiteData,
  ], { cwd: SITE_DIR })
  assert(stdout.includes('8 named categories') || stdout.includes('1 named categories'), 'names were not reported')

  const manifest = JSON.parse(await readFile(join(DATA_DIR, 'manifest.json'), 'utf8'))
  assert(manifest.categoryCount === 3, 'wrong category count')
  assert(manifest.propositionCount === 2, 'wrong proposition count')
  assert(manifest.schemaVersion === 4, 'wrong compiled schema version')
  assert(!('factsAvailable' in manifest), 'the retired facts flag leaked into the manifest')
  assert(!('legacyIdsAvailable' in manifest), 'legacy ID support leaked into the manifest')
  assert(manifest.metadataCategoryCount === 1, 'wrong metadata category count')

  // A category's propositions travel in its own shard.
  const shard = JSON.parse(await readFile(join(DATA_DIR, 'categories', '2-1-0.json'), 'utf8'))
  assert(shard.masks.join() === '0,2', 'shard masks were not compiled')

  // Constant propositions are answered by the manifest; only mixed ones get a
  // bitmap, and its bits must match the masks.
  const cell = manifest.cells.find(candidate => candidate.morphisms === 2)
  assert(cell.trueCounts[0] === 0 && cell.trueCounts[1] === 1, 'wrong per-cell proposition counts')
  const files = await readdir(join(DATA_DIR, 'bitmaps'))
  assert(files.join() === '2-1-1.bin', `expected exactly the mixed bitmap, found ${files.join()}`)
  const bitmap = await readFile(join(DATA_DIR, 'bitmaps', '2-1-1.bin'))
  assert((bitmap[0] & 1) === 0 && ((bitmap[0] >> 1) & 1) === 1, 'bitmap disagrees with the masks')

  const metadata = JSON.parse(await readFile(join(DATA_DIR, 'metadata', '1-1.json'), 'utf8'))
  assert(metadata[0][1] === 'Terminal test category', 'friendly name was not compiled')
  const indexHtml = await readFile(join(DIST_DIR, 'index.html'), 'utf8')
  const appBundleName = /src="\/(app-[A-Z0-9]+\.js)"/.exec(indexHtml)?.[1]
  const styleBundleName = /href="\/(styles-[A-Z0-9]+\.css)"/.exec(indexHtml)?.[1]
  assert(appBundleName && styleBundleName, 'fingerprinted assets were not linked from the app shell')
  assert(indexHtml.includes('fa-solid fa-shuffle'), 'the original navbar icon was not retained')
  assert(!indexHtml.includes('/support') && !indexHtml.toLowerCase().includes('ko-fi'), 'retired support links leaked into the app shell')
  const bundledJavaScript = (await Promise.all(
    (await readdir(DIST_DIR, { recursive: true }))
      .filter(filename => filename.endsWith('.js'))
      .map(filename => readFile(join(DIST_DIR, filename), 'utf8')),
  )).join('\n')
  assert(!bundledJavaScript.includes('legacy-ids'), 'legacy ID route support leaked into the browser bundle')
  assert(!bundledJavaScript.includes('/support') && !bundledJavaScript.toLowerCase().includes('ko-fi'), 'retired support page leaked into the browser bundle')
  assert(bundledJavaScript.includes('fa-paw') && bundledJavaScript.includes('fa-scale-balanced'), 'page icons were not included in the browser bundle')
  assert(bundledJavaScript.includes('api.thecatapi.com/v1/images/search?limit=1'), 'the Small Cat API request was not included')
  assert(bundledJavaScript.includes('Small cats provided by') && !bundledJavaScript.includes('x-api-key'), 'the Small Cat attribution or API-key guard is missing')
  assert(bundledJavaScript.includes('Each nonempty cell is complete') && bundledJavaScript.includes('stats-table'), 'the statistics table explanation was not retained')
  assert(bundledJavaScript.includes(`/data/${DATA_VERSION}/`), 'the browser bundle uses the wrong data namespace')
  const headers = await readFile(join(DIST_DIR, '_headers'), 'utf8')
  assert(headers.includes(`/data/${DATA_VERSION}/bitmaps/*`), 'cache headers use the wrong data namespace')
  assert((await readdir(join(DIST_DIR, 'data'))).join() === DATA_VERSION, 'the build emitted an unexpected data namespace')
  const bundledStyles = await readFile(join(DIST_DIR, styleBundleName), 'utf8')
  assert(bundledStyles.includes('#app:focus{outline:none}'), 'the application focus outline was not suppressed')
  const outputFiles = await readdir(DIST_DIR)
  assert(!outputFiles.includes('pages'), 'raw source page templates leaked into the published site')
  assert(!outputFiles.includes('data.js') && !outputFiles.includes('ui.js'), 'raw source helper modules leaked into the published site')
  assert(outputFiles.some(filename => /^fa-solid-900-[A-Z0-9]+\.woff2$/.test(filename)), 'the solid icon font was not emitted')
  assert(outputFiles.some(filename => /^fa-brands-400-[A-Z0-9]+\.woff2$/.test(filename)), 'the brand icon font was not emitted')
  console.log('Static export build fixture passed.')
} finally {
  await rm(temporary, { recursive: true, force: true })
}
