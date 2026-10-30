import { CAPACITY } from "./capacity.mjs";
/** Shared transport rules for Node verification and the browser reader. No code executes here. */
export const MAX_PUBLICATION_BUNDLE_BYTES = CAPACITY.publicationBytes;
const digestPattern = /^sha256-[a-f0-9]{64}$/;
const idPattern = /^[a-z][a-z0-9-]{0,79}$/;
const versionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[a-zA-Z0-9.-]+)?$/;

export function publicationRefKey(ref) {
  return `${ref.kind}:${ref.id}@${ref.version}#${ref.integrity}`;
}

export function validatePublicationRef(value, kind) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !["component", "template"].includes(value.kind) ||
    (kind && value.kind !== kind) ||
    typeof value.id !== "string" ||
    typeof value.version !== "string" ||
    typeof value.integrity !== "string" ||
    !idPattern.test(value.id) ||
    !versionPattern.test(value.version) ||
    !digestPattern.test(value.integrity)
  )
    throw new Error(
      "A publication requires an exact kind/id/version/integrity reference.",
    );
  if (
    value.scope !== undefined &&
    !["project", "global", "published", "builtin"].includes(value.scope)
  )
    throw new Error("Invalid publication reference scope.");
  if (
    value.projectId !== undefined &&
    (typeof value.projectId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value.projectId))
  )
    throw new Error("Invalid publication project reference.");
  return {
    kind: value.kind,
    id: value.id,
    version: value.version,
    integrity: value.integrity,
    ...(value.scope ? { scope: value.scope } : {}),
    ...(value.projectId ? { projectId: value.projectId } : {}),
  };
}

export function publicationUrl(value) {
  if (typeof value !== "string" || value.length > 8192)
    throw new Error(
      "Publication URL must be an HTTPS URL or a loopback HTTP URL.",
    );
  const url = new URL(value);
  const octets = url.hostname.split(".");
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "[::1]" ||
    (octets.length === 4 &&
      octets[0] === "127" &&
      octets.every((part) => /^\d+$/.test(part) && Number(part) <= 255));
  if (
    url.username ||
    url.password ||
    url.hash ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
  )
    throw new Error(
      "Publications require HTTPS; HTTP is allowed only on loopback. Credentials, fragments and file URLs are forbidden.",
    );
  return url.href;
}

export function validateRemoteComponents(input) {
  if (!Array.isArray(input) || input.length > 100)
    throw new Error(
      "remoteComponents must contain at most 100 locked locators.",
    );
  const seen = new Set();
  return input.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw new Error("Invalid published component locator.");
    const ref = validatePublicationRef(entry.ref, "component");
    const key = publicationRefKey(ref);
    if (seen.has(key)) throw new Error(`Duplicate remote component: ${key}`);
    seen.add(key);
    if (
      !digestPattern.test(entry.sha256) ||
      !digestPattern.test(entry.manifestIntegrity) ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes < 1 ||
      entry.bytes > MAX_PUBLICATION_BUNDLE_BYTES ||
      typeof entry.verifiedAt !== "string" ||
      !Number.isFinite(Date.parse(entry.verifiedAt))
    )
      throw new Error(
        "Remote components require verified byte length, SHA-256 and publication metadata.",
      );
    return {
      ref,
      bundleRef: validatePublicationRef(entry.bundleRef),
      url: publicationUrl(entry.url),
      sha256: entry.sha256,
      bytes: entry.bytes,
      manifestUrl: publicationUrl(entry.manifestUrl),
      manifestIntegrity: entry.manifestIntegrity,
      verifiedAt: entry.verifiedAt,
    };
  });
}

