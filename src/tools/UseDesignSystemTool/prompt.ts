export const DESCRIPTION = 'Copy a design system from the bundled library into dc_artifacts/systems/ of your working directory, after the user confirms.'

export const PROMPT = `Use this in design mode when the artifact should follow a design system from the library index of the design skill. The user confirms the copy. The system is copied into dc_artifacts/systems/<name>/ of your working directory (DESIGN.md, tokens.css and system.json); if the same system is already there, that copy is reused and nothing is overwritten.

The result gives the path and how to apply it: read DESIGN.md, link tokens.css from the artifact's entry HTML with a relative path, take every value from var(--*), and set designSystem in artifact.json.

Pass id from the index. The optional name is the folder name (default the id). Only systems from the library can be copied here; a system you extract from a website or project code is written directly into dc_artifacts/systems/<name>/ as the design skill describes.`
