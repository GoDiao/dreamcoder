// The app's own version. The JSON import is inlined when the desktop sidecar is
// compiled, so a packaged build reports the version it was released as.
import { version as packageVersion } from './package.json';

const version = process.env.DREAMCODER_LOCAL_VERSION ?? packageVersion;
const packageUrl = process.env.DREAMCODER_LOCAL_PACKAGE_URL ?? 'dreamcoder-local';
const buildTime = process.env.DREAMCODER_LOCAL_BUILD_TIME ?? new Date().toISOString();

process.env.DREAMCODER_LOCAL_SKIP_REMOTE_PREFETCH ??= '1';

Object.assign(globalThis, {
  MACRO: {
    VERSION: version,
    PACKAGE_URL: packageUrl,
    NATIVE_PACKAGE_URL: packageUrl,
    BUILD_TIME: buildTime,
    FEEDBACK_CHANNEL: 'local',
    VERSION_CHANGELOG: '',
    ISSUES_EXPLAINER: '',
  },
});
if (process.env.CALLER_DIR) {
  process.chdir(process.env.CALLER_DIR);
}