export async function sha256Bytes(bytes) {
  if (!globalThis.crypto?.subtle)
    throw Object.assign(
      // i18n-exempt: CLI message; readers translate by code
      new Error("组件完整性校验需要 HTTPS 或在本机打开页面。"),
      { code: "INTEGRITY_UNAVAILABLE" },
    );
  const result = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return (
    "sha256-" +
    [...new Uint8Array(result)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
  );
}

export async function fetchPublicationFile(input, options = {}) {
  const url = publicationUrl(input);
  const response = await fetch(url, {
    credentials: "omit",
    mode: "cors",
    redirect: "error",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    headers: { Accept: "application/json" },
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(
      `Published component request failed (${response.status}): ${url}`,
    );
  if (
    options.requireCors &&
    response.headers.get("access-control-allow-origin") !== "*"
  )
    throw new Error(
      `Publication must serve Access-Control-Allow-Origin: * so portable readers can load it: ${url}`,
    );
  const maxBytes = options.maxBytes ?? MAX_PUBLICATION_BUNDLE_BYTES;
  if (!response.body) throw new Error("Published bundle response has no body.");
  const reader = response.body.getReader();
  const parts = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Published bundle exceeds its size limit.");
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return {
    bytes,
    text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    sha256: await sha256Bytes(bytes),
    cors: response.headers.get("access-control-allow-origin"),
  };
}

export async function loadRemoteComponents(input, options = {}) {
  const locators = validateRemoteComponents(input);
  const downloads = new Map();
  let total = 0;
  const components = [];
  for (const locator of locators) {
    const key = `${locator.url}#${locator.sha256}`;
    let bundle = downloads.get(key);
    if (!bundle) {
      let received;
      try {
        received = await fetchPublicationFile(locator.url, {
          signal: options.signal,
          maxBytes: locator.bytes,
        });
      } catch (error) {
        throw Object.assign(
          new Error(
            // i18n-exempt: CLI message; readers translate by code
            `无法加载组件 ${locator.ref.id}@${locator.ref.version}：${error instanceof Error ? error.message : "网络请求失败"}。请检查网络和发布服务器的 CORS 设置。`,
            { cause: error },
          ),
          {
            code: "COMPONENT_FETCH_FAILED",
            params: {
              component: `${locator.ref.id}@${locator.ref.version}`,
              reason: error instanceof Error ? error.message : "",
            },
          },
        );
      }
      if (
        received.bytes.byteLength !== locator.bytes ||
        received.sha256 !== locator.sha256
      )
        throw Object.assign(
          new Error(
            // i18n-exempt: CLI message; readers translate by code
            `组件 ${locator.ref.id}@${locator.ref.version} 的文件校验失败（SHA-256 或字节数不一致）。`,
          ),
          {
            code: "COMPONENT_CHECKSUM_FAILED",
            params: { component: `${locator.ref.id}@${locator.ref.version}` },
          },
        );
      total += received.bytes.byteLength;
      if (total > CAPACITY.publicationTransferBytes)
        throw new Error("Remote component downloads exceed the 512 MiB limit.");
      bundle = JSON.parse(received.text);
      if (
        bundle?.format !== "showai-catalog-bundle" ||
        bundle.version !== 1 ||
        !Array.isArray(bundle.components)
      )
        throw new Error("Unsupported published component bundle.");
      downloads.set(key, bundle);
    }
    if (
      publicationRefKey(validatePublicationRef(bundle.root)) !==
      publicationRefKey(locator.bundleRef)
    )
      throw new Error(
        `Published bundle revision does not match ${locator.ref.id}@${locator.ref.version}.`,
      );
    const component = bundle.components
      .map((item) => item?.component)
      .find(
        (item) =>
          item?.id === locator.ref.id &&
          item?.version === locator.ref.version &&
          item?.integrity === locator.ref.integrity,
      );
    if (
      !component ||
      typeof component.html !== "string" ||
      !component.html.includes("<!--SHOWAI_COMPONENT_DATA-->") ||
      component.schema === undefined ||
      typeof component.name !== "string"
    )
      throw new Error(
        `Published bundle does not contain the exact component revision ${publicationRefKey(locator.ref)}.`,
      );
    components.push(component);
  }
  return components;
}
