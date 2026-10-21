// Loaded with `node --import ./eval/register.ts` so the eval runs on Node's
// built-in type stripping, no bundler: src/ imports are extensionless
// (bundler resolution), so a relative specifier that does not resolve as
// written is retried with `.ts`.

import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context)
    } catch (e) {
      if (!specifier.startsWith('.') || specifier.endsWith('.ts')) throw e
      return next(`${specifier}.ts`, context)
    }
  },
})
