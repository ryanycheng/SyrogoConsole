import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createReleaseMetadata } from './release-metadata.mjs'

const roots = []

async function project(version = '1.2.3') {
  const root = await mkdtemp(path.join(tmpdir(), 'syrogo-console-release-'))
  roots.push(root)
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ version }))
  return root
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('createReleaseMetadata', () => {
  it('writes validated release metadata', async () => {
    const root = await project()
    await mkdir(path.join(root, 'dist'))

    const metadata = await createReleaseMetadata({
      version: '1.2.3',
      syrogoVersionRange: '>=0.15.0 <0.16.0',
      gitCommit: 'abc123',
      builtAt: '2026-07-23T10:00:00Z',
      projectRoot: root,
    })

    expect(metadata).toEqual({
      console_version: '1.2.3',
      syrogo_version_range: '>=0.15.0 <0.16.0',
      git_commit: 'abc123',
      built_at: '2026-07-23T10:00:00.000Z',
    })
    expect(JSON.parse(await readFile(path.join(root, 'dist/syrogo-console-release.json'), 'utf8'))).toEqual(metadata)
  })

  it.each([
    ['invalid version', { version: 'latest', syrogoVersionRange: '>=0.15.0', builtAt: '2026-07-23T10:00:00Z' }],
    ['invalid range', { version: '1.2.3', syrogoVersionRange: 'not a range', builtAt: '2026-07-23T10:00:00Z' }],
    ['invalid date', { version: '1.2.3', syrogoVersionRange: '>=0.15.0', builtAt: 'not a date' }],
  ])('rejects %s', async (_, input) => {
    const root = await project()
    await expect(createReleaseMetadata({ ...input, gitCommit: 'abc123', projectRoot: root })).rejects.toThrow()
  })

  it('rejects a version different from package.json', async () => {
    const root = await project('1.2.2')
    await expect(createReleaseMetadata({
      version: '1.2.3',
      syrogoVersionRange: '>=0.15.0 <0.16.0',
      gitCommit: 'abc123',
      builtAt: '2026-07-23T10:00:00Z',
      projectRoot: root,
    })).rejects.toThrow('does not match package.json')
  })
})
