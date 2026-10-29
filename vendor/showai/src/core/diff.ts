import { CapacityError } from "../portable/capacity.mjs";
import { richTextDocument } from "../components/rich-text/model.mjs";
import {
  reconcileConnections,
  transformedBindings,
  indexSurfaceTree,
} from "../surface/connections.mjs";
import { insertComponent } from "../surface/component-insertion";
import { completeDrawings } from "../surface/drawing-completion.mjs";
import { insertDiagram, tidyFrames } from "../surface/diagram.mjs";
import {
  isResource,
  upgradeResource,
  createSurface,
  wrapSurface,
  surfaceViews,
} from "../surface/containers.mjs";
import { createHash } from "node:crypto";
import { compileBinding, readBinding } from "../datasets/binding.mjs";
import { readCustomBlockData } from "../components/custom/contract";
import { validateDocument } from "../portable/validation.mjs";
import { CoreError, PAGE_OPERATION_FIELDS } from "./model";
import {
  isSurface,
  reconcileSurface,
  fillSurfaceLayout,
  visitNodes,
} from "../surface/document.mjs";
import type {
  FieldChange,
  JSONContent,
  PageChange,
  PageOperation,
  ShowDocument,
} from "./model";

export { canonicalJson } from "./canonical";
import { canonicalJson } from "./canonical";

