/** Verify the resolver reads internals exposed by --expose-internals instead of the builtin addon. */
import { createRequire } from 'node:module'
import { installRuntimeInterception } from '../../src/profile-resolution/resolver.ts'

const addon = createRequire(import.meta.url)('node-addon-require-builtin') as {
  requireBuiltin(moduleId: string): unknown
}
addon.requireBuiltin = () => { throw new Error('the builtin addon must not be used') }
const registration = installRuntimeInterception({
  profilesDir: process.argv[2]!,
  profileDir: undefined,
  localPackageNames: [],
  entries: [],
  linkedRoots: [],
})
registration.dispose()
process.stdout.write('internals exposed\n')
