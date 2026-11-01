import { systemChromium } from "./system-browser.mjs";

export function loadPlaywright() {
  return { chromium: systemChromium };
}

export async function launchChromium(chromium) {
  const url = process.env.DREAMCODER_WEB_CLONE_URL;
  const token = process.env.DREAMCODER_WEB_CLONE_TOKEN;
  if (!url || !token) {
    throw new Error(
      "Website cloning needs the DreamCoder desktop app: it provides the browser these scripts use. " +
        "Open this session in the desktop app and try again.",
    );
  }
  return chromium.connectBrowserSession({ url, token });
}
