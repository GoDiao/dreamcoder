import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { hostRipgrepTarget, prepareRipgrep } from '../../scripts/prepare-ripgrep.js'

const desktopRoot = path.resolve(import.meta.dir, '..')
const repoRoot = path.resolve(desktopRoot, '..')
const binariesDir = path.join(desktopRoot, 'binaries')

const targetTriple =
  process.env.DREAMCODER_TARGET_TRIPLE ||
  hostRipgrepTarget()

const bunTarget = mapTargetTripleToBun(targetTriple)

await prepareRipgrep(repoRoot, targetTriple)

console.log('[build-sidecars] scanning for missing imports...')
const scanProc = Bun.spawn(
  ['bun', 'run', path.join(desktopRoot, 'scripts/scan-missing-imports.ts')],
  { cwd: repoRoot, stdout: 'inherit', stderr: 'inherit' },
)
const scanExit = await scanProc.exited
if (scanExit !== 0) {
  throw new Error(`[build-sidecars] scan-missing-imports failed (exit ${scanExit})`)
}

await mkdir(binariesDir, { recursive: true })

await compileExecutable({
  entrypoint: path.join(desktopRoot, 'sidecars/dreamcoder-sidecar.ts'),
  outfileBase: path.join(binariesDir, `dreamcoder-sidecar-${targetTriple}`),
  productName: 'DreamCoder Sidecar',
  bunTarget,
})

console.log(`[build-sidecars] Built desktop sidecar for ${targetTriple} (${bunTarget})`)

function mapTargetTripleToBun(triple: string) {
  switch (triple) {
    case 'aarch64-apple-darwin':
      return 'bun-darwin-arm64'
    case 'x86_64-apple-darwin':
      return 'bun-darwin-x64'
    case 'x86_64-pc-windows-msvc':
      return 'bun-windows-x64-baseline'
    case 'aarch64-pc-windows-msvc':
      return 'bun-windows-arm64'
    case 'x86_64-unknown-linux-gnu':
      return 'bun-linux-x64-baseline'
    case 'aarch64-unknown-linux-gnu':
      return 'bun-linux-arm64'
    case 'x86_64-unknown-linux-musl':
      return 'bun-linux-x64-musl'
    case 'aarch64-unknown-linux-musl':
      return 'bun-linux-arm64-musl'
    default:
      throw new Error(`[build-sidecars] Unsupported target triple: ${triple}`)
  }
}

async function compileExecutable({
  entrypoint,
  outfileBase,
  productName,
  bunTarget,
}: {
  entrypoint: string
  outfileBase: string
  productName: string
  bunTarget: string
}) {
  const result = await Bun.build({
    entrypoints: [entrypoint],
    minify: { whitespace: true, identifiers: true, syntax: true },
    sourcemap: 'none',
    target: 'bun',
    external: [
      '@opentelemetry/exporter-trace-otlp-grpc',
      '@opentelemetry/exporter-trace-otlp-http',
      '@opentelemetry/exporter-trace-otlp-proto',
      '@opentelemetry/exporter-logs-otlp-grpc',
      '@opentelemetry/exporter-logs-otlp-http',
      '@opentelemetry/exporter-logs-otlp-proto',
      '@opentelemetry/exporter-metrics-otlp-grpc',
      '@opentelemetry/exporter-metrics-otlp-http',
      '@opentelemetry/exporter-metrics-otlp-proto',
      '@opentelemetry/exporter-prometheus',
      '@aws-sdk/client-bedrock',
      '@aws-sdk/client-sts',
      '@anthropic-ai/bedrock-sdk',
      '@anthropic-ai/foundry-sdk',
      '@anthropic-ai/vertex-sdk',
      '@azure/identity',
      '@anthropic-ai/mcpb',
      'fflate',
      'sharp',
      'react-devtools-core',
    ],
    compile: {
      target: bunTarget,
      outfile: outfileBase,
      autoloadTsconfig: true,
      autoloadPackageJson: true,
      windows: {
        title: productName,
        publisher: 'DreamCoder',
        description: productName,
        hideConsole: true,
      },
    },
  })

  if (!result.success) {
    const logs = result.logs.map((log) => log.message).join('\n')
    throw new Error(`[build-sidecars] Failed to compile ${productName}:\n${logs}`)
  }

  const outputPath = result.outputs[0]?.path ?? outfileBase
  console.log(`[build-sidecars] ${productName} -> ${outputPath}`)

  if (process.platform === 'darwin') {
    await adHocSignMacBinary(outputPath)
  }
}

async function adHocSignMacBinary(outputPath: string) {
  console.log(`[build-sidecars] ad-hoc signing ${outputPath} for macOS ...`)
  const strip = Bun.spawn(['codesign', '--remove-signature', outputPath], {
    stdout: 'inherit',
    stderr: 'inherit',
  })
  await strip.exited

  const sign = Bun.spawn(
    ['codesign', '--sign', '-', '--force', '--timestamp=none', outputPath],
    { stdout: 'inherit', stderr: 'inherit' },
  )
  const signExit = await sign.exited
  if (signExit !== 0) {
    throw new Error(`[build-sidecars] ad-hoc codesign failed for ${outputPath} (exit ${signExit})`)
  }
  console.log(`[build-sidecars] ad-hoc signed ${outputPath}`)
}
