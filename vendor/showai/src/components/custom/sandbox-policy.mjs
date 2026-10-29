// Only local, opaque srcdoc readers may nest inside a component. HTTPS, file,
// data and blob frames remain blocked; descendants inherit the offline policy.
export const componentSandboxPolicy =
  "default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; media-src data:; font-src data:; connect-src 'none'; object-src 'none'; frame-src about:; base-uri 'none'; form-action 'none'";
