import { z } from "zod";

const text = z.string().trim().min(1).max(12000);
const texts = z.array(text).min(1).max(100);
export const REUSE_KINDS = ["general", "domain", "content-specific"] as const;
export const reuseLabels = {
  general: "通用", // i18n-exempt: unused by the UI (see catalog namespace)
  domain: "专题", // i18n-exempt: unused by the UI (see catalog namespace)
  "content-specific": "内容专用", // i18n-exempt: unused by the UI (see catalog namespace)
  unclassified: "待评估", // i18n-exempt: unused by the UI (see catalog namespace)
} as const;
const documentationV1 = z
  .object({
    version: z.literal(1),
    reuse: z
      .object({
        kind: z.enum(REUSE_KINDS),
        boundaries: texts,
        owner: text.optional(),
      })
      .strict(),
    usage: z
      .object({
        purpose: text,
        structure: texts,
        inputs: z
          .array(z.object({ path: text, meaning: text }).strict())
          .min(1)
          .max(200),
        recipes: z
          .array(
            z
              .object({
                title: text,
                steps: texts,
                exampleIndex: z.number().int().nonnegative().optional(),
              })
              .strict(),
          )
          .min(1)
          .max(30),
        interactions: z
          .array(
            z
              .object({
                action: text,
                effect: text,
                persistence: z.enum(["view", "content", "mixed", "none"]),
              })
              .strict(),
          )
          .min(1)
          .max(50),
        constraints: texts,
        editing: z.object({ data: texts, implementation: texts }).strict(),
      })
      .strict(),
    development: z
      .object({
        entryPoints: z
          .array(z.object({ path: text, purpose: text }).strict())
          .min(1)
          .max(100),
        architecture: texts,
        extensionPoints: texts,
        invariants: texts,
        verification: texts,
      })
      .strict(),
  })
  .strict();
const parameterInputSchema = z
  .object({
    path: text.max(500),
    meaning: text,
    units: text.optional(),
    coordinateSystem: text.optional(),
    opaque: z.literal(true).optional(),
    omission: z
      .object({
        behavior: z.enum(["reject", "omit", "fallback"]),
        description: text,
        value: z.json().optional(),
        computedFrom: z.array(text.max(500)).min(1).max(20).optional(),
        from: z
          .object({ path: text.max(500), selection: z.enum(["first", "last"]) })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
const rulePath = text.max(500);
export const parameterRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unique"), path: rulePath }).strict(),
  z
    .object({
      kind: z.literal("reference"),
      path: rulePath,
      target: rulePath,
      sentinelValues: z
        .array(
          z.union([z.string(), z.number().finite(), z.boolean(), z.null()]),
        )
        .max(10)
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("index"),
      path: rulePath,
      target: rulePath,
      sentinelValues: z
        .array(z.union([z.number().int(), z.null()]))
        .max(10)
        .optional(),
      via: z.object({ source: rulePath, target: rulePath }).strict().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("sumMaximum"),
      paths: z.array(rulePath).min(2).max(8),
      maximum: z.number().finite(),
    })
    .strict(),
]);
const documentationV2 = documentationV1
  .extend({
    version: z.literal(2),
    authoring: z
      .object({ entry: text.max(500) })
      .strict()
      .optional(),
    usage: documentationV1.shape.usage
      .extend({
        inputs: z.array(parameterInputSchema).max(1000),
        rules: z.array(parameterRuleSchema).max(100).optional(),
      })
      .strict(),
  })
  .strict();
export const componentDocumentationSchema = z.discriminatedUnion("version", [
  documentationV1,
  documentationV2,
]);
export type ComponentDocumentation = z.infer<
  typeof componentDocumentationSchema
>;
export type ReuseKind = ComponentDocumentation["reuse"]["kind"];

export function validateComponentDocumentation(
  value: unknown,
  examples?: number,
): ComponentDocumentation {
  const documentation = componentDocumentationSchema.parse(value);
  for (const recipe of documentation.usage.recipes) {
    if (
      recipe.exampleIndex !== undefined &&
      examples !== undefined &&
      recipe.exampleIndex >= examples
    )
      throw new Error(
        `Documentation recipe '${recipe.title}' references a missing example.`,
      );
  }
  if (
    documentation.reuse.kind === "content-specific" &&
    !documentation.reuse.owner
  )
    throw new Error(
      "Content-specific components must identify their owning work or purpose.",
    );
  return documentation;
}

export function documentationStatus(value: {
  documentation?: ComponentDocumentation;
}) {
  return value.documentation ? ("available" as const) : ("missing" as const);
}