/** Blocks bound to shared data must carry a complete, valid binding when saved. */
function assertBindings(document: ShowDocument) {
  visitNodes(document.content, (node) => {
    if (node.type !== "widget" || !readBinding(node.attrs?.data)) return;
    try {
      compileBinding(readBinding(node.attrs!.data));
    } catch (error) {
      throw new CoreError(
        "INVALID_DATA",
        `Block ${node.attrs?.id ?? ""} $binding: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}

/** Only document bookkeeping dates are excluded; dates in user data remain meaningful. */
export function documentHash(document: ShowDocument): string {
  const { createdAt: _createdAt, updatedAt: _updatedAt, ...content } = document;
  return createHash("sha256").update(canonicalJson(content)).digest("hex");
}

/**
 * `validated` is only for the fresh document parseArtifact just returned; it
 * is mutated in place instead of being validated and cloned a second time.
 */
export function normalizeDocument(
  input: unknown,
  previous?: ShowDocument,
  options: { validated?: boolean } = {},
): ShowDocument {
  let document: ShowDocument;
  try {
    document = options.validated
      ? (input as ShowDocument)
      : validateDocument(input);
  } catch (error) {
    if (error instanceof CapacityError) throw error;
    throw new CoreError(
      "INVALID_DATA",
      error instanceof Error ? error.message : "Invalid page document.",
    );
  }
  if (!options.validated) assertBindings(document);
  const used = new Set<string>();
  const oldIds = new Map<string, string[]>();
  const signature = (node: JSONContent) => {
    const strip = (item: JSONContent): JSONContent => {
      const { id: _id, ...attrs } = item.attrs ?? {};
      return {
        ...item,
        ...(item.attrs ? { attrs } : {}),
        ...(item.content ? { content: item.content.map(strip) } : {}),
      };
    };
    return canonicalJson(strip(node));
  };
  const collectOld = (node: JSONContent) => {
    if (
      node.type !== "doc" &&
      node.type !== "surface" &&
      node.type !== "text" &&
      typeof node.attrs?.id === "string"
    ) {
      const key = signature(node);
      oldIds.set(key, [...(oldIds.get(key) ?? []), node.attrs.id]);
    }
    node.content?.forEach(collectOld);
  };
  if (previous) collectOld(previous.content);
  const visit = (node: JSONContent, path: string) => {
    if (!["doc", "surface", "text"].includes(node.type ?? "")) {
      let id =
        typeof node.attrs?.id === "string" && node.attrs.id.trim()
          ? node.attrs.id
          : undefined;
      if (!id)
        id = oldIds
          .get(signature(node))
          ?.find((candidate) => !used.has(candidate));
      if (!id || used.has(id))
        id = `block-${createHash("sha256")
          .update(`${document.id}:${path}:${signature(node)}`)
          .digest("hex")
          .slice(0, 24)}`;
      while (used.has(id)) id = `${id}-copy`;
      used.add(id);
      node.attrs = { ...node.attrs, id };
    }
    node.content?.forEach((child, index) => visit(child, `${path}/${index}`));
  };
  visit(document.content, "");
  const contentBeforeConnections = document.content;
  reconcileConnections(document);
  return document.content === contentBeforeConnections
    ? document
    : validateDocument(document);
}

interface NodeEntry {
  node: JSONContent;
  parentId: string | null;
  afterId: string | null;
}

export function indexBlocks(document: ShowDocument): Map<string, NodeEntry> {
  const blocks = new Map<string, NodeEntry>();
  const walk = (parent: JSONContent, parentId: string | null) => {
    let afterId: string | null = null;
    for (const node of parent.content ?? []) {
      if (node.type === "text") continue;
      const id = node.attrs?.id;
      if (typeof id !== "string" || !id)
        throw new CoreError(
          "INVALID_DATA",
          "A block is missing its stable id. Save the page before comparing changes.",
        );
      if (blocks.has(id))
        throw new CoreError("INVALID_DATA", `Duplicate block id: ${id}`);
      blocks.set(id, { node, parentId, afterId });
      walk(node, id);
      afterId = id;
    }
  };
  walk(document.content, null);
  return blocks;
}

function changesForFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  prefix = "",
): FieldChange[] {
  const result: FieldChange[] = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (
      Object.hasOwn(before, key) === Object.hasOwn(after, key) &&
      canonicalJson(before[key]) === canonicalJson(after[key])
    )
      continue;
    const field = prefix ? `${prefix}.${key}` : key;
    const left = before[key];
    const right = after[key];
    if (
      left &&
      right &&
      typeof left === "object" &&
      typeof right === "object" &&
      !Array.isArray(left) &&
      !Array.isArray(right)
    ) {
      result.push(
        ...changesForFields(
          left as Record<string, unknown>,
          right as Record<string, unknown>,
          field,
        ),
      );
    } else {
      result.push({
        field,
        ...(left !== undefined ? { before: left } : {}),
        ...(right !== undefined ? { after: right } : {}),
      });
    }
  }
  return result;
}

export function diffDocuments(
  before: ShowDocument,
  after: ShowDocument,
): PageChange[] {
  const changes: PageChange[] = [];
  const metadata = (document: ShowDocument): Record<string, unknown> => {
    const {
      content: _content,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      ...rest
    } = document;
    return rest;
  };
  const pageFields = changesForFields(metadata(before), metadata(after));
  if (before.content.type !== after.content.type)
    pageFields.push({
      field: "content.type",
      before: before.content.type,
      after: after.content.type,
    });
  if (isResource(before) || isResource(after))
    pageFields.push(
      ...changesForFields(
        before.content.attrs ?? {},
        after.content.attrs ?? {},
        "content.attrs",
      ),
    );
  if (pageFields.length)
    changes.push({ type: "page.changed", fields: pageFields });
  const oldBlocks = indexBlocks(before);
  const newBlocks = indexBlocks(after);
  for (const [id, entry] of oldBlocks) {
    if (
      !newBlocks.has(id) &&
      (!entry.parentId || newBlocks.has(entry.parentId))
    ) {
      changes.push({
        type: "block.removed",
        blockId: id,
        parentId: entry.parentId,
        node: entry.node,
      });
    }
  }
  for (const [id, entry] of newBlocks) {
    const old = oldBlocks.get(id);
    if (!old) {
      if (!entry.parentId || oldBlocks.has(entry.parentId))
        changes.push({ type: "block.added", blockId: id, ...entry });
      continue;
    }
    // Direct text and marks belong to this block. Nested blocks have their own records.
    const own = (node: JSONContent): Record<string, unknown> => {
      const { content, ...rest } = node;
      return {
        ...rest,
        content: (content ?? []).filter((child) => child.type === "text"),
      };
    };
    const fields = changesForFields(own(old.node), own(entry.node));
    if (fields.length)
      changes.push({ type: "block.changed", blockId: id, fields });
    if (old.parentId !== entry.parentId || old.afterId !== entry.afterId) {
      // Removing/inserting a preceding sibling is not a move of every later sibling.
      const survivingPredecessor = (
        map: Map<string, NodeEntry>,
        target: NodeEntry,
        other: Map<string, NodeEntry>,
      ): string | null => {
        let previous = target.afterId;
        while (previous && !other.has(previous))
          previous = map.get(previous)?.afterId ?? null;
        return previous;
      };
      if (
        old.parentId !== entry.parentId ||
        survivingPredecessor(oldBlocks, old, newBlocks) !==
          survivingPredecessor(newBlocks, entry, oldBlocks)
      ) {
        changes.push({
          type: "block.moved",
          blockId: id,
          parentId: entry.parentId,
          afterId: entry.afterId,
        });
      }
    }
  }
  return changes;
}

export function applyOperations(
  document: ShowDocument,
  operations: PageOperation[],
): ShowDocument {
  if (!Array.isArray(operations) || operations.length > 1000)
    throw new CoreError(
      "INVALID_DATA",
      "Expected at most 1000 page operations.",
    );
  let draft = structuredClone(document);
  const transformedIds = new Set<string>();
  // Frames the caller set explicitly; others are automatic placeholders that
  // drawing completion may size from the drawing itself.
  const framed = new Set(Object.keys(document.layout ?? {}));
  let removedPlaceholder = false;
  const locate = (
    id: string,
  ): { parent: JSONContent; index: number; node: JSONContent } => {
    const visit = (
      parent: JSONContent,
    ): ReturnType<typeof locate> | undefined => {
      for (const [index, node] of (parent.content ?? []).entries()) {
        if (node.type !== "text" && node.attrs?.id === id)
          return { parent, index, node };
        const found = visit(node);
        if (found) return found;
      }
    };
    const found = visit(draft.content);
    if (!found) throw new CoreError("NOT_FOUND", `Block ${id} does not exist.`);
    return found;
  };
  const viewOwner = (id?: string) => {
    const node =
      !id || id === draft.content.attrs?.id ? draft.content : locate(id).node;
    if (node.type !== "surface" || (!isResource(draft) && id))
      throw new CoreError(
        "INVALID_DATA",
        "Views belong to a Page or Board container.",
      );
    return node;
  };
  const insert = (
    node: JSONContent,
    parentId?: string | null,
    afterId?: string | null,
  ) => {
    if (
      ["text", "doc"].includes(node.type ?? "") ||
      (node.type === "surface" && !isResource(draft))
    )
      throw new CoreError(
        "INVALID_DATA",
        "Insert a block node, not a text or document node.",
      );
    const parent =
      parentId && parentId !== draft.content.attrs?.id
        ? locate(parentId).node
        : draft.content;
    const children = parent.content ?? [];
    let index = children.length;
    if (afterId === null) index = 0;
    else if (afterId !== undefined) {
      const sibling = children.findIndex(
        (child) => child.attrs?.id === afterId,
      );
      if (sibling < 0)
        throw new CoreError(
          "NOT_FOUND",
          `Insertion anchor ${afterId} does not belong to this parent.`,
        );
      index = sibling + 1;
    }
    children.splice(index, 0, node);
    parent.content = children;
  };
  // A new nested Page holds one empty paragraph so people can type into it.
  // Content added through an operation replaces that placeholder.
  const placeholderOf = (parentId?: string | null) => {
    if (!parentId || parentId === draft.content.attrs?.id) return undefined;
    const parent = locate(parentId).node;
    const only = parent.content?.length === 1 ? parent.content[0] : undefined;
    return parent.type === "surface" &&
      parent.attrs?.kind === "page" &&
      only?.type === "richText" &&
      (only.content ?? []).every(
        (child) => child.type === "paragraph" && !child.content?.length,
      )
      ? { parentId: parent.attrs!.id as string, id: only.attrs!.id as string }
      : undefined;
  };
  const dropPlaceholder = (
    placeholder: ReturnType<typeof placeholderOf>,
  ) => {
    if (!placeholder) return;
    const parent = locate(placeholder.parentId).node;
    if ((parent.content?.length ?? 0) < 2) return;
    parent.content = parent.content!.filter(
      (child) => child.attrs?.id !== placeholder.id,
    );
    removedPlaceholder = true;
  };
  for (const operation of operations) {
    if (!operation || typeof operation !== "object")
      throw new CoreError("INVALID_DATA", "Invalid page operation.");
    switch (operation.type) {
      case "component.insert": {
        const placeholder = isResource(draft)
          ? placeholderOf(operation.parentId)
          : undefined;
        draft = insertComponent(
          draft,
          operation.parentId ?? null,
          operation.kind,
          operation.data,
          operation.afterId,
        ).document;
        dropPlaceholder(placeholder);
        break;
      }
      case "diagram.insert": {
        if (!isResource(draft))
          throw new CoreError(
            "INVALID_DATA",
            "Upgrade this page before inserting a diagram.",
          );
        fillSurfaceLayout(draft);
        try {
          const inserted = insertDiagram(draft, operation);
          inserted.shapeIds.forEach((id) => framed.add(id));
        } catch (error) {
          throw new CoreError(
            "INVALID_DATA",
            error instanceof Error ? error.message : "Invalid diagram.",
          );
        }
        break;
      }
      case "diagram.arrange": {
        if (
          !isResource(draft) ||
          !Array.isArray(operation.nodeIds) ||
          operation.nodeIds.length > 400 ||
          operation.nodeIds.some((id) => typeof id !== "string")
        )
          throw new CoreError(
            "INVALID_DATA",
            "diagram.arrange needs nodeIds of objects on a Board.",
          );
        operation.nodeIds.forEach(locate);
        fillSurfaceLayout(draft);
        let tidy: ReturnType<typeof tidyFrames>;
        try {
          tidy = tidyFrames(draft, operation.nodeIds, operation.direction);
        } catch (error) {
          throw new CoreError(
            "INVALID_DATA",
            error instanceof Error ? error.message : "Invalid direction.",
          );
        }
        if (!tidy)
          throw new CoreError(
            "INVALID_DATA",
            "diagram.arrange needs two or more unlocked, framed objects in one container with an arrow between two of them.",
          );
        Object.assign(draft.layout!, tidy.frames);
        Object.keys(tidy.frames).forEach((id) => framed.add(id));
        // Arrows re-attach to the sides that face each other in the new arrangement.
        for (const [arrowId, anchors] of Object.entries(tidy.anchors)) {
          const arrow = locate(arrowId).node;
          const bindings = arrow.attrs!.bindings;
          arrow.attrs = {
            ...arrow.attrs,
            bindings: {
              start: { ...bindings.start, anchor: anchors.start },
              end: { ...bindings.end, anchor: anchors.end },
            },
          };
        }
        break;
      }
      case "surface.upgrade":
        draft = upgradeResource(draft);
        break;
      case "surface.create": {
        draft = upgradeResource(draft);
        const node = createSurface(
          operation.kind,
          operation.name,
          operation.nodeId,
        );
        insert(node, operation.parentId);
        fillSurfaceLayout(draft);
        break;
      }
      case "surface.wrap":
        draft = upgradeResource(draft);
        draft = wrapSurface(
          draft,
          operation.nodeId ?? draft.content.attrs!.id,
          operation.kind,
        );
        break;
      case "surface.layout.set": {
        if (
          !operation.layout ||
          typeof operation.layout !== "object" ||
          Array.isArray(operation.layout)
        )
          throw new CoreError("INVALID_DATA", "Layout must be an object.");
        if (!isSurface(draft))
          throw new CoreError(
            "INVALID_DATA",
            "Upgrade this page before changing its whiteboard layout.",
          );
        const target = locate(operation.nodeId);
        if (target.parent.type !== "surface" && target.parent.type !== "region")
          throw new CoreError(
            "INVALID_DATA",
            "Layout belongs to a region or its direct content.",
          );
        if (
          target.node.type !== "region" &&
          ["mode", "columns", "gap"].some((key) => key in operation.layout)
        )
          throw new CoreError(
            "INVALID_DATA",
            "Only regions can define mode, columns and gap.",
          );
        fillSurfaceLayout(draft);
        framed.add(operation.nodeId);
        const beforeFrame = draft.layout![operation.nodeId];
        draft.layout![operation.nodeId] = {
          ...(beforeFrame ?? { x: 0, y: 0, width: 360 }),
          ...operation.layout,
        };
        if (
          ["x", "y", "width", "height", "rotation"].some(
            (key) =>
              Object.hasOwn(operation.layout, key) &&
              operation.layout[key as keyof typeof operation.layout] !==
                beforeFrame?.[key as keyof typeof beforeFrame],
          )
        )
          transformedIds.add(operation.nodeId);
        break;
      }
      case "surface.view.save": {
        if (
          !operation.view ||
          !Array.isArray(operation.view.targets) ||
          !operation.view.targets.length
        )
          throw new CoreError(
            "INVALID_DATA",
            "A view requires existing target nodes.",
          );
        for (const id of operation.view.targets) locate(id);
        const owner = viewOwner(operation.surfaceId),
          targets = new Set<string>();
        visitNodes(owner, (node) => {
          if (node !== owner && node.attrs?.id) targets.add(node.attrs.id);
        });
        if (operation.view.targets.some((id) => !targets.has(id)))
          throw new CoreError(
            "INVALID_DATA",
            "View targets must belong to their container.",
          );
        if (!isSurface(draft))
          throw new CoreError(
            "INVALID_DATA",
            "Upgrade this page before saving a view.",
          );
        const views = surfaceViews(draft, viewOwner(operation.surfaceId));
        views.saved = [
          ...views.saved.filter((view) => view.id !== operation.view.id),
          structuredClone(operation.view),
        ];
        if (operation.initial) views.initial = operation.view.id;
        break;
      }
      case "surface.view.remove": {
        if (!isSurface(draft))
          throw new CoreError(
            "INVALID_DATA",
            "This page has no whiteboard views.",
          );
        const views = surfaceViews(draft, viewOwner(operation.surfaceId));
        views.saved = views.saved.filter(
          (view) => view.id !== operation.viewId,
        );
        if (views.initial === operation.viewId) views.initial = null;
        break;
      }
      case "surface.reading-order.set": {
        const owner = viewOwner(operation.surfaceId);
        const rootIds = new Set(owner.content?.map((node) => node.attrs?.id));
        if (
          !Array.isArray(operation.nodeIds) ||
          new Set(operation.nodeIds).size !== operation.nodeIds.length ||
          operation.nodeIds.some((id) => !rootIds.has(id))
        )
          throw new CoreError(
            "INVALID_DATA",
            "Reading order requires unique root node ids.",
          );
        if (!isSurface(draft))
          throw new CoreError(
            "INVALID_DATA",
            "This page has no whiteboard reading order.",
          );
        surfaceViews(draft, owner).readingOrder = operation.nodeIds;
        if (isResource(draft) && owner.attrs?.kind === "page")
          owner.content = [
            ...operation.nodeIds.map((id) =>
              owner.content!.find((node) => node.attrs?.id === id)!,
            ),
            ...owner.content!.filter(
              (node) => !operation.nodeIds.includes(node.attrs!.id),
            ),
          ];
        break;
      }
      case "page.set": {
        const allowed = new Set([
          "title",
          "icon",
          "cover",
          "parentId",
          "favorite",
          "archived",
          "comments",
          "layout",
          "views",
          "surfaceViews",
          "templateContext",
        ]);
        if (
          !operation.fields ||
          Object.keys(operation.fields).some((key) => !allowed.has(key))
        )
          throw new CoreError("INVALID_DATA", "Unsupported page field.");
        Object.assign(draft, operation.fields);
        break;
      }
      case "block.insert": {
        const placeholder = isResource(draft)
          ? placeholderOf(operation.parentId)
          : undefined;
        insert(
          structuredClone(operation.node),
          operation.parentId,
          operation.afterId,
        );
        dropPlaceholder(placeholder);
        break;
      }
      case "block.remove": {
        const target = locate(operation.blockId);
        target.parent.content!.splice(target.index, 1);
        break;
      }
      case "block.replace": {
        const target = locate(operation.blockId);
        if (
          ["text", "doc"].includes(operation.node.type ?? "") ||
          (operation.node.type === "surface" && !isResource(draft))
        )
          throw new CoreError(
            "INVALID_DATA",
            "Replacement must be a block node.",
          );
        const node = structuredClone(operation.node);
        node.attrs = { ...node.attrs, id: operation.blockId };
        target.parent.content![target.index] = node;
        break;
      }
      case "block.move": {
        const target = locate(operation.blockId);
        const contains = (node: JSONContent, id: string): boolean =>
          node.attrs?.id === id ||
          (node.content ?? []).some((child) => contains(child, id));
        if (
          (operation.parentId && contains(target.node, operation.parentId)) ||
          operation.afterId === operation.blockId
        )
          throw new CoreError(
            "INVALID_DATA",
            "A block cannot be moved inside itself or after itself.",
          );
        target.parent.content!.splice(target.index, 1);
        insert(target.node, operation.parentId, operation.afterId);
        break;
      }
      case "block.attrs.set": {
        if (
          !operation.attrs ||
          typeof operation.attrs !== "object" ||
          Array.isArray(operation.attrs) ||
          Object.hasOwn(operation.attrs, "id")
        )
          throw new CoreError(
            "INVALID_DATA",
            "Block attributes cannot change a stable id.",
          );
        const node = locate(operation.blockId).node;
        const attrs = { ...node.attrs, ...operation.attrs };
        // Like a JSON merge patch, null removes an attribute.
        for (const [key, value] of Object.entries(operation.attrs))
          if (value === null) delete attrs[key];
        node.attrs = attrs;
        break;
      }
      case "component.props.set": {
        const node = locate(operation.blockId).node;
        const data = node.attrs?.data;
        if (
          node.type !== "widget" ||
          !data ||
          typeof data !== "object" ||
          !operation.props ||
          typeof operation.props !== "object" ||
          Array.isArray(operation.props)
        )
          throw new CoreError(
            "INVALID_DATA",
            "component.props.set requires a component block and a props object.",
          );
        const props = structuredClone(operation.props);
        node.attrs = {
          ...node.attrs,
          data:
            node.attrs!.kind === "custom"
              ? { ...data, props: { ...data.props, ...props } }
              : { ...data, ...props },
        };
        break;
      }
      case "component.ref.set": {
        const node = locate(operation.blockId).node;
        const data = node.attrs?.data;
        if (
          node.type !== "widget" ||
          node.attrs?.kind !== "custom" ||
          !data ||
          typeof data !== "object" ||
          Array.isArray(data)
        )
          throw new CoreError(
            "INVALID_DATA",
            `component.ref.set requires a custom component block; ${operation.blockId} is ${node.type === "widget" ? `a ${String(node.attrs?.kind)} component` : `a ${String(node.type)} block`}.`,
          );
        for (const key of ["version", "integrity"] as const)
          if (typeof operation[key] !== "string" || !operation[key].trim())
            throw new CoreError(
              "INVALID_DATA",
              `component.ref.set requires ${key} from the component_save or catalog receipt.`,
            );
        if (
          operation.componentId !== undefined &&
          (typeof operation.componentId !== "string" ||
            !operation.componentId.trim())
        )
          throw new CoreError(
            "INVALID_DATA",
            "component.ref.set componentId must be non-empty text when given.",
          );
        // Only the reference changes; props and $binding are kept as stored.
        const { scope: _scope, ...rest } = data as Record<string, unknown>;
        const next = {
          ...rest,
          componentId: operation.componentId ?? rest.componentId,
          version: operation.version,
          integrity: operation.integrity,
        };
        try {
          readCustomBlockData(next);
        } catch (error) {
          throw new CoreError(
            "INVALID_DATA",
            `component.ref.set on ${operation.blockId}: ${error instanceof Error ? error.message : String(error)} Use componentId, version and integrity exactly as a component_save or catalog receipt returns them.`,
          );
        }
        node.attrs = { ...node.attrs, data: next };
        break;
      }
      case "block.text.set": {
        const node = locate(operation.blockId).node;
        if (node.type === "richText" && typeof operation.text === "string") {
          const previousId = node.content?.[0]?.attrs?.id;
          node.content = richTextDocument({
            content: operation.text,
            format: "plain",
          }).content;
          if (previousId && node.content?.[0])
            node.content[0].attrs = {
              ...node.content[0].attrs,
              id: previousId,
            };
          break;
        }
        if (
          !["paragraph", "heading", "codeBlock"].includes(node.type ?? "") ||
          typeof operation.text !== "string"
        )
          throw new CoreError(
            "INVALID_DATA",
            "Text replacement requires a paragraph, heading, or code block.",
          );
        node.content = operation.text
          ? [{ type: "text", text: operation.text }]
          : [];
        break;
      }
      default:
        throw new CoreError(
          "INVALID_DATA",
          `Unsupported operation: ${String((operation as { type?: unknown }).type)}. Page operations: ${Object.keys(PAGE_OPERATION_FIELDS).join(", ")} (guide authoring).`,
        );
    }
  }
  if (isSurface(draft)) {
    const before = indexSurfaceTree(document.content);
    fillSurfaceLayout(draft);
    try {
      completeDrawings(draft, {
        framed,
        fresh: new Set(
          [...indexSurfaceTree(draft.content).keys()].filter(
            (id) => !before.has(id),
          ),
        ),
      });
    } catch (error) {
      throw new CoreError(
        "INVALID_DATA",
        error instanceof Error ? error.message : "Invalid drawing.",
      );
    }
  }
  // Validate caller-supplied references before intentional structural cleanup.
  const structural =
    removedPlaceholder ||
    operations.some(
      (operation) =>
        (operation.type === "surface.layout.set" &&
          Object.hasOwn(operation.layout, "mode")) ||
        [
          "block.remove",
          "block.replace",
          "block.move",
          "block.insert",
          "surface.create",
          "surface.wrap",
          "diagram.insert",
          "diagram.arrange",
        ].includes(operation.type),
    );
  if (isSurface(draft) && structural) draft = reconcileSurface(draft);
  const index = indexSurfaceTree(draft.content);
  const arrows = [...transformedIds]
    .map((id) => index.get(id)?.node)
    .filter(
      (node) =>
        node?.type === "drawing" &&
        node.attrs?.tool === "arrow" &&
        node.attrs.bindings,
    );
  if (arrows.length) {
    // Reject invalid caller data before intentionally detaching valid relationships.
    validateDocument(draft);
    for (const node of arrows) {
      const bindings = transformedBindings(
        node!.attrs!.bindings,
        transformedIds,
      );
      if (Object.keys(bindings).length) node!.attrs!.bindings = bindings;
      else delete node!.attrs!.bindings;
    }
  }
  return normalizeDocument(draft, document);
}
