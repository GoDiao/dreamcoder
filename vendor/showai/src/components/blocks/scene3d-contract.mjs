// Contract for the scene-3d built-in: a declarative Three.js scene whose
// transforms can be bound to reader parameters. Validation runs in the
// workbench, the CLI and the portable reader, so it stays dependency-free.

export const SCENE3D_SHAPES = [
  "group",
  "box",
  "sphere",
  "cylinder",
  "cone",
  "torus",
  "plane",
  "arrow",
  "line",
  "label",
];
export const SCENE3D_PROPERTIES = [
  "position.x",
  "position.y",
  "position.z",
  "rotation.x",
  "rotation.y",
  "rotation.z",
  "scale",
  "scale.x",
  "scale.y",
  "scale.z",
];
export const SCENE3D_ROTATION_ORDERS = [
  "XYZ",
  "XZY",
  "YXZ",
  "YZX",
  "ZXY",
  "ZYX",
];
export const SCENE3D_LIMITS = {
  objects: 300,
  depth: 8,
  parameters: 8,
  points: 500,
  coordinate: 10000,
};

const fail = (message) => {
  throw new Error(message);
};
const isObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
function text(value, label) {
  if (typeof value !== "string" || !value.trim())
    fail(`${label} must be non-empty text.`);
}
function optionalText(value, label) {
  if (value !== undefined) text(value, label);
}
function finite(value, label, minimum = -Infinity, maximum = Infinity) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  )
    fail(
      `${label} must be a finite number${
        Number.isFinite(minimum) || Number.isFinite(maximum)
          ? ` from ${minimum} to ${maximum}`
          : ""
      }.`,
    );
}
function positive(value, label) {
  if (value !== undefined)
    finite(value, label, Number.MIN_VALUE, SCENE3D_LIMITS.coordinate);
}
function boolean(value, label) {
  if (value !== undefined && typeof value !== "boolean")
    fail(`${label} must be true or false.`);
}
function color(value, label) {
  if (value !== undefined && !/^#[0-9a-fA-F]{6}$/.test(value))
    fail(`${label} must be a six-digit hex color.`);
}
function vector(value, label, length = 3, required = false) {
  if (value === undefined && !required) return;
  if (!Array.isArray(value) || value.length !== length)
    fail(`${label} must be an array of ${length} numbers.`);
  value.forEach((item, index) =>
    finite(
      item,
      `${label}[${index}]`,
      -SCENE3D_LIMITS.coordinate,
      SCENE3D_LIMITS.coordinate,
    ),
  );
}

function validateCamera(camera) {
  if (camera === undefined) return;
  if (!isObject(camera)) fail("camera must be an object.");
  vector(camera.position, "camera.position");
  vector(camera.target, "camera.target");
  if (camera.fov !== undefined) finite(camera.fov, "camera.fov", 10, 120);
  boolean(camera.autoRotate, "camera.autoRotate");
  if (
    camera.position &&
    camera.target &&
    camera.position.every((value, index) => value === camera.target[index])
  )
    fail("camera.position must differ from camera.target.");
}

function validateParameters(parameters) {
  if (parameters === undefined) return new Set();
  if (
    !Array.isArray(parameters) ||
    parameters.length > SCENE3D_LIMITS.parameters
  )
    fail(
      `parameters must be an array of at most ${SCENE3D_LIMITS.parameters} items.`,
    );
  const seen = new Set();
  for (const parameter of parameters) {
    if (!isObject(parameter)) fail("parameters contains an invalid item.");
    text(parameter.id, "parameter.id");
    if (seen.has(parameter.id))
      fail(`parameters contains duplicate id ${parameter.id}.`);
    seen.add(parameter.id);
    text(parameter.label, `parameter ${parameter.id} label`);
    finite(parameter.min, `parameter ${parameter.id} min`);
    finite(parameter.max, `parameter ${parameter.id} max`);
    if (parameter.min >= parameter.max)
      fail(`parameter ${parameter.id} min must be less than max.`);
    finite(
      parameter.value,
      `parameter ${parameter.id} value`,
      parameter.min,
      parameter.max,
    );
    if (parameter.step !== undefined)
      finite(
        parameter.step,
        `parameter ${parameter.id} step`,
        Number.MIN_VALUE,
        parameter.max - parameter.min,
      );
    if (parameter.unit !== undefined && typeof parameter.unit !== "string")
      fail(`parameter ${parameter.id} unit must be text.`);
    optionalText(
      parameter.description,
      `parameter ${parameter.id} description`,
    );
    boolean(parameter.demo, `parameter ${parameter.id} demo`);
  }
  return seen;
}

function validateObject(object, path, depth, state) {
  if (!isObject(object)) fail(`${path} must be an object.`);
  if (depth > SCENE3D_LIMITS.depth)
    fail(`objects are nested deeper than ${SCENE3D_LIMITS.depth} levels.`);
  if (++state.count > SCENE3D_LIMITS.objects)
    fail(`A scene can contain at most ${SCENE3D_LIMITS.objects} objects.`);
  if (!SCENE3D_SHAPES.includes(object.type))
    fail(`${path}.type must be one of ${SCENE3D_SHAPES.join(", ")}.`);
  if (object.id !== undefined) {
    text(object.id, `${path}.id`);
    if (state.ids.has(object.id))
      fail(`objects contains duplicate id ${object.id}.`);
    state.ids.add(object.id);
  }
  optionalText(object.label, `${path}.label`);
  vector(object.labelOffset, `${path}.labelOffset`);
  vector(object.position, `${path}.position`);
  vector(object.rotation, `${path}.rotation`);
  if (
    object.rotationOrder !== undefined &&
    !SCENE3D_ROTATION_ORDERS.includes(object.rotationOrder)
  )
    fail(
      `${path}.rotationOrder must be one of ${SCENE3D_ROTATION_ORDERS.join(", ")}.`,
    );
  if (typeof object.scale === "number") positive(object.scale, `${path}.scale`);
  else {
    vector(object.scale, `${path}.scale`);
    object.scale?.forEach((value, index) =>
      positive(value, `${path}.scale[${index}]`),
    );
  }
  color(object.color, `${path}.color`);
  if (object.opacity !== undefined)
    finite(object.opacity, `${path}.opacity`, 0, 1);
  boolean(object.wireframe, `${path}.wireframe`);

  switch (object.type) {
    case "box":
      vector(object.size, `${path}.size`);
      object.size?.forEach((value, index) =>
        positive(value, `${path}.size[${index}]`),
      );
      break;
    case "plane":
      vector(object.size, `${path}.size`, 2);
      object.size?.forEach((value, index) =>
        positive(value, `${path}.size[${index}]`),
      );
      break;
    case "sphere":
      positive(object.radius, `${path}.radius`);
      break;
    case "cylinder":
      if (object.radiusTop !== undefined)
        finite(
          object.radiusTop,
          `${path}.radiusTop`,
          0,
          SCENE3D_LIMITS.coordinate,
        );
      if (object.radiusBottom !== undefined)
        finite(
          object.radiusBottom,
          `${path}.radiusBottom`,
          0,
          SCENE3D_LIMITS.coordinate,
        );
      positive(object.radius, `${path}.radius`);
      positive(object.height, `${path}.height`);
      break;
    case "cone":
      positive(object.radius, `${path}.radius`);
      positive(object.height, `${path}.height`);
      break;
    case "torus":
      positive(object.radius, `${path}.radius`);
      positive(object.tube, `${path}.tube`);
      break;
    case "arrow":
      vector(object.from, `${path}.from`);
      vector(object.to, `${path}.to`, 3, true);
      if (
        (object.from ?? [0, 0, 0]).every(
          (value, index) => value === object.to[index],
        )
      )
        fail(`${path} must have different from and to points.`);
      break;
    case "line":
      if (
        !Array.isArray(object.points) ||
        object.points.length < 2 ||
        object.points.length > SCENE3D_LIMITS.points
      )
        fail(
          `${path}.points must contain 2 to ${SCENE3D_LIMITS.points} points.`,
        );
      object.points.forEach((point, index) =>
        vector(point, `${path}.points[${index}]`, 3, true),
      );
      boolean(object.closed, `${path}.closed`);
      break;
    case "label":
      text(object.text ?? object.label, `${path}.text`);
      optionalText(object.text, `${path}.text`);
      break;
  }

  if (object.bindings !== undefined) {
    if (!Array.isArray(object.bindings) || object.bindings.length > 10)
      fail(`${path}.bindings must be an array of at most 10 items.`);
    for (const binding of object.bindings) {
      if (!isObject(binding))
        fail(`${path}.bindings contains an invalid item.`);
      text(binding.parameter, `${path}.bindings.parameter`);
      if (!state.parameters.has(binding.parameter))
        fail(
          `${path}.bindings references unknown parameter ${binding.parameter}.`,
        );
      if (!SCENE3D_PROPERTIES.includes(binding.property))
        fail(
          `${path}.bindings.property must be one of ${SCENE3D_PROPERTIES.join(", ")}.`,
        );
      if (binding.factor !== undefined)
        finite(binding.factor, `${path}.bindings.factor`);
    }
  }
  if (object.children !== undefined) {
    if (object.type !== "group") fail(`${path}.children requires type group.`);
    if (!Array.isArray(object.children))
      fail(`${path}.children must be an array.`);
    object.children.forEach((child, index) =>
      validateObject(child, `${path}.children[${index}]`, depth + 1, state),
    );
  }
}

/** Validates scene-3d data and returns it unchanged. */
export function validateScene3dData(data) {
  if (!isObject(data)) fail("scene-3d data must be an object.");
  optionalText(data.title, "title");
  optionalText(data.description, "description");
  if (data.height !== undefined) finite(data.height, "height", 200, 900);
  color(data.background, "background");
  boolean(data.grid, "grid");
  boolean(data.axes, "axes");
  validateCamera(data.camera);
  const parameters = validateParameters(data.parameters);
  if (!Array.isArray(data.objects) || data.objects.length < 1)
    fail("objects must be a non-empty array.");
  const state = { count: 0, ids: new Set(), parameters };
  data.objects.forEach((object, index) =>
    validateObject(object, `objects[${index}]`, 1, state),
  );
  return data;
}

/** Current value of a bound property: the static base plus factor × parameter. */
export function boundValue(base, binding, values) {
  const value = values[binding.parameter];
  return base + (binding.factor ?? 1) * (Number.isFinite(value) ? value : 0);
}

/** Every label shown in the scene, in document order, for static and assistive reading. */
export function sceneLabels(data) {
  const labels = [];
  const visit = (object) => {
    const label =
      object.type === "label" ? (object.text ?? object.label) : object.label;
    if (label) labels.push(label);
    object.children?.forEach(visit);
  };
  data.objects?.forEach(visit);
  return labels;
}
