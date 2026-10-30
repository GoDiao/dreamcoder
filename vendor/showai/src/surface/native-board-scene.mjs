const findSurfaceNode = (document, id) => {
  const find = node => node.attrs?.id === id ? node : node.content?.map(find).find(Boolean);
  const node = find(document.content);
  return node ? {node} : undefined;
};

/** Transfer changed object payloads with a complete hierarchy. Nested surfaces
 * are independently editable objects; regions share their enclosing camera. */
export function nativeBoardScenePatch(document, boardId, previous) {
  const board = findSurfaceNode(document, boardId)?.node;
  if (!board || board.attrs?.kind !== "board") throw new Error("Native Board no longer exists");
  const oldBoard = previous && findSurfaceNode(previous, boardId)?.node;
  const old = new Map(), current = new Map();
  const collect = (node, into) => {
    for (const child of node?.content ?? []) {
      if (!child.attrs?.id) throw new Error("Native Board object is missing an identity");
      if (into.has(child.attrs.id)) throw new Error("Native Board object identity is duplicated");
      into.set(child.attrs.id, child);
      if (child.type === "region") collect(child, into);
    }
  };
  collect(oldBoard, old); collect(board, current);
  const reference = (node) => ({type:"native-board-ref", attrs:{id:node.attrs.id}});
  const payload = node => node?.type === "region" ? {...node, content:node.content?.map(reference) ?? []} : node;
  const nodes = [];
  for (const [id, node] of current) {
    const prior = old.get(id);
    if (prior === node || JSON.stringify(payload(prior)) === JSON.stringify(payload(node))) continue;
    nodes.push(payload(node));
  }
  const replace = node => node === board ? {...board, content:board.content?.map(reference) ?? []}
    : node.content ? {...node, content:node.content.map(replace)} : node;
  return {document:{...document,content:replace(document.content)},nodes};
}

/** Resolving references uses the last acknowledged source, never a queued or
 * optimistic frame. Missing baselines reject the whole frame atomically. */
export function resolveNativeBoardScene(patch, previous) {
  const retained = new Map();
  const visit = node => {
    if (node?.attrs?.id) retained.set(node.attrs.id, node.type === "region"
      ? {...node, content:node.content?.map(child=>({type:"native-board-ref",attrs:{id:child.attrs?.id}})) ?? []} : node);
    node?.content?.forEach(visit);
  };
  visit(previous?.content);
  const changed = new Set();
  for (const node of patch.nodes ?? []) {
    const id = node.attrs?.id;
    if (!id || changed.has(id)) throw new Error("Invalid native Board object delta");
    changed.add(id); retained.set(id,node);
  }
  const referenced = new Set(), active = new Set();
  const resolve = node => {
    if (node.type === "native-board-ref") {
      const id = node.attrs?.id;
      if (!id || !retained.has(id) || active.has(id) || referenced.has(id)) throw new Error("Native Board source baseline is incomplete");
      active.add(id); referenced.add(id);
      const result = resolve(retained.get(id)); active.delete(id); return result;
    }
    return node.content ? {...node,content:node.content.map(resolve)} : node;
  };
  const result = {...patch.document,content:resolve(patch.document.content)};
  if ([...changed].some(id => !referenced.has(id))) throw new Error("Unreferenced native Board object");
  return result;
}
