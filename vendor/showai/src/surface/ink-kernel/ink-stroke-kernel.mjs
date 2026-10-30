import { CompiledInkKernel } from "./compiled-ink.mjs";
const names = ["M", "L", "Q", "C", "Z"],
  arity = [2, 2, 4, 6, 0];
const fields = [
  "commands",
  "contours",
  "envelopeCurves",
  "fallbackLeaves",
  "sampledChecks",
  "leaves",
  "maximumDepth",
  "fallbackContours",
];
export class CompiledInkStroke {
  constructor() {
    this.kernel = new CompiledInkKernel();
    this.api = this.kernel.api;
    if (
      this.api.sa_stroke_geometry_version() !== 1 ||
      this.api.sa_stroke_sizeof_segment() !== 88 ||
      this.api.sa_stroke_sizeof_options() !== 24 ||
      this.api.sa_stroke_sizeof_result() !== 56 ||
      this.api.sa_stroke_sizeof_style() !== 24 ||
      this.api.sa_stroke_sizeof_path_measure() !== 40
    )
      throw new Error("Unsupported circular stroke ABI");
  }
  input(segments, options, style) {
    if (
      !Array.isArray(segments) ||
      segments.length > 100000 ||
      Object.keys(options).some(
        (key) =>
          ![
            "tolerance",
            "geometryVersion",
            "maxDepth",
            "maxLeaves",
            "maxCommands",
          ].includes(key),
      )
    )
      throw new Error("Invalid circular stroke input/options");
    const k = this.kernel;
    k.reset();
    const input = k.allocate(segments.length * 88),
      configuration = k.allocate(24),
      view = new DataView(this.api.memory.buffer);
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i],
        at = input + i * 88;
      if (
        !segment ||
        Object.keys(segment).some(
          (key) => !["points", "radius"].includes(key),
        ) ||
        !Array.isArray(segment.points) ||
        segment.points.length < 1 ||
        segment.points.length > 4 ||
        !Array.isArray(segment.radius) ||
        segment.radius.length !== 2
      )
        throw new Error("Invalid circular stroke element");
      for (let j = 0; j < 8; j++) {
        const used = Math.floor(j / 2) < segment.points.length,
          point = segment.points[Math.floor(j / 2)];
        const v = used ? point?.[j % 2] : 0;
        if (
          (used && (!Array.isArray(point) || point.length !== 2)) ||
          typeof v !== "number" ||
          !Number.isFinite(v)
        )
          throw new Error("Invalid circular stroke control");
        view.setFloat64(at + j * 8, v, true);
      }
      for (let j = 0; j < 2; j++) {
        const v = segment.radius[j];
        if (typeof v !== "number" || !Number.isFinite(v))
          throw new Error("Invalid circular stroke radius");
        view.setFloat64(at + 64 + j * 8, v, true);
      }
      view.setUint32(at + 80, segment.points.length - 1, true);
      view.setUint32(at + 84, 0, true);
    }
    const tolerance = options.tolerance ?? 0.02,
      integers = [
        options.geometryVersion ?? 1,
        options.maxDepth ?? 20,
        options.maxLeaves ?? 100000,
        options.maxCommands ?? 1000000,
      ];
    if (
      typeof tolerance !== "number" ||
      !Number.isFinite(tolerance) ||
      integers.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffffffff)
    )
      throw new Error("Invalid circular stroke budget");
    view.setFloat64(configuration, tolerance, true);
    integers.forEach((n, i) =>
      view.setUint32(configuration + 8 + i * 4, n, true),
    );
    if (style !== undefined) {
      if (
        !style ||
        Object.keys(style).some(
          (key) => !["sourceWidth", "width", "pressure"].includes(key),
        ) ||
        typeof style.pressure !== "boolean"
      )
        throw new Error("Invalid circular stroke style");
      const at = k.allocate(24),
        resolved = k.allocate(segments.length * 88),
        v = new DataView(this.api.memory.buffer);
      if (
        ![style.sourceWidth, style.width].every(
          (x) => typeof x === "number" && Number.isFinite(x),
        )
      )
        throw new Error("Invalid circular stroke width");
      v.setFloat64(at, style.sourceWidth, true);
      v.setFloat64(at + 8, style.width, true);
      v.setUint32(at + 16, style.pressure ? 1 : 0, true);
      v.setUint32(at + 20, 0, true);
      k.check(
        this.api.sa_stroke_resolve_segments(
          input,
          segments.length,
          at,
          resolved,
          segments.length,
        ),
      );
      return { input: resolved, configuration };
    }
    return { input, configuration };
  }
  result(at) {
    const view = new DataView(this.api.memory.buffer),
      result = Object.fromEntries(
        fields.map((name, i) => [name, view.getUint32(at + i * 4, true)]),
      );
    return {
      ...result,
      sampledEnvelopeError: view.getFloat64(at + 32, true),
      fallbackCenterBound: view.getFloat64(at + 40, true),
      arcErrorBound: view.getFloat64(at + 48, true),
    };
  }
  counts(segments, options = {}, style) {
    const { input, configuration } = this.input(segments, options, style),
      at = this.kernel.allocate(56);
    this.kernel.check(
      this.api.sa_stroke_path_counts(input, segments.length, configuration, at),
    );
    return this.result(at);
  }
  build(segments, options = {}, style) {
    const { input, configuration } = this.input(segments, options, style),
      at = this.kernel.allocate(56);
    this.kernel.check(
      this.api.sa_stroke_path_counts(input, segments.length, configuration, at),
    );
    const count = this.result(at).commands,
      output = this.kernel.allocate(count * 56);
    this.kernel.check(
      this.api.sa_stroke_path_build(
        input,
        segments.length,
        configuration,
        output,
        count,
        at,
      ),
    );
    const view = new DataView(this.api.memory.buffer),
      commands = Array.from({ length: count }, (_, i) => {
        const p = output + i * 56,
          op = view.getUint32(p, true);
        return [
          names[op],
          ...Array.from({ length: arity[op] }, (_, j) =>
            view.getFloat64(p + 8 + j * 8, true),
          ),
        ];
      });
    return { commands, result: this.result(at) };
  }
  resolve(segments, style) {
    const { input } = this.input(segments, {}, style),
      view = new DataView(this.api.memory.buffer);
    return Array.from({ length: segments.length }, (_, i) => {
      const at = input + i * 88,
        degree = view.getUint32(at + 80, true);
      return {
        points: Array.from({ length: degree + 1 }, (_, k) => [
          view.getFloat64(at + k * 16, true),
          view.getFloat64(at + k * 16 + 8, true),
        ]),
        radius: [
          view.getFloat64(at + 64, true),
          view.getFloat64(at + 72, true),
        ],
      };
    });
  }
  pathInput(commands, affine) {
    if (
      !Array.isArray(commands) ||
      commands.length > 4000000 ||
      !Array.isArray(affine) ||
      affine.length !== 6 ||
      Array.from({ length: 6 }, (_, i) => affine[i]).some(
        (x) => typeof x !== "number" || !Number.isFinite(x),
      )
    )
      throw new Error("Invalid stroke query path/affine");
    const k = this.kernel;
    k.reset();
    const input = k.allocate(commands.length * 56),
      matrix = k.allocate(48),
      view = new DataView(this.api.memory.buffer);
    for (let i = 0; i < commands.length; i++) {
      const command = commands[i],
        op = names.indexOf(command?.[0]);
      if (op < 0 || !Array.isArray(command) || command.length !== arity[op] + 1)
        throw new Error("Invalid stroke query command");
      const p = input + i * 56;
      view.setUint32(p, op, true);
      view.setUint32(p + 4, 0, true);
      for (let j = 0; j < 6; j++) {
        const v = j < arity[op] ? command[j + 1] : 0;
        if (typeof v !== "number" || !Number.isFinite(v))
          throw new Error("Invalid stroke query scalar");
        view.setFloat64(p + 8 + j * 8, v, true);
      }
    }
    affine.forEach((v, i) => view.setFloat64(matrix + i * 8, v, true));
    return { input, matrix };
  }
  queryBudget(tolerance, maxPoints) {
    if (
      typeof tolerance !== "number" ||
      !Number.isFinite(tolerance) ||
      tolerance <= 0 ||
      !Number.isInteger(maxPoints) ||
      maxPoints < 1 ||
      maxPoints > 0xffffffff
    )
      throw new Error("Invalid stroke query budget");
  }
  pathGeometry(
    commands,
    affine = [1, 0, 0, 1, 0, 0],
    tolerance = 0.000625,
    maxPoints = 1000000,
  ) {
    this.queryBudget(tolerance, maxPoints);
    const { input, matrix } = this.pathInput(commands, affine),
      at = this.kernel.allocate(40);
    this.kernel.check(
      this.api.sa_stroke_path_measure(
        input,
        commands.length,
        matrix,
        tolerance,
        maxPoints,
        at,
      ),
    );
    let view = new DataView(this.api.memory.buffer);
    const np = view.getUint32(at, true),
      nc = view.getUint32(at + 4, true),
      p = this.kernel.allocate(np * 16),
      c = this.kernel.allocate(nc * 8);
    this.kernel.check(
      this.api.sa_stroke_path_flatten(
        input,
        commands.length,
        matrix,
        tolerance,
        maxPoints,
        p,
        np,
        c,
        nc,
        at,
      ),
    );
    view = new DataView(this.api.memory.buffer);
    const bounds = Object.fromEntries(
        ["x", "y", "width", "height"].map((name, i) => [
          name,
          view.getFloat64(at + 8 + i * 8, true),
        ]),
      ),
      polygons = Array.from({ length: nc }, (_, i) => {
        const first = view.getUint32(c + i * 8, true),
          count = view.getUint32(c + i * 8 + 4, true);
        return Array.from({ length: count }, (_, j) => ({
          x: view.getFloat64(p + (first + j) * 16, true),
          y: view.getFloat64(p + (first + j) * 16 + 8, true),
        }));
      });
    return { bounds, polygons };
  }
  pathHit(
    commands,
    point,
    affine = [1, 0, 0, 1, 0, 0],
    tolerance = 0.000625,
    maxPoints = 1000000,
  ) {
    this.queryBudget(tolerance, maxPoints);
    const { input, matrix } = this.pathInput(commands, affine),
      at = this.kernel.allocate(16);
    if (!point || typeof point.x !== "number" || typeof point.y !== "number")
      throw new Error("Invalid stroke query point");
    this.kernel.check(
      this.api.sa_stroke_path_query(
        input,
        commands.length,
        matrix,
        point.x,
        point.y,
        tolerance,
        maxPoints,
        at,
      ),
    );
    const v = new DataView(this.api.memory.buffer);
    return {
      inside: !!v.getUint32(at, true),
      distance: v.getFloat64(at + 8, true),
      solid: true,
    };
  }
  pathBounds(commands, affine = [1, 0, 0, 1, 0, 0]) {
    const { input, matrix } = this.pathInput(commands, affine),
      at = this.kernel.allocate(32);
    this.kernel.check(
      this.api.sa_stroke_path_bounds(input, commands.length, matrix, at),
    );
    const v = new DataView(this.api.memory.buffer);
    return Object.fromEntries(
      ["x", "y", "width", "height"].map((name, i) => [
        name,
        v.getFloat64(at + i * 8, true),
      ]),
    );
  }
}
