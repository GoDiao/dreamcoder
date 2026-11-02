import { SCRATCH_CHOICE } from './constants.js'

export const DESCRIPTION = 'Show the user 2 to 4 design templates as cards, with your reason for each, and create an artifact from the one they pick.'

export const PROMPT = `Use this in design mode when a starting template may help. Pick 2 to 4 templates from the template index of the design skill and give a short reason for each, based on what the user told you. The user sees a card per template with a thumbnail, and a last card "start from scratch". You cannot see the thumbnails; the user judges how a template looks.

When the user picks a template, it is copied into dc_artifacts/<name>/ of your working directory with a manifest, and the result gives the new path and how to adapt the template. When the user picks "start from scratch" the result says ${SCRATCH_CHOICE}: write the artifact yourself as the artifacts skill describes. Do not ask for the choice some other way, and never fill in the choice field yourself.

Optional name is the folder name (a short lowercase slug, default the template id) and title is the artifact title (default the template title).`
