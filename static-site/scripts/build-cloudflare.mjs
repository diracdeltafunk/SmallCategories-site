import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const DATABASE_REPOSITORY = process.env.SMALLCATS_DATABASE_REPOSITORY ||
  'https://github.com/diracdeltafunk/SmallCategories.git'
const DATABASE_REF = process.env.SMALLCATS_DATABASE_REF || 'master'

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options })
    child.on('error', reject)
    child.on('exit', code => {
      if (code === 0) resolvePromise()
      else reject(new Error(`${command} exited with status ${code}`))
    })
  })
}

const temporary = await mkdtemp(join(tmpdir(), 'smallcats-cloudflare-build-'))
try {
  const checkout = join(temporary, 'SmallCategories')
  await run('git', [
    'clone',
    '--depth', '1',
    '--branch', DATABASE_REF,
    DATABASE_REPOSITORY,
    checkout,
  ])
  await run(process.execPath, [
    resolve(SCRIPT_DIR, 'build.mjs'),
    '--database', join(checkout, 'database'),
    '--export', join(checkout, 'website-data'),
  ])
} finally {
  await rm(temporary, { recursive: true, force: true })
}
