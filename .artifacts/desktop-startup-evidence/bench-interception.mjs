/** Time the resolver's Node-internal lookup. Run from the repository root with tsx available. */
import { installRuntimeInterception } from '../../packages/boot/app-boot/src/profile-resolution/resolver.ts'

const started = performance.now()
const registration = installRuntimeInterception({
  profilesDir: process.cwd(),
  profileDir: undefined,
  localPackageNames: [],
  entries: [],
  linkedRoots: [],
})
console.log((performance.now() - started).toFixed(0))
registration.dispose()
