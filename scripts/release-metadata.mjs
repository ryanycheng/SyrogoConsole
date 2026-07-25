import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import semver from 'semver'

export async function createReleaseMetadata({
  version,
  syrogoVersionRange,
  gitCommit,
  builtAt,
  projectRoot = process.cwd(),
  outputPath = 'dist/syrogo-console-release.json',
}) {
  if (!semver.valid(version)) {
    throw new Error('version must be a valid SemVer version')
  }
  if (!semver.validRange(syrogoVersionRange)) {
    throw new Error('syrogo_version_range must be a valid SemVer range')
  }
  if (!gitCommit?.trim()) {
    throw new Error('git_commit is required')
  }
  const builtAtDate = new Date(builtAt)
  if (!builtAt || Number.isNaN(builtAtDate.valueOf())) {
    throw new Error('built_at must be a valid date')
  }

  const packageJSON = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'))
  if (packageJSON.version !== version) {
    throw new Error(`version ${version} does not match package.json version ${packageJSON.version}`)
  }

  const metadata = {
    console_version: version,
    syrogo_version_range: syrogoVersionRange,
    git_commit: gitCommit.trim(),
    built_at: builtAtDate.toISOString(),
  }
  const absoluteOutputPath = path.resolve(projectRoot, outputPath)
  await mkdir(path.dirname(absoluteOutputPath), { recursive: true })
  await writeFile(absoluteOutputPath, `${JSON.stringify(metadata, null, 2)}\n`)
  return metadata
}

async function main() {
  const [version, syrogoVersionRange, gitCommit, builtAt] = process.argv.slice(2)
  await createReleaseMetadata({ version, syrogoVersionRange, gitCommit, builtAt })
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
