export const DESCRIPTION = 'Check an artifact folder in dc_artifacts/ for problems: the manifest, the entry file and local files the page references.'

export const PROMPT = `Checks an artifact before you show it to the user. Pass the path of the artifact folder (dc_artifacts/<name>) or of its artifact.json.

It reports an invalid manifest, a missing entry file, local files the page references that do not exist, and references that point outside dc_artifacts/ (the page can only read files inside dc_artifacts/, so copy such files into the artifact folder). When the manifest names a designSystem it also checks that the system folder has DESIGN.md and tokens.css and that the entry page links tokens.css. An empty list means no problems were found.`
