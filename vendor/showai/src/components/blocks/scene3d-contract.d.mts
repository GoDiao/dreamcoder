export type Scene3dVector = [number, number, number];
export type Scene3dShape =
  | "group"
  | "box"
  | "sphere"
  | "cylinder"
  | "cone"
  | "torus"
  | "plane"
  | "arrow"
  | "line"
  | "label";
export type Scene3dProperty =
  | "position.x"
  | "position.y"
  | "position.z"
  | "rotation.x"
  | "rotation.y"
  | "rotation.z"
  | "scale"
  | "scale.x"
  | "scale.y"
  | "scale.z";
export interface Scene3dBinding {
  parameter: string;
  property: Scene3dProperty;
  factor?: number;
}
export interface Scene3dObject {
  id?: string;
  type: Scene3dShape;
  label?: string;
  labelOffset?: Scene3dVector;
  position?: Scene3dVector;
  /** Degrees. */
  rotation?: Scene3dVector;
  rotationOrder?: "XYZ" | "XZY" | "YXZ" | "YZX" | "ZXY" | "ZYX";
  scale?: number | Scene3dVector;
  color?: string;
  opacity?: number;
  wireframe?: boolean;
  size?: number[];
  radius?: number;
  radiusTop?: number;
  radiusBottom?: number;
  height?: number;
  tube?: number;
  from?: Scene3dVector;
  to?: Scene3dVector;
  points?: Scene3dVector[];
  closed?: boolean;
  text?: string;
  bindings?: Scene3dBinding[];
  children?: Scene3dObject[];
}
export interface Scene3dParameter {
  id: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  unit?: string;
  description?: string;
  demo?: boolean;
}
export interface Scene3dData {
  title?: string;
  description?: string;
  height?: number;
  background?: string;
  grid?: boolean;
  axes?: boolean;
  camera?: {
    position?: Scene3dVector;
    target?: Scene3dVector;
    fov?: number;
    autoRotate?: boolean;
  };
  parameters?: Scene3dParameter[];
  objects: Scene3dObject[];
}
export declare const SCENE3D_SHAPES: readonly Scene3dShape[];
export declare const SCENE3D_PROPERTIES: readonly Scene3dProperty[];
export declare const SCENE3D_ROTATION_ORDERS: readonly string[];
export declare const SCENE3D_LIMITS: {
  objects: number;
  depth: number;
  parameters: number;
  points: number;
  coordinate: number;
};
export declare function validateScene3dData(data: unknown): Scene3dData;
export declare function boundValue(
  base: number,
  binding: Scene3dBinding,
  values: Record<string, number>,
): number;
export declare function sceneLabels(data: Scene3dData): string[];
