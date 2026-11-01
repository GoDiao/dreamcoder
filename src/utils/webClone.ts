import { bundledDirCandidates, resolveBundledDir } from './bundledContent.js'

export const WEB_CLONE_DIRNAME = 'web-clone'
export const WEB_CLONE_MARKER_FILE = 'scripts/recon-site.mjs'

export async function resolveWebCloneDir(
  candidates: string[] = bundledDirCandidates(WEB_CLONE_DIRNAME),
): Promise<string> {
  return resolveBundledDir(candidates, WEB_CLONE_MARKER_FILE, 'website clone scripts')
}

export function webCloneRunner(execPath: string = process.execPath): string {
  return `BUN_BE_BUN=1 "${execPath}"`
}

export function renderWebCloneSection(dir: string | null, execPath: string = process.execPath): string {
  if (dir === null) {
    return '## Website clone tools\n\nThe website clone scripts are not available in this build. If the user asks to clone a website, say so in a sentence.'
  }
  const scripts = `${dir.replaceAll('\\', '/')}/scripts`
  return [
    '## Website clone tools',
    '',
    'Read `clone.md` in the base directory of this skill only when the user explicitly asks to clone or reproduce a website. Otherwise do not read it.',
    '',
    `Scripts directory: ${scripts}`,
    `Run a script through Bash as: ${webCloneRunner(execPath)} "${scripts}/<script>.mjs" <arguments>`,
    'On Windows PowerShell set `$env:BUN_BE_BUN = "1"` first and run `& "<the same executable>" "<script>" <arguments>`.',
  ].join('\n')
}
