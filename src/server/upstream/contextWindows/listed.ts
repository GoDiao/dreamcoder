import { asRecord, inputModalities, metadataById, type ModelMetadataSource, type RawModelMetadata } from './source.js'

function firstNumber(values: unknown[]): unknown {
  return values.find((value) => typeof value === 'number')
}

function readListedMetadata(entry: Record<string, unknown>): RawModelMetadata {
  const capabilities = asRecord(entry.capabilities)
  const modalities = inputModalities(asRecord(entry.architecture)?.input_modalities ?? entry.input_modalities)
  return {
    contextWindow: firstNumber([entry.max_input_tokens, entry.context_length, entry.context_window]),
    maxOutputTokens: firstNumber([entry.max_tokens, entry.max_output_tokens, asRecord(entry.top_provider)?.max_completion_tokens]),
    image: asRecord(capabilities?.image_input)?.supported ?? entry.supports_image_in ?? modalities.image,
    pdf: asRecord(capabilities?.pdf_input)?.supported ?? modalities.pdf,
  }
}

export const listedSource: ModelMetadataSource = {
  id: 'listed',
  matches: () => true,
  metadata: async ({ listed }) => metadataById(listed, 'id', readListedMetadata),
}
