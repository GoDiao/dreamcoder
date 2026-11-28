import { formatFileSize } from '../../utils/format.js'
import { getMainLoopModel } from '../../utils/model/model.js'
import { getCliModelRules } from '../../utils/model/modelRules.js'
import { isPDFSupported } from '../../utils/pdfUtils.js'
import { BASH_TOOL_NAME } from '../BashTool/toolName.js'

// Use a string constant for tool names to avoid circular dependencies
export const FILE_READ_TOOL_NAME = 'Read'

export const FILE_UNCHANGED_STUB =
  'File unchanged since last read. The content from the earlier Read tool_result in this conversation is still current — refer to that instead of re-reading.'

const READ_TRUNCATED_NOTE_START =
  '<system-reminder>This read stopped early to fit the size limit'

const READ_TRUNCATED_RANGE = /^: it returned lines \d+-(\d+) of (\d+)\./

export function readTruncatedNote(
  firstLine: number,
  lastLine: number,
  totalLines: number,
): string {
  return `\n\n${READ_TRUNCATED_NOTE_START}: it returned lines ${firstLine}-${lastLine} of ${totalLines}. Use offset and limit to read other parts of the file, for example offset ${lastLine + 1} for what follows.</system-reminder>`
}

export function readTruncatedRange(
  result: string,
): { lastLine: number; totalLines: number } | null {
  const start = result.indexOf(READ_TRUNCATED_NOTE_START)
  if (start === -1) {
    return null
  }
  const range = READ_TRUNCATED_RANGE.exec(
    result.slice(start + READ_TRUNCATED_NOTE_START.length),
  )
  return range
    ? { lastLine: Number(range[1]), totalLines: Number(range[2]) }
    : null
}

export const DESCRIPTION = 'Read a file from the local filesystem.'

export const LINE_FORMAT_INSTRUCTION =
  '- Results are returned using cat -n format, with line numbers starting at 1'

export const OFFSET_INSTRUCTION_DEFAULT =
  "- You can optionally specify a line offset and limit (especially handy for long files)"

export const OFFSET_INSTRUCTION_TARGETED =
  '- When you already know which part of the file you need, only read that part. This can be important for larger files.'

/**
 * Renders the Read tool prompt template.  The caller (FileReadTool) supplies
 * the runtime-computed parts.
 */
export function readSizeInstruction(
  maxSizeBytes: number,
  maxTokens: number,
): string {
  return `. A read without a limit stops at ${formatFileSize(maxSizeBytes)} and any read stops at ${maxTokens.toLocaleString('en-US')} tokens: it returns the lines that fit and says which lines they are, so use offset and limit to read the rest`
}

export function renderPromptTemplate(
  lineFormat: string,
  maxSizeInstruction: string,
  offsetInstruction: string,
): string {
  return `Reads a file from the local filesystem. You can access any file directly by using this tool.
Assume this tool is able to read all files on the machine. If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads the whole file${maxSizeInstruction}
${offsetInstruction}
${lineFormat}
${getMediaInstructions()}
- This tool can read Jupyter notebooks (.ipynb files) and returns all cells with their outputs, combining code, text, and visualizations.
- This tool can only read files, not directories. To read a directory, use an ls command via the ${BASH_TOOL_NAME} tool.
- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.`
}

function getMediaInstructions(): string {
  const model = getMainLoopModel()
  const pdfInstruction = isPDFSupported(model)
    ? '\n- This tool can read PDF files (.pdf). For large PDFs (more than 10 pages), you MUST provide the pages parameter to read specific page ranges (e.g., pages: "1-5"). Reading a large PDF without the pages parameter will fail. Maximum 20 pages per request.'
    : ''
  if (getCliModelRules(model)?.image === false) {
    return `- Images do not reach the current model: reading an image returns a short text note in its place. Do not describe an image you have not seen.${pdfInstruction}`
  }
  return `- This tool can read images (eg PNG, JPG, etc). When reading an image file the contents are presented visually.${pdfInstruction}
- You will regularly be asked to read screenshots. If the user provides a path to a screenshot, ALWAYS use this tool to view the file at the path. This tool will work with all temporary file paths.`
}
