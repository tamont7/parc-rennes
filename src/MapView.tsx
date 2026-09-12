import { useEffect, useRef, useState } from "react";
import {
  BoundingSphere,
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  ComponentDatatype,
  CornerType,
  CylinderGeometry,
  DirectionalLight,
  EllipsoidGeometry,
  Geometry,
  GeometryAttribute,
  GeometryAttributes,
  GeometryInstance,
  HeadingPitchRange,
  HeadingPitchRoll,
  VerticalOrigin,
  Math as CesiumMath,
  Matrix3,
  Matrix4,
  PerInstanceColorAppearance,
  PolygonHierarchy,
  Primitive,
  PrimitiveCollection,
  PrimitiveType,
  Quaternion,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  ShowGeometryInstanceAttribute,
  Transforms,
  TranslationRotationScale,
  Viewer,
} from "cesium";

import {
  TREE_COLORS,
  treeHighlight,
  type Tree,
} from "./data";

import { PARK_PLAN_BOUNDS } from "./park";
import { MAX_LOCATION_AGE_MS, PRECISE_LOCATION_METRES, readLocation, type UserLocation } from "./geolocation";
import { buildPathNetwork, simplifyPath } from "./pathGeometry";
import entranceIcon from "./assets/park-entrance.svg";
import {
  isPointInPark,
  isParkLandmark,
  type ParkLandmark,
  type ParkPlan,
} from "./plan";

type MapViewProps = {
  trees: Tree[];
  plan: ParkPlan | null;
  parkId: string;
  isParkTransitioning: boolean;
  onSceneReady: () => void;
  visibleTrees: Tree[];
  interactiveTrees: Tree[];
  selectedTree: Tree | null;
  focusTreeId: string | null;
  focusRequest: number;
  viewMode: "2d" | "3d";
  onChangeViewMode: () => void;
  isMobile: boolean;
  isMobilePanelOpen: boolean;
  hoveredTreeId: string | null;
  onSelectTree: (tree: Tree) => void;
  onSelectLandmark: (landmark: ParkLandmark) => void;
  onRecenter: () => void;
  recenter: number;
};

type TreeShape =
  | "round"
  | "conical"
  | "columnar"
  | "spreading"
  | "compact";

type TreeProportions = {
  trunkHeight: number;
  trunkRadius: number;
  crownHeight: number;
  crownRadiusX: number;
  crownRadiusY: number;
};

type CrownPlacement = {
  centerZ: number;
  scaleZ: number;
  trunkOverlap: number;
};

type MapTooltip = {
  name: string;
  count?: number;
  height?: number | null;
  circumference?: number | null;
  crownDiameter?: number | null;
  x: number;
  y: number;
};

const MAX_LOCATION_DISTANCE_FROM_PARK_METRES = 250;

function isNearCurrentPark(location: UserLocation, plan: ParkPlan | null) {
  if (plan && isPointInPark(plan, [location.longitude, location.latitude])) return true;

  const [west, south, east, north] = plan?.bbox ?? PARK_PLAN_BOUNDS;
  const nearestLongitude = Math.min(east, Math.max(west, location.longitude));
  const nearestLatitude = Math.min(north, Math.max(south, location.latitude));
  const latitudeFactor = Math.cos(CesiumMath.toRadians(location.latitude));
  const eastWestDistance = (location.longitude - nearestLongitude) * 111_320 * latitudeFactor;
  const northSouthDistance = (location.latitude - nearestLatitude) * 111_320;

  return Math.hypot(eastWestDistance, northSouthDistance) <= MAX_LOCATION_DISTANCE_FROM_PARK_METRES;
}

const PLAN_HEIGHT = 0.25;

const TREE_TRUNK_COLOR =
  Color.fromCssColorString("#735039");

const TREE_SELECTED_COLOR =
  Color.fromCssColorString("#7c3aed");

const TREE_HOVER_COLOR =
  Color.fromCssColorString("#a855f7");

const ORGANIC_CROWN_MAX_LOBE_COUNT = 4;

/*
 * Texture de feuillage sans image : deux fréquences de bruit très douces
 * cassent l'aplat de couleur sans chercher à représenter chaque feuille.
 * Les coordonnées mondiales encodées et la couleur propre à chaque arbre
 * servent de graine ; le motif reste donc stable quand la caméra se déplace
 * et varie d'un houppier à l'autre.
 */
const CROWN_TEXTURE_VERTEX_SHADER = `
in vec3 position3DHigh;
in vec3 position3DLow;
in vec3 normal;
in vec4 color;
in float batchId;

out vec3 v_positionEC;
out vec3 v_normalEC;
out vec4 v_color;
out vec3 v_crownTexturePosition;

void main()
{
    vec4 p = czm_computePosition();

    v_positionEC = (czm_modelViewRelativeToEye * p).xyz;
    v_normalEC = czm_normal * normal;
    v_color = color;
    // La partie basse de la coordonnée ECEF ne dépend pas de la caméra.
    // p est relatif à l'œil et ferait glisser le bruit à chaque mouvement.
    v_crownTexturePosition = position3DLow;

    gl_Position = czm_modelViewProjectionRelativeToEye * p;
}
`;

const CROWN_TEXTURE_FRAGMENT_PREAMBLE = `
in vec3 v_positionEC;
in vec3 v_normalEC;
in vec4 v_color;
in vec3 v_crownTexturePosition;

float crownHash(vec3 point)
{
    return fract(sin(dot(point, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
}

float crownNoise(vec3 point)
{
    vec3 cell = floor(point);
    vec3 local = fract(point);
    local = local * local * (3.0 - 2.0 * local);

    float near = mix(
        mix(crownHash(cell), crownHash(cell + vec3(1.0, 0.0, 0.0)), local.x),
        mix(crownHash(cell + vec3(0.0, 1.0, 0.0)), crownHash(cell + vec3(1.0, 1.0, 0.0)), local.x),
        local.y
    );
    float far = mix(
        mix(crownHash(cell + vec3(0.0, 0.0, 1.0)), crownHash(cell + vec3(1.0, 0.0, 1.0)), local.x),
        mix(crownHash(cell + vec3(0.0, 1.0, 1.0)), crownHash(cell + vec3(1.0, 1.0, 1.0)), local.x),
        local.y
    );

    return mix(near, far, local.z);
}
`;

const CROWN_TEXTURE_FRAGMENT_EPILOGUE = `
    czm_materialInput materialInput;
    materialInput.normalEC = normalEC;
    materialInput.positionToEyeEC = positionToEyeEC;
    czm_material material = czm_getDefaultMaterial(materialInput);
    material.diffuse = clamp(color.rgb + vec3(textureShade), 0.0, 1.0);
    material.alpha = color.a;

    out_FragColor = czm_phong(normalize(positionToEyeEC), material, czm_lightDirectionEC);
}
`;

/* Feuillus : des plages souples, ponctuées d'un grain court et irrégulier. */
const CROWN_TEXTURE_FRAGMENT_SHADER = `${CROWN_TEXTURE_FRAGMENT_PREAMBLE}

void main()
{
    vec3 positionToEyeEC = -v_positionEC;
    vec3 normalEC = normalize(v_normalEC);
    normalEC = faceforward(normalEC, vec3(0.0, 0.0, 1.0), -normalEC);

    vec4 color = czm_gammaCorrect(v_color);
    vec3 seededPosition = v_crownTexturePosition + color.rgb * 19.0;
    float cloudMass = crownNoise(seededPosition * 0.92) - 0.5;
    float leafGrain = crownNoise(seededPosition * 6.4 + 8.0) - 0.5;
    float textureShade = cloudMass * 0.15 + leafGrain * 0.045;

${CROWN_TEXTURE_FRAGMENT_EPILOGUE}`;

/*
 * Conifères : les étages restent lisibles grâce à un grain plus dense et à
 * de fines stries obliques. Elles suggèrent les aiguilles sans devenir un
 * motif graphique à distance.
 */
const CONIFER_TEXTURE_FRAGMENT_SHADER = `${CROWN_TEXTURE_FRAGMENT_PREAMBLE}

float needleTuft(vec2 coordinate)
{
    vec2 tile = fract(coordinate);
    tile.x = fract(tile.x + floor(coordinate.y) * 0.5);
    tile -= 0.5;

    float tipFade = 1.0 - smoothstep(0.14, 0.48, abs(tile.y));
    float centre = abs(tile.x);
    float leftNeedle = abs(tile.x + tile.y * 0.38 + 0.09);
    float rightNeedle = abs(tile.x - tile.y * 0.38 - 0.09);
    float lineWidth = 0.026;
    float feather = max(fwidth(centre), 0.008) * 1.6;
    float tuft = 1.0 - smoothstep(lineWidth, lineWidth + feather, centre);
    tuft = max(tuft, 1.0 - smoothstep(lineWidth, lineWidth + feather, leftNeedle));
    tuft = max(tuft, 1.0 - smoothstep(lineWidth, lineWidth + feather, rightNeedle));

    return tuft * tipFade;
}

void main()
{
    vec3 positionToEyeEC = -v_positionEC;
    vec3 normalEC = normalize(v_normalEC);
    normalEC = faceforward(normalEC, vec3(0.0, 0.0, 1.0), -normalEC);

    vec4 color = czm_gammaCorrect(v_color);
    vec3 seededPosition = v_crownTexturePosition + color.rgb * 23.0;
    float needleGrain = crownNoise(seededPosition * 9.5) - 0.5;
    float branchMass = crownNoise(seededPosition * 2.2 + 13.0) - 0.5;
    vec2 tuftCoordinate = vec2(
        dot(seededPosition, vec3(3.8, -2.3, 1.7)),
        dot(seededPosition, vec3(1.4, 4.6, -3.1))
    );
    float tuft = needleTuft(tuftCoordinate);
    float textureShade = branchMass * 0.09 + needleGrain * 0.045 + (tuft - 0.22) * 0.075;

${CROWN_TEXTURE_FRAGMENT_EPILOGUE}`;

function makeTreeTooltip(tree: Tree, count: number, x: number, y: number): MapTooltip {
  return {
    name: tree.name,
    count,
    height: tree.height,
    circumference: tree.circumference,
    crownDiameter: tree.crownDiameter,
    x,
    y,
  };
}

function isInsideMapCanvas(viewer: Viewer, position: { x: number; y: number }) {
  const scene = viewer.scene;
  const { clientWidth, clientHeight } = scene.canvas;
  if (!(position.x >= 0 && position.y >= 0 && position.x < clientWidth && position.y < clientHeight)) {
    return false;
  }

  // Cesium lit un carré de 3 × 3 pixels, avec une origine Y en bas.
  // Vérifier toute la zone en pixels du tampon (zoom et densité compris).
  const pixelX = position.x * scene.drawingBufferWidth / clientWidth;
  const pixelY = position.y * scene.drawingBufferHeight / clientHeight;
  const left = pixelX - 1;
  const bottom = scene.drawingBufferHeight - pixelY - 1;
  return left >= 0 && bottom >= 0 &&
    left + 3 <= scene.drawingBufferWidth && bottom + 3 <= scene.drawingBufferHeight;
}

function positions(
  coordinates: readonly (readonly number[])[],
  height = PLAN_HEIGHT,
) {
  return coordinates.map(
    ([longitude, latitude]) =>
      Cartesian3.fromDegrees(
        longitude,
        latitude,
        height,
      ),
  );
}

function getParkViewRange(
  viewer: Viewer,
  bounds: readonly number[],
) {
  const [west, south, east, north] = bounds;
  const latitude = (south + north) / 2;
  const widthMetres = (east - west) * 111_320 * Math.cos(CesiumMath.toRadians(latitude)) + 80;
  const heightMetres = (north - south) * 111_320 + 80;
  const aspectRatio = Math.max(0.35, viewer.scene.canvas.clientWidth / Math.max(1, viewer.scene.canvas.clientHeight));
  const frustum = viewer.camera.frustum as { fov?: number };
  const verticalFov = frustum.fov ?? CesiumMath.toRadians(60);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspectRatio);
  return Math.max(
    260,
    widthMetres / (2 * Math.tan(horizontalFov / 2)),
    heightMetres / (2 * Math.tan(verticalFov / 2)),
  ) * 1.16;
}

function setParkView(
  viewer: Viewer,
  bounds: readonly number[],
  viewMode: "2d" | "3d" = "3d",
  mobileParkFraming: "oberthur" | "thabor" | null = null,
) {
  const [west, south, east, north] = bounds;
  /*
   * Sur mobile, les contrôles occupent le côté droit. On vise donc un point
   * légèrement à l'est du centre : le parc apparaît un peu à gauche, tout en
   * gardant l'ensemble de l'emprise lisible avec un cadrage plus rapproché.
   */
  const isMobileParkFraming = mobileParkFraming !== null;
  const zoomFactor = mobileParkFraming === "oberthur" ? 0.72 : 1;
  const horizontalShift = mobileParkFraming === "oberthur" ? 0.12 : mobileParkFraming === "thabor" ? 0.05 : 0;
  const verticalShift = mobileParkFraming === "oberthur" ? 0.08 : mobileParkFraming === "thabor" ? 0.03 : 0;
  const longitude = (west + east) / 2 + (isMobileParkFraming ? (east - west) * horizontalShift : 0);
  const latitude = (south + north) / 2 - (isMobileParkFraming ? (north - south) * verticalShift : 0);
  const centre = Cartesian3.fromDegrees(longitude, latitude);
  const range = getParkViewRange(viewer, bounds) * zoomFactor;

  viewer.camera.lookAt(
    centre,
    new HeadingPitchRange(
      CesiumMath.toRadians(0),
      CesiumMath.toRadians(viewMode === "2d" ? -87 : -70),
      range,
    ),
  );

  viewer.camera.lookAtTransform(
    Matrix4.IDENTITY,
  );
}

function smoothZoomTo(
  viewer: Viewer,
  target: Cartesian3,
  distanceFactor: number,
) {
  const camera = viewer.camera;
  const currentDistance = Cartesian3.distance(
    camera.positionWC,
    target,
  );

  if (currentDistance <= 0) return;

  const nextDistance = Math.max(
    12,
    currentDistance * distanceFactor,
  );

  camera.cancelFlight();
  camera.flyTo({
    destination: Cartesian3.lerp(
      target,
      camera.positionWC,
      nextDistance / currentDistance,
      new Cartesian3(),
    ),
    orientation: {
      heading: camera.heading,
      pitch: camera.pitch,
      roll: camera.roll,
    },
    duration: 0.25,
  });
}

function getTreeHeight(tree: Tree) {
  if (
    tree.height !== null &&
    Number.isFinite(tree.height) &&
    tree.height >= 2 &&
    tree.height <= 60
  ) {
    return tree.height;
  }

  return 10;
}

function getTreeTrunkRadius(tree: Tree) {
  if (
    tree.circumference !== null &&
    Number.isFinite(tree.circumference) &&
    tree.circumference > 0
  ) {
    const radius =
      tree.circumference /
      100 /
      (2 * Math.PI);

    return Math.max(
      0.06,
      Math.min(1.2, radius),
    );
  }

  return 0.18;
}

function getTreeCrownDiameter(tree: Tree) {
  const value = tree.crownDiameter;

  if (
    value !== null &&
    value !== undefined &&
    Number.isFinite(value) &&
    value > 0
  ) {
    return value;
  }

  /*
   * Fallback uniquement quand Rennes
   * ne fournit pas de houppier.
   */
  return getTreeHeight(tree) * 0.3;
}

function getTreeFirstLeafHeight(tree: Tree) {
  const height =
    getTreeHeight(tree);

  const value = tree.firstLeafHeight;

  if (
    value !== null &&
    value !== undefined &&
    Number.isFinite(value) &&
    value >= 0 &&
    value < height
  ) {
    return value;
  }

  /*
   * Fallback uniquement quand Rennes
   * ne fournit pas cette mesure.
   */
  return height * 0.3;
}

function normalizeTreeText(tree: Tree) {
  return [
    tree.name,
    tree.scientificName,
    tree.species,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("fr");
}

function getTreeShape(
  tree: Tree,
): TreeShape {
  const text =
    normalizeTreeText(tree);

  if (
    text.includes("cedrus") ||
    text.includes("cèdre") ||
    text.includes("cedre") ||
    text.includes("abies") ||
    text.includes("sapin") ||
    text.includes("picea") ||
    text.includes("épicéa") ||
    text.includes("epicea") ||
    text.includes("cryptomeria") ||
    text.includes("sequoia") ||
    text.includes("séquoia") ||
    text.includes("thuja")
  ) {
    return "conical";
  }

  if (
    text.includes("populus") ||
    text.includes("peuplier") ||
    text.includes("betula") ||
    text.includes("bouleau") ||
    text.includes("cupressus") ||
    text.includes("cyprès") ||
    text.includes("cypres")
  ) {
    return "columnar";
  }

  if (
    text.includes("quercus") ||
    text.includes("chêne") ||
    text.includes("chene") ||
    text.includes("fagus") ||
    text.includes("hêtre") ||
    text.includes("hetre") ||
    text.includes("platanus") ||
    text.includes("platane") ||
    text.includes("castanea") ||
    text.includes("châtaignier") ||
    text.includes("chataignier")
  ) {
    return "spreading";
  }

  if (
    text.includes("malus") ||
    text.includes("pommier") ||
    text.includes("prunus") ||
    text.includes("cerisier") ||
    text.includes("magnolia") ||
    text.includes("amelanchier")
  ) {
    return "compact";
  }

  return "round";
}

function hashTree(tree: Tree) {
  let hash = 2166136261;

  for (
    let i = 0;
    i < tree.id.length;
    i += 1
  ) {
    hash ^= tree.id.charCodeAt(i);

    hash = Math.imul(
      hash,
      16777619,
    );
  }

  return hash >>> 0;
}

function treeRandom(
  tree: Tree,
  salt: number,
) {
  let value =
    hashTree(tree) ^
    Math.imul(salt + 1, 0x9e3779b1);

  value ^= value >>> 16;
  value = Math.imul(value, 0x85ebca6b);
  value ^= value >>> 13;

  return (value >>> 0) / 0x1_0000_0000;
}

function treeRotation(tree: Tree) {
  return CesiumMath.toRadians(
    hashTree(tree) % 360,
  );
}

function getTreeBrightness(tree: Tree) {
  const values = [
    0.9,
    0.94,
    0.97,
    1,
    1.03,
    1.06,
    1.1,
  ];

  return values[
    hashTree(tree) %
    values.length
  ];
}

function getTreeHueVariation(tree: Tree) {
  return (
    ((hashTree(tree) >> 4) % 5) -
    2
  );
}

function varyColor(
  tree: Tree,
  cssColor: string,
) {
  const base =
    Color.fromCssColorString(
      cssColor,
    );

  const brightness =
    getTreeBrightness(tree);

  const hue =
    getTreeHueVariation(tree);

  /*
   * Variation de teinte très légère :
   * la luminosité reste l'élément
   * principal de différenciation.
   */
  const hueAmount =
    hue * 0.012;

  const red =
    base.red * brightness +
    hueAmount;

  const green =
    base.green * brightness +
    Math.abs(hueAmount) * 0.25;

  const blue =
    base.blue * brightness -
    hueAmount;

  return new Color(
    Math.max(
      0,
      Math.min(1, red),
    ),
    Math.max(
      0,
      Math.min(1, green),
    ),
    Math.max(
      0,
      Math.min(1, blue),
    ),
    1,
  );
}

function getBaseCrownColor(tree: Tree) {
  return varyColor(
    tree,
    TREE_COLORS.normal,
  );
}

function getCrownLayerColor(
  tree: Tree,
  shade: number,
) {
  const base =
    getBaseCrownColor(tree);

  return Color.lerp(
    base,
    shade < 0
      ? Color.BLACK
      : Color.WHITE,
    Math.abs(shade),
    new Color(),
  );
}

function getRelatedCrownColor(
  tree: Tree,
) {
  return Color.lerp(
    getBaseCrownColor(tree),
    TREE_HOVER_COLOR,
    0.72,
    new Color(),
  );
}

function getTreeProportions(
  tree: Tree,
): TreeProportions {
  const height =
    getTreeHeight(tree);

  const trunkRadius =
    getTreeTrunkRadius(tree);

  const crownDiameter =
    getTreeCrownDiameter(tree);

  const firstLeafHeight =
    getTreeFirstLeafHeight(tree);

  const crownHeight =
    Math.max(
      1,
      height - firstLeafHeight,
    );

  const crownRadius =
    crownDiameter / 2;

  /*
   * Petite asymétrie déterministe.
   * Elle ne modifie presque pas
   * l'enveloppe du houppier mais aide
   * à distinguer deux arbres qui se
   * chevauchent.
   */
  const variation =
    0.97 +
    (hashTree(tree) % 7) /
    100;

  let radiusX =
    crownRadius * variation;

  let radiusY =
    crownRadius *
    (2 - variation);

  /*
   * On reste volontairement subtil :
   * les dimensions Rennes doivent
   * rester prioritaires.
   */
  if (
    getTreeShape(tree) ===
    "columnar"
  ) {
    radiusX *= 0.96;
    radiusY *= 0.96;
  }

  if (
    getTreeShape(tree) ===
    "spreading"
  ) {
    radiusX *= 1.01;
    radiusY *= 1.01;
  }

  return {
    trunkHeight:
      firstLeafHeight,

    trunkRadius,

    crownHeight,

    crownRadiusX:
      radiusX,

    crownRadiusY:
      radiusY,
  };
}

/*
 * Le tronc doit entrer dans le houppier : un simple contact ponctuel
 * au bas d'un ellipsoïde le fait paraître suspendu. Pour les feuillus,
 * la base du volume descend aussi un peu autour de la ramification ; le
 * sommet reste à la hauteur mesurée afin de ne pas déformer l'arbre.
 */
function getCrownPlacement(
  trunkHeight: number,
  crownHeight: number,
  shape: TreeShape,
): CrownPlacement {
  const hasLowerCrown =
    hasOrganicCrownLobes(shape);
  const lowerCrownDepth =
    hasLowerCrown
      ? Math.min(
        1.1,
        Math.max(
          0.3,
          crownHeight * 0.13,
        ),
      )
      : 0;
  const overlap = Math.min(
    1.2,
    Math.max(
      0.25,
      crownHeight * 0.1 + lowerCrownDepth,
    ),
  );

  return {
    centerZ:
      trunkHeight +
      (crownHeight - lowerCrownDepth) / 2,
    scaleZ:
      shape === "conical"
        ? crownHeight
        : (crownHeight + lowerCrownDepth) / 2,
    trunkOverlap: overlap,
  };
}

function makeTreeMatrix(
  tree: Tree,
  translationZ: number,
  scaleX: number,
  scaleY: number,
  scaleZ: number,
  translationX = 0,
  translationY = 0,
  headingOffset = 0,
  pitch = 0,
) {
  const position =
    Cartesian3.fromDegrees(
      tree.longitude,
      tree.latitude,
      PLAN_HEIGHT,
    );

  const worldMatrix =
    Transforms.eastNorthUpToFixedFrame(
      position,
    );

  const rotation =
    Quaternion.fromHeadingPitchRoll(
      new HeadingPitchRoll(
        treeRotation(tree) +
        headingOffset,
        pitch,
        0,
      ),
    );

  const trs =
    new TranslationRotationScale();

  trs.translation =
    new Cartesian3(
      translationX,
      translationY,
      translationZ,
    );

  trs.rotation =
    rotation;

  trs.scale =
    new Cartesian3(
      scaleX,
      scaleY,
      scaleZ,
    );

  const localMatrix =
    Matrix4.fromTranslationRotationScale(
      trs,
      new Matrix4(),
    );

  return Matrix4.multiply(
    worldMatrix,
    localMatrix,
    new Matrix4(),
  );
}

function getTreeLocalDirection(
  tree: Tree,
  headingOffset: number,
  pitch: number,
) {
  const rotation =
    Quaternion.fromHeadingPitchRoll(
      new HeadingPitchRoll(
        treeRotation(tree) +
        headingOffset,
        pitch,
        0,
      ),
    );

  return Matrix3.multiplyByVector(
    Matrix3.fromQuaternion(
      rotation,
      new Matrix3(),
    ),
    Cartesian3.UNIT_Z,
    new Cartesian3(),
  );
}

function crownLobeId(
  treeId: string,
  lobeIndex: number,
) {
  return `${treeId}--crown-lobe-${lobeIndex}`;
}

function coniferTierId(
  treeId: string,
  tierIndex: number,
) {
  return `${treeId}--conifer-tier-${tierIndex}`;
}

function getCrownInstanceIds(
  tree: Tree,
  shape: TreeShape,
) {
  const ids = [tree.id];

  if (hasOrganicCrownLobes(shape)) {
    for (
      let index = 1;
      index <= getOrganicCrownLobeCount(tree);
      index += 1
    ) {
      ids.push(crownLobeId(tree.id, index));
    }
  }

  if (shape === "conical") {
    for (
      let index = 1;
      index < getConiferTierCount(tree);
      index += 1
    ) {
      ids.push(coniferTierId(tree.id, index));
    }
  }

  return ids;
}

function getCrownPartShade(
  tree: Tree,
  shape: TreeShape,
  partIndex: number,
) {
  if (shape === "conical") {
    return [-0.14, -0.075, -0.015, 0.05][partIndex] ?? 0;
  }

  if (hasOrganicCrownLobes(shape)) {
    const base =
      [-0.1, 0.04, -0.025, 0.06, 0.015][partIndex] ?? 0;

    return base +
      (treeRandom(tree, partIndex + 30) - 0.5) *
      0.045;
  }

  return 0;
}

function hasOrganicCrownLobes(
  shape: TreeShape,
) {
  /*
   * Les feuillus gagnent une silhouette moins
   * parfaite avec quelques volumes secondaires.
   * Les conifères et les arbres colonnaires
   * restent volontairement lisibles d'un coup d'œil.
   */
  return (
    shape === "round" ||
    shape === "spreading" ||
    shape === "compact"
  );
}

function getOrganicCrownLobeCount(
  tree: Tree,
) {
  return 2 +
    Math.floor(
      treeRandom(tree, 20) * 3,
    );
}

function getConiferTierCount(
  tree: Tree,
) {
  return 3 +
    Math.floor(
      treeRandom(tree, 12) * 2,
    );
}

function getConiferTiers(
  tree: Tree,
  crownRadiusX: number,
  crownRadiusY: number,
  trunkHeight: number,
  crownHeight: number,
) {
  const tierCount =
    getConiferTierCount(tree);

  return Array.from(
    { length: tierCount },
    (_, index) => {
      const heightFactor =
        0.54 -
        index * 0.075;
      const centreFactor =
        Math.min(
          1 - heightFactor / 2,
          0.27 + index * 0.235,
        );
      const radiusFactor =
        0.96 -
        index *
        0.54 /
        Math.max(1, tierCount - 1);
      const variationX =
        0.94 +
        treeRandom(tree, index + 60) * 0.12;
      const variationY =
        0.94 +
        treeRandom(tree, index + 70) * 0.12;

      return {
        centerZ:
          trunkHeight +
          crownHeight *
          centreFactor,
        scaleX:
          crownRadiusX *
          radiusFactor *
          variationX,
        scaleY:
          crownRadiusY *
          radiusFactor *
          variationY,
        scaleZ:
          crownHeight *
          heightFactor,
        x:
          (treeRandom(tree, index + 80) - 0.5) *
          crownRadiusX *
          0.065,
        y:
          (treeRandom(tree, index + 90) - 0.5) *
          crownRadiusY *
          0.065,
      };
    },
  );
}

function getOrganicCrownLobes(
  tree: Tree,
  crownRadiusX: number,
  crownRadiusY: number,
  crownHeight: number,
  crownScaleZ: number,
) {
  const lobeCount =
    getOrganicCrownLobeCount(tree);
  const rotation =
    treeRandom(tree, 21) *
    Math.PI * 2;

  return Array.from(
    { length: lobeCount },
    (_, index) => {
      const angle =
        rotation +
        index / lobeCount * Math.PI * 2 +
        (treeRandom(tree, index + 22) - 0.5) *
        0.9;
      const distance =
        0.18 +
        treeRandom(tree, index + 26) * 0.16;

      return {
        x:
          Math.cos(angle) *
          crownRadiusX *
          distance,
        y:
          Math.sin(angle) *
          crownRadiusY *
          distance,
        z:
          (treeRandom(tree, index + 34) - 0.55) *
          crownHeight *
          0.34,
        scaleX:
          crownRadiusX *
          (0.48 + treeRandom(tree, index + 38) * 0.14),
        scaleY:
          crownRadiusY *
          (0.48 + treeRandom(tree, index + 42) * 0.14),
        scaleZ:
          crownScaleZ *
          (0.48 + treeRandom(tree, index + 46) * 0.14),
      };
    },
  );
}

function getMainBranches(
  tree: Tree,
  shape: TreeShape,
  trunkHeight: number,
  crownHeight: number,
  crownRadiusX: number,
  crownRadiusY: number,
) {
  if (
    !hasOrganicCrownLobes(shape) ||
    trunkHeight < 2 ||
    crownHeight < 4
  ) {
    return [];
  }

  const count =
    3 +
    Math.floor(
      treeRandom(tree, 100) * 2,
    );
  const baseRotation =
    treeRandom(tree, 101) *
    Math.PI * 2;
  const crownRadius =
    Math.min(crownRadiusX, crownRadiusY);

  return Array.from(
    { length: count },
    (_, index) => {
      const heading =
        baseRotation +
        index / count * Math.PI * 2 +
        (treeRandom(tree, index + 102) - 0.5) *
        0.22;
      const length =
        Math.max(
          1.2,
          Math.min(
            crownRadius *
            (0.42 + treeRandom(tree, index + 108) * 0.16),
            crownHeight * 0.42,
          ),
        );
      const pitch =
        CesiumMath.toRadians(
          28 +
          treeRandom(tree, index + 114) * 12,
        );
      return {
        startZ:
          trunkHeight *
          (0.72 + treeRandom(tree, index + 120) * 0.12),
        length,
        heading,
        pitch,
        radius:
          0.055 +
          Math.min(
            0.12,
            crownRadius * 0.012,
          ),
      };
    },
  );
}

type CrownProfilePoint = {
  z: number;
  radius: number;
};

/*
 * Ces profils donnent une silhouette volontairement dessinée : bords
 * doucement festonnés pour les feuillus, étages fondus dans une seule forme
 * pour les conifères. Ils remplacent les sphères et cônes génériques tout en
 * restant des géométries partagées par les arbres d'un même type.
 */
function getStylizedCrownProfile(
  shape: TreeShape,
): {
  profile: CrownProfilePoint[];
  lobeCount: number;
  lobeDepth: number;
} {
  if (shape === "conical") {
    return {
      profile: [
        { z: -0.43, radius: 0.88 },
        { z: -0.28, radius: 0.66 },
        { z: -0.18, radius: 0.72 },
        { z: -0.03, radius: 0.46 },
        { z: 0.06, radius: 0.52 },
        { z: 0.19, radius: 0.3 },
        { z: 0.27, radius: 0.34 },
        { z: 0.42, radius: 0.1 },
      ],
      lobeCount: 6,
      lobeDepth: 0.025,
    };
  }

  if (shape === "spreading") {
    return {
      profile: [
        { z: -0.8, radius: 0.3 },
        { z: -0.57, radius: 0.78 },
        { z: -0.25, radius: 1.05 },
        { z: 0.1, radius: 1.1 },
        { z: 0.42, radius: 0.88 },
        { z: 0.72, radius: 0.5 },
        { z: 0.9, radius: 0.2 },
      ],
      lobeCount: 7,
      lobeDepth: 0.055,
    };
  }

  if (shape === "compact") {
    return {
      profile: [
        { z: -0.8, radius: 0.3 },
        { z: -0.55, radius: 0.72 },
        { z: -0.15, radius: 0.94 },
        { z: 0.25, radius: 0.9 },
        { z: 0.62, radius: 0.61 },
        { z: 0.88, radius: 0.22 },
      ],
      lobeCount: 5,
      lobeDepth: 0.03,
    };
  }

  if (shape === "columnar") {
    return {
      profile: [
        { z: -0.88, radius: 0.28 },
        { z: -0.55, radius: 0.55 },
        { z: -0.08, radius: 0.63 },
        { z: 0.36, radius: 0.5 },
        { z: 0.73, radius: 0.26 },
      ],
      lobeCount: 5,
      lobeDepth: 0.045,
    };
  }

  return {
    profile: [
      { z: -0.82, radius: 0.34 },
      { z: -0.58, radius: 0.72 },
      { z: -0.2, radius: 1 },
      { z: 0.2, radius: 0.98 },
      { z: 0.56, radius: 0.76 },
      { z: 0.83, radius: 0.37 },
    ],
    lobeCount: 6,
    lobeDepth: 0.025,
  };
}

function createStylizedCrownGeometry(
  shape: TreeShape,
) {
  const {
    profile,
    lobeCount,
    lobeDepth,
  } = getStylizedCrownProfile(shape);
  // Géométrie partagée : quelques faces de plus lissent les feuillus sans
  // multiplier les primitives ni les appels de rendu.
  const slices = 32;
  const positions: number[] = [0, 0, shape === "conical" ? -0.5 : -1];
  const normals: number[] = [0, 0, -1];
  const indices: number[] = [];

  for (
    let ringIndex = 0;
    ringIndex < profile.length;
    ringIndex += 1
  ) {
    const point = profile[ringIndex];
    const previous = profile[Math.max(0, ringIndex - 1)];
    const next = profile[Math.min(profile.length - 1, ringIndex + 1)];
    const radiusSlope =
      (next.radius - previous.radius) /
      (next.z - previous.z || 1);

    for (
      let slice = 0;
      slice < slices;
      slice += 1
    ) {
      const angle = slice / slices * Math.PI * 2;
      const scallop =
        1 +
        Math.cos(angle * lobeCount) *
        lobeDepth;
      const radius = point.radius * scallop;
      const normalLength = Math.hypot(1, radiusSlope);

      positions.push(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
        point.z,
      );

      normals.push(
        Math.cos(angle) / normalLength,
        Math.sin(angle) / normalLength,
        -radiusSlope / normalLength,
      );
    }
  }

  const bottomIndex = 0;
  const firstRing = 1;
  const topIndex =
    firstRing +
    profile.length * slices;
  const topZ =
    shape === "conical" ? 0.5 : 1;

  positions.push(0, 0, topZ);
  normals.push(0, 0, 1);

  for (
    let slice = 0;
    slice < slices;
    slice += 1
  ) {
    const nextSlice =
      (slice + 1) % slices;

    indices.push(
      bottomIndex,
      firstRing + nextSlice,
      firstRing + slice,
    );

    for (
      let ringIndex = 0;
      ringIndex < profile.length - 1;
      ringIndex += 1
    ) {
      const lower =
        firstRing +
        ringIndex * slices +
        slice;
      const lowerNext =
        firstRing +
        ringIndex * slices +
        nextSlice;
      const upper = lower + slices;
      const upperNext = lowerNext + slices;

      indices.push(
        lower,
        lowerNext,
        upperNext,
        lower,
        upperNext,
        upper,
      );
    }

    const lastRing =
      firstRing +
      (profile.length - 1) * slices;

    indices.push(
      topIndex,
      lastRing + slice,
      lastRing + nextSlice,
    );
  }

  const positionValues =
    new Float64Array(positions);
  const attributes =
    new GeometryAttributes();

  attributes.position =
    new GeometryAttribute({
      componentDatatype: ComponentDatatype.DOUBLE,
      componentsPerAttribute: 3,
      values: positionValues,
    });

  attributes.normal =
    new GeometryAttribute({
      componentDatatype: ComponentDatatype.FLOAT,
      componentsPerAttribute: 3,
      values: new Float32Array(normals),
    });

  return new Geometry({
    attributes,
    indices: new Uint16Array(indices),
    primitiveType: PrimitiveType.TRIANGLES,
    boundingSphere: BoundingSphere.fromVertices(positions),
  });
}

function getPickedId(
  picked: unknown,
): string {
  if (
    !picked ||
    typeof picked !== "object"
  ) {
    return "";
  }

  const candidate =
    picked as {
      id?:
      | string
      | {
        id?: string;
      };
    };

  let id = "";

  if (
    typeof candidate.id ===
    "string"
  ) {
    id = candidate.id;
  } else if (
    candidate.id &&
    typeof candidate.id ===
    "object" &&
    typeof candidate.id.id ===
    "string"
  ) {
    id =
      candidate.id.id;
  }

  return id.replace(
    /(?:-(?:roof|roof-outline|label)|--(?:crown-lobe|branch|conifer-tier)-\d+)$/,
    "",
  );
}

export default function MapView(
  props: MapViewProps,
) {
  /*
   * Défense runtime :
   * évite le crash visibleTrees.length
   * même après un HMR imparfait.
   */
  const trees =
    Array.isArray(props.trees)
      ? props.trees
      : [];

  const visibleTrees =
    Array.isArray(
      props.visibleTrees,
    )
      ? props.visibleTrees
      : [];

  const interactiveTrees =
    Array.isArray(
      props.interactiveTrees,
    )
      ? props.interactiveTrees
      : visibleTrees;

  const {
    plan,
    parkId,
    isParkTransitioning,
    onSceneReady,
    selectedTree,
    focusTreeId,
    focusRequest,
    viewMode,
    onChangeViewMode,
    isMobile,
    isMobilePanelOpen,
    hoveredTreeId,
    onSelectTree,
    onSelectLandmark,
    onRecenter,
    recenter,
  } = props;

  const elementRef =
    useRef<HTMLDivElement>(null);

  const creditsRef =
    useRef<HTMLDivElement>(null);

  const viewerRef =
    useRef<Viewer | null>(null);

  const changeZoomInRef =
    useRef<(() => void) | null>(null);

  const treePrimitivesRef =
    useRef<PrimitiveCollection | null>(
      null,
    );

  const crownPrimitivesRef =
    useRef<
      Partial<
        Record<
          TreeShape,
          Primitive
        >
      >
    >({});

  const trunkPrimitiveRef =
    useRef<Primitive | null>(null);

  const trunkInstanceIdsByTreeRef =
    useRef<Map<string, string[]>>(new Map());

  const treeVisibilityByIdRef =
    useRef<Map<string, boolean>>(new Map());

  const treeShapeByIdRef =
    useRef<
      Map<
        string,
        TreeShape
      >
    >(new Map());

  /* Évite de réécrire les attributs GPU d'un arbre dont la couleur ne change pas. */
  const crownColorStateByTreeRef =
    useRef<Map<string, string>>(new Map());

  const treesRef =
    useRef<Tree[]>(trees);

  const visibleTreesRef =
    useRef<Tree[]>(
      interactiveTrees,
    );

  const planRef =
    useRef(plan);

  const onSelectRef =
    useRef(onSelectTree);

  const isMobileRef = useRef(isMobile);

  const onSelectLandmarkRef =
    useRef(onSelectLandmark);

  const onSceneReadyRef =
    useRef(onSceneReady);

  const [revision, setRevision] =
    useState(0);

  const [phase, setPhase] =
    useState<
      "loading" |
      "ready" |
      "error"
    >("loading");

  const [contentReady, setContentReady] = useState(false);

  const [
    mapHoveredTreeId,
    setMapHoveredTreeId,
  ] =
    useState<string | null>(
      null,
    );

  const [tooltip, setTooltip] =
    useState<MapTooltip | null>(
      null,
    );

  const [cameraHeading, setCameraHeading] = useState(0);
  const [completedFocusRequest, setCompletedFocusRequest] = useState(0);
  const displayedHeadingRef = useRef(0);
  const shouldCenterOnLocationRef = useRef(false);
  const locationRequestRef = useRef(0);
  const locationLongPressRef = useRef<number | null>(null);
  const ignoreLocationClickRef = useRef(false);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [locationStatus, setLocationStatus] = useState<"idle" | "locating" | "imprecise" | "stale" | "too-far" | "error">("idle");
  const [locationNoticeVisible, setLocationNoticeVisible] = useState(true);
  const [locationRequest, setLocationRequest] = useState(0);

  useEffect(() => {
    if (!userLocation) return;
    const timeoutId = window.setTimeout(() => {
      setLocationStatus("stale");
    }, Math.max(0, userLocation.timestamp + MAX_LOCATION_AGE_MS - Date.now()));
    return () => window.clearTimeout(timeoutId);
  }, [userLocation]);

  useEffect(() => {
    setLocationNoticeVisible(true);
    if (!["too-far", "error", "imprecise", "stale"].includes(locationStatus)) return;

    // Keep the status so repeated GPS errors do not reopen the same notice.
    const timeoutId = window.setTimeout(() => setLocationNoticeVisible(false), 4000);
    return () => window.clearTimeout(timeoutId);
  }, [locationStatus, locationRequest]);

  useEffect(() => () => {
    if (locationLongPressRef.current !== null) window.clearTimeout(locationLongPressRef.current);
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    viewer.entities.removeById("user-location");
    viewer.scene.requestRender();
    if (!userLocation) return;

    viewer.entities.add({
      id: "user-location",
      position: Cartesian3.fromDegrees(userLocation.longitude, userLocation.latitude, PLAN_HEIGHT + 1),
      ellipse: {
        semiMajorAxis: Math.max(1, userLocation.accuracy),
        semiMinorAxis: Math.max(1, userLocation.accuracy),
        height: PLAN_HEIGHT + 0.05,
        material: Color.fromCssColorString("#2563eb").withAlpha(0.15),
      },
      point: {
        pixelSize: 13,
        color: Color.fromCssColorString(locationStatus === "stale" ? "#64748b" : "#2563eb"),
        outlineColor: Color.WHITE,
        outlineWidth: 3,
      },
    });
    viewer.scene.requestRender();

    return () => {
      if (!viewer.isDestroyed()) viewer.entities.removeById("user-location");
    };
  }, [userLocation, revision, locationStatus]);

  useEffect(() => {
    treesRef.current =
      trees;

    visibleTreesRef.current =
      interactiveTrees;

    planRef.current =
      plan;

    onSelectRef.current =
      onSelectTree;

    isMobileRef.current = isMobile;

    onSelectLandmarkRef.current =
      onSelectLandmark;

    onSceneReadyRef.current =
      onSceneReady;
  }, [
    trees,
    interactiveTrees,
    plan,
    onSelectTree,
    onSelectLandmark,
    onSceneReady,
    isMobile,
  ]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || phase !== "ready") return;

    // Cesium ne signale `camera.changed` qu'après un déplacement important
    // par défaut (50 %). La boussole doit suivre les petites rotations aussi.
    viewer.camera.percentageChanged = 0.01;
    displayedHeadingRef.current = viewer.camera.heading;

    const updateHeading = () => {
      const nextHeading = viewer.camera.heading;
      let delta = nextHeading - displayedHeadingRef.current;

      // Évite le saut de rotation lorsque le cap passe de +π à -π.
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;

      displayedHeadingRef.current += delta;
      setCameraHeading(displayedHeadingRef.current);
    };

    updateHeading();
    return viewer.camera.changed.addEventListener(updateHeading);
  }, [phase, revision]);

  /* Centre le cadrage uniquement via le bouton ⌖ de la liste. */
  useEffect(() => {
    const viewer = viewerRef.current;
    const treeToFocus = focusTreeId ? trees.find((tree) => tree.id === focusTreeId) ?? null : null;
    if (!viewer || !treeToFocus) return;

    /*
     * Sur petit écran, la sélection doit simplement déplacer le point visé.
     * En recalculant une pose autour de l'arbre avec le cap, l'inclinaison et
     * la distance courants, le vol ne change ni la rotation ni le zoom que
     * l'utilisateur vient de choisir au geste.
     */
    if (isMobile) {
      const camera = viewer.camera;
      const canvasCentre = new Cartesian2(
        viewer.scene.canvas.clientWidth / 2,
        viewer.scene.canvas.clientHeight / 2,
      );
      const currentCentre = camera.pickEllipsoid(canvasCentre, viewer.scene.globe.ellipsoid);
      const range = currentCentre
        ? Cartesian3.distance(camera.positionWC, currentCentre)
        : Math.max(12, camera.positionCartographic.height);
      const target = Cartesian3.fromDegrees(treeToFocus.longitude, treeToFocus.latitude);
      const offset = new HeadingPitchRange(camera.heading, camera.pitch, range);
      const initialDestination = Cartesian3.clone(camera.positionWC);
      const initialDirection = Cartesian3.clone(camera.directionWC);
      const initialUp = Cartesian3.clone(camera.upWC);

      camera.cancelFlight();
      camera.lookAt(target, offset);
      camera.lookAtTransform(Matrix4.IDENTITY);
      const destination = Cartesian3.clone(camera.positionWC);
      const direction = Cartesian3.clone(camera.directionWC);
      const up = Cartesian3.clone(camera.upWC);
      camera.setView({
        destination: initialDestination,
        orientation: { direction: initialDirection, up: initialUp },
      });
      camera.flyTo({
        destination,
        orientation: { direction, up },
        duration: 0.55,
        complete: () => setCompletedFocusRequest(focusRequest),
      });

      return () => camera.cancelFlight();
    }

    const proportions = getTreeProportions(treeToFocus);
    const centre = Cartesian3.fromDegrees(
      treeToFocus.longitude,
      treeToFocus.latitude,
      proportions.trunkHeight + proportions.crownHeight / 2,
    );

    viewer.camera.cancelFlight();
    const parkRange = getParkViewRange(viewer, plan?.bbox ?? PARK_PLAN_BOUNDS);
    const parkOffset = new HeadingPitchRange(
      CesiumMath.toRadians(6),
      CesiumMath.toRadians(-66),
      parkRange,
    );
    const closeRange = parkRange * 0.2;
    const closeOffset = new HeadingPitchRange(parkOffset.heading, parkOffset.pitch, closeRange);
    const canvasCentre = new Cartesian2(viewer.scene.canvas.clientWidth / 2, viewer.scene.canvas.clientHeight / 2);
    const currentCentre = viewer.camera.pickEllipsoid(canvasCentre, viewer.scene.globe.ellipsoid);
    const targetOnGround = Cartesian3.fromDegrees(treeToFocus.longitude, treeToFocus.latitude);
    const targetDistance = currentCentre ? Cartesian3.distance(currentCentre, targetOnGround) : parkRange;
    const isNearby = targetDistance < Math.max(70, parkRange * 0.3);
    // Le recul augmente avec la distance à parcourir, sans jamais dépasser
    // l'échelle du parc. Un arbre voisin est cadré directement.
    const transitionRange = CesiumMath.clamp(closeRange + targetDistance * 0.85, closeRange, parkRange);
    const transitionOffset = new HeadingPitchRange(parkOffset.heading, parkOffset.pitch, transitionRange);
    const capturePose = () => ({
      destination: Cartesian3.clone(viewer.camera.positionWC),
      direction: Cartesian3.clone(viewer.camera.directionWC),
      up: Cartesian3.clone(viewer.camera.upWC),
    });
    const initialPose = capturePose();

    viewer.camera.lookAt(centre, transitionOffset);
    viewer.camera.lookAtTransform(Matrix4.IDENTITY);
    const transitionPose = capturePose();
    viewer.camera.lookAt(centre, closeOffset);
    viewer.camera.lookAtTransform(Matrix4.IDENTITY);
    const closePose = capturePose();
    viewer.camera.setView({ destination: initialPose.destination, orientation: { direction: initialPose.direction, up: initialPose.up } });

    // Chaque phase est animée par Cesium. On conserve le recul, le déplacement
    // puis le resserrage du cadrage sans imposer setView à chaque image depuis
    // React, qui était la source des saccades du vol précédent.
    let cancelled = false;
    const finishFocus = () => {
      if (!cancelled) setCompletedFocusRequest(focusRequest);
    };
    const flyClose = () => {
      if (cancelled) return;
      viewer.camera.flyTo({
        destination: closePose.destination,
        orientation: { direction: closePose.direction, up: closePose.up },
        duration: 0.65,
        complete: finishFocus,
      });
    };

    if (isNearby) {
      viewer.camera.flyTo({
        destination: closePose.destination,
        orientation: { direction: closePose.direction, up: closePose.up },
        duration: 0.8,
        complete: finishFocus,
      });
    } else {
      viewer.camera.flyTo({
        destination: transitionPose.destination,
        orientation: { direction: transitionPose.direction, up: transitionPose.up },
        duration: 0.75,
        complete: flyClose,
      });
    }

    return () => {
      cancelled = true;
      viewer.camera.cancelFlight();
    };
  }, [trees, focusTreeId, focusRequest, isMobile, revision]);

  /* Houppier temporairement rendu au premier plan lors d'un cadrage. */
  useEffect(() => {
    const viewer = viewerRef.current;
    const treeToFocus = focusTreeId ? trees.find((tree) => tree.id === focusTreeId) ?? null : null;
    if (!viewer || !treeToFocus || focusRequest === 0 || completedFocusRequest !== focusRequest) return;

    const proportions = getTreeProportions(treeToFocus);
    const shape = getTreeShape(treeToFocus);
    const crownPlacement = getCrownPlacement(
      proportions.trunkHeight,
      proportions.crownHeight,
      shape,
    );
    const crownGeometry =
      createStylizedCrownGeometry(shape);
    const focusCrown = viewer.scene.primitives.add(new Primitive({
      geometryInstances: new GeometryInstance({
        geometry: crownGeometry,
        modelMatrix: makeTreeMatrix(
          treeToFocus,
          crownPlacement.centerZ,
          proportions.crownRadiusX * 1.45,
          proportions.crownRadiusY * 1.45,
          crownPlacement.scaleZ * 1.2,
        ),
        attributes: { color: ColorGeometryInstanceAttribute.fromColor(TREE_SELECTED_COLOR.withAlpha(0.88)) },
      }),
      appearance: new PerInstanceColorAppearance({
        flat: false,
        translucent: true,
        closed: true,
        renderState: { depthTest: { enabled: false } },
      }),
      asynchronous: false,
      releaseGeometryInstances: true,
    }));
    viewer.scene.requestRender();

    // La couronne mise en avant reste visible un instant après l'arrivée,
    // sans clignotement qui interromprait la lecture de la carte.
    const removeTimer = window.setTimeout(() => {
      if (!viewer.isDestroyed()) {
        viewer.scene.primitives.remove(focusCrown);
        viewer.scene.requestRender();
      }
    }, 1_500);

    return () => {
      window.clearTimeout(removeTimer);
      if (!viewer.isDestroyed()) viewer.scene.primitives.remove(focusCrown);
    };
  }, [trees, focusTreeId, focusRequest, completedFocusRequest, plan, revision]);

  /*
   * Viewer Cesium
   */
  useEffect(() => {
    if (
      !elementRef.current ||
      !creditsRef.current
    ) {
      return;
    }

    setPhase("loading");

    let viewer:
      | Viewer
      | undefined;

    let interactions:
      | ScreenSpaceEventHandler
      | undefined;

    const cleanups:
      Array<() => void> =
      [];

    let stopped = false;

    let dragStart:
      | { x: number; y: number }
      | null = null;

    let draggedAt = 0;

    let lastTouchTap:
      | { x: number; y: number; time: number }
      | null = null;

    let touchZoomGesture:
      | { pointerId: number; lastY: number; target: Cartesian3 }
      | null = null;

    let touchZoomJustEnded = false;

    try {
      viewer =
        new Viewer(
          elementRef.current,
          {
            animation: false,
            /* Le fond SIG Rennes Métropole est désactivé par défaut. */
            baseLayer: false,
            baseLayerPicker:
              false,
            fullscreenButton:
              false,
            geocoder: false,
            homeButton: false,
            infoBox: false,
            navigationHelpButton:
              false,
            sceneModePicker:
              false,
            selectionIndicator:
              false,
            timeline: false,
            creditContainer:
              creditsRef.current,
            showRenderLoopErrors:
              false,

            /*
             * Plus raisonnable sur mobile
             * que le rendu forcé très dense.
             */
            useBrowserRecommendedResolution:
              true,

            requestRenderMode:
              true,

            maximumRenderTimeChange:
              Number.POSITIVE_INFINITY,

            shouldAnimate:
              false,
          },
        );

      viewerRef.current =
        viewer;

      viewer.resolutionScale =
        1;

      viewer.scene.backgroundColor =
        Color.fromCssColorString(
          "#e8efe5",
        );

      viewer.scene.globe.baseColor =
        Color.fromCssColorString(
          "#e8efe5",
        );

      viewer.scene.skyBox.show =
        false;

      viewer.scene.sun.show =
        false;

      viewer.scene.moon.show =
        false;

      /*
       * Une lumière fixe et douce rend les volumes lisibles sans
       * dépendre de l'heure de visite ni afficher le soleil Cesium.
       */
      viewer.scene.light =
        new DirectionalLight({
          direction:
            Cartesian3.normalize(
              new Cartesian3(
                0.35,
                0.55,
                -0.76,
              ),
              new Cartesian3(),
            ),
        });

      /* Adoucit les contours fins sans modifier les proportions réelles. */
      viewer.scene.postProcessStages.fxaa.enabled =
        true;

      viewer.scene.screenSpaceCameraController.minimumZoomDistance =
        8;

      setParkView(
        viewer,
        plan?.bbox ??
        PARK_PLAN_BOUNDS,
        "3d",
        isMobile && (parkId === "oberthur" || parkId === "thabor") ? parkId : null,
      );

      let firstFrame =
        true;

      cleanups.push(
        viewer.scene.postRender.addEventListener(
          () => {
            if (
              firstFrame &&
              !stopped
            ) {
              firstFrame =
                false;

              setPhase(
                "ready",
              );
            }
          },
        ),
      );

      cleanups.push(
        viewer.scene.renderError.addEventListener(
          (_scene, error) => {
            console.error(
              "Erreur de rendu Cesium",
              error,
            );

            if (!stopped) {
              setPhase(
                "error",
              );
            }
          },
        ),
      );

      viewer.screenSpaceEventHandler.removeInputAction(
        ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
      );

      const zoomInOnDoubleClick = () => {
        changeZoomInRef.current?.();
      };

      /*
       * Geste Android Maps : un premier tap, puis un second tap maintenu,
       * avec déplacement vertical pour zoomer. Le contrôleur Cesium est
       * suspendu pendant ce geste afin qu'il ne transforme pas le mouvement
       * en rotation ou en déplacement de la carte.
       */
      const getCanvasPosition = (event: PointerEvent) => {
        const rect = viewer!.scene.canvas.getBoundingClientRect();
        return new Cartesian2(
          event.clientX - rect.left,
          event.clientY - rect.top,
        );
      };

      const beginOrRememberTouch = (event: PointerEvent) => {
        if (
          !isMobileRef.current ||
          event.pointerType !== "touch" ||
          !event.isPrimary
        ) {
          return;
        }

        touchZoomJustEnded = false;
        const position = getCanvasPosition(event);
        const now = performance.now();
        const previousTap = lastTouchTap;
        const isSecondTap = previousTap &&
          now - previousTap.time <= 300 &&
          Math.hypot(
            position.x - previousTap.x,
            position.y - previousTap.y,
          ) <= 32;

        if (!isSecondTap) return;

        lastTouchTap = null;
        changeZoomInRef.current?.();
        touchZoomJustEnded = true;
        event.preventDefault();
        event.stopImmediatePropagation();
      };

      const updateTouchZoom = (event: PointerEvent) => {
        if (
          !touchZoomGesture ||
          event.pointerId !== touchZoomGesture.pointerId
        ) {
          return;
        }

        const deltaY = event.clientY - touchZoomGesture.lastY;
        touchZoomGesture.lastY = event.clientY;

        if (deltaY !== 0) {
          const camera = viewer!.camera;
          const distance = Cartesian3.distance(
            camera.positionWC,
            touchZoomGesture.target,
          );
          const amount = Math.max(
            1,
            distance * Math.min(0.08, Math.abs(deltaY) * 0.002),
          );

          if (deltaY < 0) camera.zoomOut(amount);
          else camera.zoomIn(amount);
          viewer!.scene.requestRender();
        }

        event.preventDefault();
        event.stopImmediatePropagation();
      };

      const endTouchZoom = (event: PointerEvent) => {
        if (
          !touchZoomGesture ||
          event.pointerId !== touchZoomGesture.pointerId
        ) {
          return;
        }

        touchZoomGesture = null;
        touchZoomJustEnded = true;
        viewer!.scene.screenSpaceCameraController.enableInputs = true;
        event.preventDefault();
        event.stopImmediatePropagation();
      };

      const rememberTouchTap = (event: PointerEvent) => {
        if (
          touchZoomGesture ||
          touchZoomJustEnded ||
          !isMobileRef.current ||
          event.pointerType !== "touch" ||
          !event.isPrimary
        ) {
          return;
        }

        touchZoomJustEnded = false;

        const position = getCanvasPosition(event);
        lastTouchTap = {
          x: position.x,
          y: position.y,
          time: performance.now(),
        };
      };

      const canvas = viewer.scene.canvas;
      canvas.addEventListener("dblclick", zoomInOnDoubleClick);
      canvas.addEventListener("pointerdown", beginOrRememberTouch, true);
      canvas.addEventListener("pointermove", updateTouchZoom, true);
      canvas.addEventListener("pointerup", endTouchZoom, true);
      canvas.addEventListener("pointercancel", endTouchZoom, true);
      canvas.addEventListener("pointerup", rememberTouchTap);

      cleanups.push(() => {
        canvas.removeEventListener("dblclick", zoomInOnDoubleClick);
        canvas.removeEventListener("pointerdown", beginOrRememberTouch, true);
        canvas.removeEventListener("pointermove", updateTouchZoom, true);
        canvas.removeEventListener("pointerup", endTouchZoom, true);
        canvas.removeEventListener("pointercancel", endTouchZoom, true);
        canvas.removeEventListener("pointerup", rememberTouchTap);
        if (touchZoomGesture) {
          viewer!.scene.screenSpaceCameraController.enableInputs = true;
          touchZoomGesture = null;
        }
      });

      interactions =
        new ScreenSpaceEventHandler(
          viewer.scene.canvas,
        );

      interactions.setInputAction(
        (event: ScreenSpaceEventHandler.PositionedEvent) => {
          dragStart = event.position;
        },
        ScreenSpaceEventType.LEFT_DOWN,
      );

      interactions.setInputAction(
        (event: ScreenSpaceEventHandler.PositionedEvent) => {
          if (
            dragStart &&
            Math.hypot(
              event.position.x - dragStart.x,
              event.position.y - dragStart.y,
            ) > 24
          ) {
            draggedAt = Date.now();
          }
          dragStart = null;
        },
        ScreenSpaceEventType.LEFT_UP,
      );

      interactions.setInputAction(
        (
          event:
            ScreenSpaceEventHandler.PositionedEvent,
        ) => {
          if (Date.now() - draggedAt < 400) return;

          if (!isInsideMapCanvas(viewer!, event.position)) return;

          const picked =
            viewer?.scene.pick(
              event.position,
            );

          const id =
            getPickedId(
              picked,
            );

          const tree =
            visibleTreesRef.current.find(
              (item) =>
                item.id === id,
            );

          if (tree) {
            // Une fiche ouverte n'a pas besoin de conserver l'animation de survol.
            setMapHoveredTreeId(null);
            setTooltip(null);

            onSelectRef.current(
              tree,
            );

            return;
          }

          const landmark =
            planRef.current
              ?.features.find(
                (
                  feature,
                ): feature is ParkLandmark =>
                  isParkLandmark(
                    feature,
                  ) &&
                  feature.id ===
                  id,
              );

          if (landmark) {
            onSelectLandmarkRef.current(
              landmark,
            );
          }
        },
        ScreenSpaceEventType.LEFT_CLICK,
      );

      interactions.setInputAction(
        (
          event:
            ScreenSpaceEventHandler.MotionEvent,
        ) => {
          if (isMobileRef.current) {
            setMapHoveredTreeId(null);
            setTooltip(null);
            return;
          }

          if (!isInsideMapCanvas(viewer!, event.endPosition)) {
            setMapHoveredTreeId(null);
            setTooltip(null);
            return;
          }

          const picked =
            viewer?.scene.pick(
              event.endPosition,
            );

          const id =
            getPickedId(
              picked,
            );

          const tree =
            visibleTreesRef.current.find(
              (item) =>
                item.id === id,
            );

          const landmark =
            planRef.current
              ?.features.find(
                (
                  feature,
                ): feature is ParkLandmark =>
                  isParkLandmark(
                    feature,
                  ) &&
                  feature.id ===
                  id,
              );

          viewer!.scene.canvas.style.cursor =
            tree ||
              landmark
              ? "pointer"
              : "";

          setMapHoveredTreeId(
            (current) =>
              current ===
                tree?.id
                ? current
                : tree?.id ??
                null,
          );

          if (tree) {
            setTooltip(makeTreeTooltip(
              tree,
              treesRef.current.filter((item) => item.species === tree.species).length,
              event.endPosition.x,
              event.endPosition.y,
            ));

            return;
          }

          if (landmark) {
            setTooltip({
              name:
                landmark
                  .properties
                  .label,

              x:
                event
                  .endPosition.x,

              y:
                event
                  .endPosition.y,
            });

            return;
          }

          setTooltip(null);
        },
        ScreenSpaceEventType.MOUSE_MOVE,
      );

      const hideTooltip =
        () => {
          viewer?.scene.canvas.style.removeProperty(
            "cursor",
          );

          setMapHoveredTreeId(
            null,
          );

          setTooltip(
            null,
          );
        };

      viewer.scene.canvas.addEventListener(
        "mouseleave",
        hideTooltip,
      );

      cleanups.push(
        () =>
          viewer?.scene.canvas.removeEventListener(
            "mouseleave",
            hideTooltip,
          ),
      );
    } catch (error) {
      console.error(
        "Erreur de démarrage Cesium",
        error,
      );

      setPhase("error");
    }

    return () => {
      stopped = true;

      cleanups.forEach(
        (cleanup) =>
          cleanup(),
      );

      interactions?.destroy();

      treePrimitivesRef.current =
        null;

      crownPrimitivesRef.current =
        {};

      trunkPrimitiveRef.current = null;

      trunkInstanceIdsByTreeRef.current.clear();

      treeVisibilityByIdRef.current.clear();

      treeShapeByIdRef.current.clear();

      crownColorStateByTreeRef.current.clear();

      if (
        viewer &&
        !viewer.isDestroyed()
      ) {
        viewer.destroy();
      }

      viewerRef.current =
        null;
    };
  }, [revision]);

  /*
   * Plan et bâtiments.
   *
   * On garde le système Entity actuel
   * pour ceux-ci. Les arbres, eux,
   * sont dans des Primitive séparées.
   */
  useEffect(() => {
    const viewer =
      viewerRef.current;

    if (!viewer) {
      return;
    }

    viewer.entities.suspendEvents();

    try {
      viewer.entities.removeAll();

      const pathNetwork = buildPathNetwork((plan?.features ?? []).flatMap((feature) =>
        feature.geometry.type === "LineString" ? [feature.geometry.coordinates] : [],
      ));

      plan?.features.forEach(
        (feature) => {
          if (feature.geometry.type === "Point") {
            viewer.entities.add({
              id: feature.id,
              name: "Entrée",
              position: Cartesian3.fromDegrees(...feature.geometry.coordinates, PLAN_HEIGHT + 0.5),
              billboard: {
                image: entranceIcon,
                width: 18,
                height: 18,
                verticalOrigin: VerticalOrigin.BOTTOM,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              },
            });
            return;
          }
          if (
            feature.geometry.type ===
            "MultiPolygon"
          ) {
            feature.geometry.coordinates.forEach(
              (
                polygon,
                index,
              ) => {
                const [
                  outer,
                  ...holes
                ] = polygon;

                const outlinePositions =
                  positions(
                    outer,
                  );

                viewer.entities.add({
                  id:
                    `${feature.id}-${index}`,

                  polygon: {
                    hierarchy:
                      new PolygonHierarchy(
                        outlinePositions,

                        holes.map(
                          (
                            hole,
                          ) =>
                            new PolygonHierarchy(
                              positions(
                                hole,
                              ),
                            ),
                        ),
                      ),

                    material:
                      Color.fromCssColorString(
                        "#d9e9d5",
                      ).withAlpha(
                        0.88,
                      ),

                    height:
                      PLAN_HEIGHT,
                  },
                });

                viewer.entities.add({
                  id:
                    `${feature.id}-${index}-outline`,

                  polyline: {
                    positions:
                      outlinePositions,

                    width: 2,

                    material:
                      Color.fromCssColorString(
                        "#789b79",
                      ),
                  },
                });
              },
            );

            return;
          }

          if (
            feature.geometry.type ===
            "Polygon" &&
            isParkLandmark(feature)
          ) {
            const [
              outer,
              ...holes
            ] =
              feature.geometry
                .coordinates;

            const structureHeight =
              PLAN_HEIGHT +
              feature.properties
                .height_m;

            const building =
              feature.properties
                .kind ===
              "building";

            const wall =
              Color.fromCssColorString(
                building
                  ? "#a9745d"
                  : "#b88d45",
              ).withAlpha(
                building
                  ? 1
                  : 0.94,
              );

            const roof =
              Color.fromCssColorString(
                building
                  ? "#704738"
                  : "#7c5a2d",
              ).withAlpha(
                building
                  ? 1
                  : 0.98,
              );

            const hierarchy =
              new PolygonHierarchy(
                positions(
                  outer,
                ),

                holes.map(
                  (
                    hole,
                  ) =>
                    new PolygonHierarchy(
                      positions(
                        hole,
                      ),
                    ),
                ),
              );

            viewer.entities.add({
              id:
                feature.id,

              name:
                feature.properties
                  .label,

              polygon: {
                hierarchy,
                material:
                  wall,
                height:
                  PLAN_HEIGHT +
                  0.03,
                extrudedHeight:
                  structureHeight,
              },
            });

            viewer.entities.add({
              id:
                `${feature.id}-roof`,

              polygon: {
                hierarchy,
                material:
                  roof,
                height:
                  structureHeight +
                  0.03,
              },
            });

            viewer.entities.add({
              id:
                `${feature.id}-roof-outline`,

              polyline: {
                positions:
                  positions(
                    outer,
                    structureHeight +
                    0.06,
                  ),

                width: 1.8,

                material:
                  Color.fromCssColorString(
                    "#f7eddd",
                  ),
              },
            });

            return;
          }

          if (
            feature.geometry.type ===
            "Polygon"
          ) {
            const [
              outer,
              ...holes
            ] =
              feature.geometry
                .coordinates;

            const outlinePositions =
              positions(
                outer,
              );

            viewer.entities.add({
              id:
                feature.id,

              polygon: {
                hierarchy:
                  new PolygonHierarchy(
                    outlinePositions,

                    holes.map(
                      (
                        hole,
                      ) =>
                        new PolygonHierarchy(
                          positions(
                            hole,
                          ),
                        ),
                    ),
                  ),

                material:
                  Color.fromCssColorString(
                    "#9fc5d0",
                  ).withAlpha(
                    0.94,
                  ),

                height:
                  PLAN_HEIGHT +
                  0.01,
              },
            });

            viewer.entities.add({
              id:
                `${feature.id}-outline`,

              polyline: {
                positions:
                  outlinePositions,

                width: 1.5,

                material:
                  Color.fromCssColorString(
                    "#6f9eaa",
                  ),
              },
            });

            return;
          }

        },
      );

      pathNetwork.forEach((coordinates, index) => {
        viewer.entities.add({
          id: `path-network-${index}`,
          corridor: {
            positions: positions(simplifyPath(coordinates)),
            // Largeur illustrative en mètres ; la source ne donne pas les largeurs.
            width: 1.8,
            cornerType: CornerType.ROUNDED,
            height: PLAN_HEIGHT + 0.06,
            material: Color.fromCssColorString("#ad9672"),
          },
        });
      });
    } finally {
      viewer.entities.resumeEvents();
    }

    viewer.scene.requestRender();
  }, [
    plan,
    revision,
  ]);

  /*
   * ARBRES 3D
   *
   * Une Primitive pour les troncs +
   * une Primitive par type de houppier.
   *
   * Pas une Entity par arbre :
   * beaucoup plus léger.
   */
  useEffect(() => {
    const viewer =
      viewerRef.current;

    if (!viewer) {
      return;
    }

    if (
      treePrimitivesRef.current
    ) {
      viewer.scene.primitives.remove(
        treePrimitivesRef.current,
      );

      treePrimitivesRef.current =
        null;
    }

    crownPrimitivesRef.current =
      {};

    trunkPrimitiveRef.current = null;

    trunkInstanceIdsByTreeRef.current =
      new Map();

    treeVisibilityByIdRef.current =
      new Map();

    treeShapeByIdRef.current =
      new Map();

    crownColorStateByTreeRef.current =
      new Map();

    const collection =
      new PrimitiveCollection();

    viewer.scene.primitives.add(
      collection,
    );

    treePrimitivesRef.current =
      collection;

    const visibleIds =
      new Set(
        visibleTrees.map(
          (tree) =>
            tree.id,
        ),
      );

    const trunkGeometry =
      new CylinderGeometry({
        length: 1,

        topRadius: 0.72,

        bottomRadius: 1,

        slices: 12,

        vertexFormat:
          PerInstanceColorAppearance.VERTEX_FORMAT,
      });

    const branchGeometry =
      new CylinderGeometry({
        length: 1,
        topRadius: 0.58,
        bottomRadius: 1,
        slices: 8,
        vertexFormat:
          PerInstanceColorAppearance.VERTEX_FORMAT,
      });

    const ellipsoidGeometry =
      new EllipsoidGeometry({
        radii:
          new Cartesian3(
            1,
            1,
            1,
          ),

        stackPartitions: 14,

        slicePartitions: 20,

        vertexFormat:
          PerInstanceColorAppearance.VERTEX_FORMAT,
      });

    const coniferTierGeometry =
      new CylinderGeometry({
        length: 1,
        topRadius: 0.06,
        bottomRadius: 1,
        slices: 20,
        vertexFormat:
          PerInstanceColorAppearance.VERTEX_FORMAT,
      });

    const crownGeometries = {
      round: createStylizedCrownGeometry("round"),
      columnar: createStylizedCrownGeometry("columnar"),
      spreading: createStylizedCrownGeometry("spreading"),
      compact: createStylizedCrownGeometry("compact"),
    };

    const trunks:
      GeometryInstance[] =
      [];

    const crowns:
      Record<
        TreeShape,
        GeometryInstance[]
      > = {
      round: [],
      conical: [],
      columnar: [],
      spreading: [],
      compact: [],
    };

    for (
      const tree of trees
    ) {
      const isVisible =
        visibleIds.has(
          tree.id,
        );

      const shape =
        getTreeShape(
          tree,
        );

      treeShapeByIdRef.current.set(
        tree.id,
        shape,
      );

      /* Les primitives sont construites avec leur couleur normale. */
      crownColorStateByTreeRef.current.set(
        tree.id,
        "normal",
      );

      treeVisibilityByIdRef.current.set(
        tree.id,
        isVisible,
      );

      const {
        trunkHeight,
        trunkRadius,
        crownHeight,
        crownRadiusX,
        crownRadiusY,
      } =
        getTreeProportions(
          tree,
        );

      const crownPlacement =
        getCrownPlacement(
          trunkHeight,
          crownHeight,
          shape,
        );

      const trunkLength =
        Math.max(
          0.5,
          trunkHeight +
          crownPlacement.trunkOverlap,
        );

      const trunkCenter =
        trunkLength / 2;

      /*
       * Tronc
       */
      trunks.push(
        new GeometryInstance({
          id:
            tree.id,

          geometry:
            trunkGeometry,

          modelMatrix:
            makeTreeMatrix(
              tree,

              trunkCenter,

              trunkRadius,

              trunkRadius,

              trunkLength,
            ),

          attributes: {
            color:
              ColorGeometryInstanceAttribute.fromColor(
                TREE_TRUNK_COLOR,
              ),
            show: new ShowGeometryInstanceAttribute(isVisible),
          },
        }),
      );

      const branches = getMainBranches(
        tree,
        shape,
        trunkHeight,
        crownHeight,
        crownRadiusX,
        crownRadiusY,
      );

      trunkInstanceIdsByTreeRef.current.set(
        tree.id,
        [
          tree.id,
          ...branches.map(
            (_, branchIndex) =>
              `${tree.id}--branch-${branchIndex + 1}`,
          ),
        ],
      );

      branches.forEach(
        (branch, branchIndex) => {
          const direction =
            getTreeLocalDirection(
              tree,
              branch.heading,
              branch.pitch,
            );

          trunks.push(
            new GeometryInstance({
              id: `${tree.id}--branch-${branchIndex + 1}`,
              geometry: branchGeometry,
              modelMatrix: makeTreeMatrix(
                tree,
                branch.startZ +
                direction.z *
                branch.length / 2,
                branch.radius,
                branch.radius,
                branch.length,
                direction.x *
                branch.length / 2,
                direction.y *
                branch.length / 2,
                branch.heading,
                branch.pitch,
              ),
              attributes: {
                color:
                  ColorGeometryInstanceAttribute.fromColor(
                    TREE_TRUNK_COLOR,
                  ),
                show: new ShowGeometryInstanceAttribute(isVisible),
              },
            }),
          );
        },
      );

      /*
       * Houppier
       */
      if (shape === "conical") {
        getConiferTiers(
          tree,
          crownRadiusX,
          crownRadiusY,
          trunkHeight,
          crownHeight,
        ).forEach(
          (tier, tierIndex) => {
            crowns[shape].push(
              new GeometryInstance({
                id: tierIndex === 0
                  ? tree.id
                  : coniferTierId(tree.id, tierIndex),
                geometry: coniferTierGeometry,
                modelMatrix: makeTreeMatrix(
                  tree,
                  tier.centerZ,
                  tier.scaleX,
                  tier.scaleY,
                  tier.scaleZ,
                  tier.x,
                  tier.y,
                ),
                attributes: {
                  color:
                    ColorGeometryInstanceAttribute.fromColor(
                      getCrownLayerColor(
                        tree,
                        getCrownPartShade(
                          tree,
                          shape,
                          tierIndex,
                        ),
                      ),
                    ),
                  show: new ShowGeometryInstanceAttribute(isVisible),
                },
              }),
            );
          },
        );
      } else {
        crowns[shape].push(
          new GeometryInstance({
            id:
              tree.id,

            geometry:
              crownGeometries[shape],

            modelMatrix:
              makeTreeMatrix(
                tree,

                crownPlacement.centerZ,

                hasOrganicCrownLobes(
                  shape,
                )
                  ? crownRadiusX * 0.8
                  : crownRadiusX,

                hasOrganicCrownLobes(
                  shape,
                )
                  ? crownRadiusY * 0.8
                  : crownRadiusY,

                hasOrganicCrownLobes(
                  shape,
                )
                  ? crownPlacement.scaleZ * 0.88
                  : crownPlacement.scaleZ,
              ),

            attributes: {
              color:
                ColorGeometryInstanceAttribute.fromColor(
                  getCrownLayerColor(
                    tree,
                    getCrownPartShade(tree, shape, 0),
                  ),
                ),
              show: new ShowGeometryInstanceAttribute(isVisible),
            },
          }),
        );
      }

      if (
        hasOrganicCrownLobes(
          shape,
        )
      ) {
        /*
         * Trois volumes décalés donnent aux feuillus
         * un bord moins géométrique. Ils restent attachés à la
         * même Primitive, donc le coût de rendu demeure faible.
         */
        getOrganicCrownLobes(
          tree,
          crownRadiusX,
          crownRadiusY,
          crownHeight,
          crownPlacement.scaleZ,
        ).forEach(
          (lobe, lobeIndex) => {
            crowns[shape].push(
              new GeometryInstance({
                id: crownLobeId(
                  tree.id,
                  lobeIndex + 1,
                ),

                geometry: ellipsoidGeometry,

                modelMatrix: makeTreeMatrix(
                  tree,
                  crownPlacement.centerZ + lobe.z,
                  lobe.scaleX,
                  lobe.scaleY,
                  lobe.scaleZ,
                  lobe.x,
                  lobe.y,
                ),

                attributes: {
                  color:
                    ColorGeometryInstanceAttribute.fromColor(
                      getCrownLayerColor(
                        tree,
                        getCrownPartShade(
                          tree,
                          shape,
                          lobeIndex + 1,
                        ),
                      ),
                    ),
                  show: new ShowGeometryInstanceAttribute(isVisible),
                },
              }),
            );
          },
        );
      }
    }

    if (
      trunks.length > 0
    ) {
      const trunkPrimitive =
        new Primitive({
          geometryInstances:
            trunks,

          appearance:
            new PerInstanceColorAppearance(
              {
                flat: false,

                translucent:
                  false,

                closed:
                  true,
              },
            ),

          asynchronous:
            false,

          allowPicking:
            true,

          releaseGeometryInstances:
            false,
        });

      collection.add(
        trunkPrimitive,
      );

      trunkPrimitiveRef.current =
        trunkPrimitive;
    }

    const shapes:
      TreeShape[] = [
        "round",
        "conical",
        "columnar",
        "spreading",
        "compact",
      ];

    for (
      const shape of
      shapes
    ) {
      const instances =
        crowns[shape];

      if (
        instances.length === 0
      ) {
        continue;
      }

      const primitive =
        new Primitive({
          geometryInstances:
            instances,

          appearance:
            new PerInstanceColorAppearance(
              {
                flat: false,

                vertexShaderSource:
                  CROWN_TEXTURE_VERTEX_SHADER,

                fragmentShaderSource:
                  shape === "conical"
                    ? CONIFER_TEXTURE_FRAGMENT_SHADER
                    : CROWN_TEXTURE_FRAGMENT_SHADER,

                /*
                 * Pas de transparence :
                 * choix volontaire.
                 */
                translucent:
                  false,

                closed:
                  true,
              },
            ),

          asynchronous:
            false,

          allowPicking:
            true,

          releaseGeometryInstances:
            false,
        });

      collection.add(
        primitive,
      );

      crownPrimitivesRef.current[
        shape
      ] =
        primitive;
    }

    viewer.scene.requestRender();

    return () => {
      if (
        !viewer.isDestroyed() &&
        treePrimitivesRef.current ===
        collection
      ) {
        viewer.scene.primitives.remove(
          collection,
        );

        treePrimitivesRef.current =
          null;

        crownPrimitivesRef.current =
          {};

        trunkPrimitiveRef.current = null;

        trunkInstanceIdsByTreeRef.current.clear();

        treeVisibilityByIdRef.current.clear();

        treeShapeByIdRef.current.clear();

        crownColorStateByTreeRef.current.clear();
      }
    };
  }, [
    trees,
    revision,
  ]);

  /*
   * Les géométries restent en mémoire : un filtre ne modifie que l'attribut
   * `show` des instances concernées, au lieu de reconstruire la scène 3D.
   */
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const visibleIds = new Set(visibleTrees.map((tree) => tree.id));

    const setVisible = (
      primitive: Primitive | null | undefined,
      instanceId: string,
      isVisible: boolean,
    ) => {
      if (!primitive) return;

      try {
        const attributes = primitive.getGeometryInstanceAttributes(instanceId);
        if (attributes?.show) {
          attributes.show = ShowGeometryInstanceAttribute.toValue(
            isVisible,
            attributes.show,
          );
        }
      } catch {
        // Une primitive en cours d'initialisation sera reprise au postRender.
      }
    };

    const applyVisibility = () => {
      for (const tree of trees) {
        const isVisible = visibleIds.has(tree.id);
        if (treeVisibilityByIdRef.current.get(tree.id) === isVisible) continue;

        for (const instanceId of trunkInstanceIdsByTreeRef.current.get(tree.id) ?? []) {
          setVisible(trunkPrimitiveRef.current, instanceId, isVisible);
        }

        const shape = treeShapeByIdRef.current.get(tree.id);
        if (shape) {
          const crown = crownPrimitivesRef.current[shape];
          for (const instanceId of getCrownInstanceIds(tree, shape)) {
            setVisible(crown, instanceId, isVisible);
          }
        }

        treeVisibilityByIdRef.current.set(tree.id, isVisible);
      }

      viewer.scene.requestRender();
    };

    const primitives = [
      trunkPrimitiveRef.current,
      ...Object.values(crownPrimitivesRef.current),
    ].filter((primitive): primitive is Primitive => Boolean(primitive));

    if (primitives.every((primitive) => primitive.ready)) {
      applyVisibility();
      return;
    }

    const removeListener = viewer.scene.postRender.addEventListener(() => {
      const current = [
        trunkPrimitiveRef.current,
        ...Object.values(crownPrimitivesRef.current),
      ].filter((primitive): primitive is Primitive => Boolean(primitive));

      if (!current.every((primitive) => primitive.ready)) return;
      removeListener();
      applyVisibility();
    });

    viewer.scene.requestRender();
    return () => removeListener();
  }, [trees, visibleTrees, revision]);

  /*
   * Le viewer peut dessiner son premier fond avant que le plan et les arbres
   * soient réellement prêts. On garde l'écran de chargement jusqu'à deux
   * images complètes afin de ne jamais révéler une carte à moitié construite.
   */
  useEffect(() => {
    const viewer = viewerRef.current;
    setContentReady(false);

    if (!viewer || !plan || trees.length === 0) return;

    const startedAt = performance.now();
    const minimumLoadingDuration = 650;
    const sceneSettlingDuration = 350;
    let completeFrames = 0;
    let readyTimer: number | undefined;
    const removeListener = viewer.scene.postRender.addEventListener(() => {
      const primitives = [
        trunkPrimitiveRef.current,
        ...Object.values(crownPrimitivesRef.current),
      ].filter((primitive): primitive is Primitive => Boolean(primitive));

      const sceneIsComplete =
        primitives.length > 0 &&
        primitives.every((primitive) => primitive.ready) &&
        viewer.entities.values.length >= plan.features.length &&
        viewer.dataSourceDisplay.ready &&
        viewer.scene.globe.tilesLoaded;

      if (!sceneIsComplete) {
        completeFrames = 0;
        viewer.scene.requestRender();
        return;
      }

      completeFrames += 1;
      if (completeFrames < 4) {
        viewer.scene.requestRender();
        return;
      }

      removeListener();
      readyTimer = window.setTimeout(
        () => {
          setContentReady(true);
          onSceneReadyRef.current();
        },
        Math.max(
          sceneSettlingDuration,
          minimumLoadingDuration - (performance.now() - startedAt),
        ),
      );
    });

    viewer.scene.requestRender();
    return () => {
      removeListener();
      if (readyTimer !== undefined) window.clearTimeout(readyTimer);
    };
  }, [trees, plan, parkId, revision]);

  /*
   * Hover / sélection :
   *
   * on modifie uniquement la couleur
   * de l'instance. On ne reconstruit
   * jamais les géométries ici.
   */
  useEffect(() => {
    const viewer =
      viewerRef.current;

    if (!viewer) {
      return;
    }

    const activeHoveredTreeId =
      hoveredTreeId ??
      mapHoveredTreeId;

    const hoveredTree =
      trees.find(
        (tree) =>
          tree.id ===
          activeHoveredTreeId,
      ) ?? null;

    const highlightedTaxon =
      hoveredTree ??
      selectedTree;

    const applyColors =
      () => {
        for (
          const tree of trees
        ) {
          const shape =
            treeShapeByIdRef.current.get(
              tree.id,
            );

          if (!shape) {
            continue;
          }

          const primitive =
            crownPrimitivesRef.current[
            shape
            ];

          if (
            !primitive ||
            !primitive.ready
          ) {
            continue;
          }

          const highlight =
            treeHighlight(
              tree,

              selectedTree?.id ??
              null,

              highlightedTaxon,
            );

          if (
            crownColorStateByTreeRef.current.get(
              tree.id,
            ) === highlight
          ) {
            continue;
          }

          let highlightColor:
            | Color
            | null = null;

          if (
            highlight ===
            "selected"
          ) {
            highlightColor =
              TREE_SELECTED_COLOR;
          } else if (
            highlight ===
            "hovered"
          ) {
            highlightColor =
              TREE_HOVER_COLOR;
          } else if (
            highlight ===
            "same_species"
          ) {
            /*
             * Même taxon : une version
             * plus discrète de l'ambre
             * de l'arbre survolé.
             */
            highlightColor =
              getRelatedCrownColor(
                tree,
              );
          }

          const instanceIds =
            getCrownInstanceIds(
              tree,
              shape,
            );

          for (
            const [partIndex, instanceId] of
            instanceIds.entries()
          ) {
            let attributes;

            try {
              attributes =
                primitive.getGeometryInstanceAttributes(
                  instanceId,
                );
            } catch {
              continue;
            }

            if (
              !attributes?.color
            ) {
              continue;
            }

            attributes.color =
              ColorGeometryInstanceAttribute.toValue(
                highlightColor ??
                getCrownLayerColor(
                  tree,
                  getCrownPartShade(
                    tree,
                    shape,
                    partIndex,
                  ),
                ),
                attributes.color,
              );
          }

          crownColorStateByTreeRef.current.set(
            tree.id,
            highlight,
          );
        }

        viewer.scene.requestRender();
      };

    const primitives =
      Object.values(
        crownPrimitivesRef.current,
      ).filter(
        (
          primitive,
        ): primitive is Primitive =>
          Boolean(primitive),
      );

    if (
      primitives.every(
        (primitive) =>
          primitive.ready,
      )
    ) {
      applyColors();
      return;
    }

    const removeListener =
      viewer.scene.postRender.addEventListener(
        () => {
          const current =
            Object.values(
              crownPrimitivesRef.current,
            ).filter(
              (
                primitive,
              ): primitive is Primitive =>
                Boolean(
                  primitive,
                ),
            );

          if (
            !current.every(
              (primitive) =>
                primitive.ready,
            )
          ) {
            return;
          }

          removeListener();

          applyColors();
        },
      );

    viewer.scene.requestRender();

    return () => {
      removeListener();
    };
  }, [
    trees,
    visibleTrees,
    selectedTree,
    hoveredTreeId,
    mapHoveredTreeId,
    revision,
  ]);

  /*
   * Repère animé lors du survol depuis la liste :
   * la couronne devient ambrée et cette impulsion
   * matérialise rapidement son emprise au sol.
   */
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    viewer.entities.removeById("tree-hover-pulse");

    const activeHoveredTreeId = hoveredTreeId ?? mapHoveredTreeId;
    const hoveredTree = trees.find((tree) => tree.id === activeHoveredTreeId);
    if (!hoveredTree || selectedTree) {
      viewer.scene.requestRender();
      return;
    }

    const proportions = getTreeProportions(hoveredTree);
    const crownRadius = Math.max(proportions.crownRadiusX, proportions.crownRadiusY);
    const getPulseRadius = () => {
      const phase = (Math.sin(Date.now() / 120) + 1) / 2;
      return crownRadius * (1.08 + phase * 0.28);
    };
    // Cesium lit les deux axes séparément : une lecture de Date.now() dans
    // chaque callback peut rendre le petit axe supérieur au grand et arrêter
    // le rendu. Le rayon reste identique pendant toute la mise à jour de scène.
    let currentPulseRadius = getPulseRadius();
    const pulseRadius = new CallbackProperty(() => currentPulseRadius, false);

    viewer.entities.add({
      id: "tree-hover-pulse",
      position: Cartesian3.fromDegrees(hoveredTree.longitude, hoveredTree.latitude, PLAN_HEIGHT + 0.08),
      ellipse: {
        semiMajorAxis: pulseRadius,
        semiMinorAxis: pulseRadius,
        height: PLAN_HEIGHT + 0.08,
        material: TREE_HOVER_COLOR.withAlpha(0.18),
        outline: true,
        outlineColor: TREE_HOVER_COLOR,
      },
    });

    const renderTimer = window.setInterval(() => {
      currentPulseRadius = getPulseRadius();
      viewer.scene.requestRender();
    }, 50);
    return () => {
      window.clearInterval(renderTimer);
      if (!viewer.isDestroyed()) {
        viewer.entities.removeById("tree-hover-pulse");
        viewer.scene.requestRender();
      }
    };
  }, [trees, hoveredTreeId, mapHoveredTreeId, selectedTree, plan, revision]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    setParkView(
      viewer,
      plan?.bbox ?? PARK_PLAN_BOUNDS,
      viewMode,
      isMobile && (parkId === "oberthur" || parkId === "thabor") ? parkId : null,
    );
    viewer.scene.requestRender();
  }, [plan, revision]);

  /*
   * Le passage 2D/3D ne doit pas modifier le zoom ni le centre courant.
   * On ne change donc que l'inclinaison de la caméra.
   */
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const camera = viewer.camera;
    const centre = camera.pickEllipsoid(
      new Cartesian2(
        viewer.scene.canvas.clientWidth / 2,
        viewer.scene.canvas.clientHeight / 2,
      ),
      viewer.scene.globe.ellipsoid,
    );

    if (centre) {
      const range = Cartesian3.distance(camera.positionWC, centre);
      camera.lookAt(
        centre,
        new HeadingPitchRange(
          camera.heading,
          CesiumMath.toRadians(viewMode === "2d" ? -87 : -70),
          range,
        ),
      );
      camera.lookAtTransform(Matrix4.IDENTITY);
    } else {
      camera.setView({
        orientation: {
          heading: camera.heading,
          pitch: CesiumMath.toRadians(viewMode === "2d" ? -87 : -70),
          roll: camera.roll,
        },
      });
    }
    viewer.scene.requestRender();
  }, [viewMode]);

  /*
   * Bouton "Recentrer".
   */
  useEffect(() => {
    const viewer =
      viewerRef.current;

    if (
      !viewer ||
      recenter === 0
    ) {
      return;
    }

    viewer.camera.cancelFlight();

    setParkView(
      viewer,
      plan?.bbox ??
      PARK_PLAN_BOUNDS,
      viewMode,
      isMobile && (parkId === "oberthur" || parkId === "thabor") ? parkId : null,
    );

    viewer.scene.requestRender();
  }, [
    recenter,
    plan,
    viewMode,
    isMobile,
    parkId,
  ]);

  const changeZoom = (direction: "in" | "out") => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const camera = viewer.camera;
    const target = camera.pickEllipsoid(
      new Cartesian2(
        viewer.scene.canvas.clientWidth / 2,
        viewer.scene.canvas.clientHeight / 2,
      ),
      viewer.scene.globe.ellipsoid,
    );

    if (!target) {
      const distance = Math.max(12, camera.positionCartographic.height * 0.2);
      if (direction === "in") camera.zoomIn(distance);
      else camera.zoomOut(distance);
      viewer.scene.requestRender();
      return;
    }

    smoothZoomTo(
      viewer,
      target,
      direction === "in" ? 0.78 : 1.28,
    );
  };

  changeZoomInRef.current = () => changeZoom("in");

  const orientNorth = () => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.camera.setView({ orientation: { heading: 0, pitch: viewer.camera.pitch, roll: 0 } });
    viewer.scene.requestRender();
  };

  const centerOnLocation = (location: UserLocation) => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    shouldCenterOnLocationRef.current = false;
    viewer.camera.cancelFlight();
    viewer.camera.flyToBoundingSphere(
      new BoundingSphere(Cartesian3.fromDegrees(location.longitude, location.latitude), 70),
      {
        duration: 0.7,
        offset: new HeadingPitchRange(0, CesiumMath.toRadians(viewMode === "2d" ? -87 : -70), 150),
      },
    );
  };

  const locateUser = () => {
    setLocationRequest((request) => request + 1);
    if (!navigator.geolocation) {
      setLocationStatus("error");
      return;
    }

    shouldCenterOnLocationRef.current = true;
    setLocationStatus("locating");
    const requestId = ++locationRequestRef.current;

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (requestId !== locationRequestRef.current) return;
        const measurement = readLocation(position);
        if (!measurement) {
          shouldCenterOnLocationRef.current = false;
          setLocationStatus("imprecise");
          return;
        }

        if (!isNearCurrentPark(measurement, planRef.current)) {
          shouldCenterOnLocationRef.current = false;
          setLocationStatus(measurement.accuracy > PRECISE_LOCATION_METRES ? "imprecise" : "too-far");
          return;
        }

        setUserLocation(measurement);
        setLocationStatus("idle");
        if (shouldCenterOnLocationRef.current) centerOnLocation(measurement);
      },
      (error) => {
        if (requestId !== locationRequestRef.current) return;
        shouldCenterOnLocationRef.current = false;
        setLocationStatus(error.code === 1 ? "error" : "imprecise");
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );
  };

  const disableLocation = () => {
    locationRequestRef.current += 1;
    shouldCenterOnLocationRef.current = false;
    setUserLocation(null);
    setLocationStatus("idle");
    setLocationNoticeVisible(false);
  };

  const startLocationLongPress = () => {
    if (!userLocation) return;
    locationLongPressRef.current = window.setTimeout(() => {
      locationLongPressRef.current = null;
      ignoreLocationClickRef.current = true;
      disableLocation();
    }, 650);
  };

  const cancelLocationLongPress = (cancelled = false) => {
    if (locationLongPressRef.current !== null) {
      window.clearTimeout(locationLongPressRef.current);
      locationLongPressRef.current = null;
    }
    if (cancelled) ignoreLocationClickRef.current = false;
  };

  return (
    <>
      <div
        ref={elementRef}
        className="cesium-map"
        data-map-state={
          phase
        }
        data-visible-count={
          visibleTrees.length
        }
        data-plan-features={
          plan?.features.length ??
          0
        }
        aria-label="Carte interactive du Parc Oberthür"
      />

      <div
        ref={creditsRef}
        className="map-credits"
      />

      <div
        className={`map-scene-loading ${phase === "error" || (phase === "ready" && contentReady && !isParkTransitioning) ? "is-ready" : ""}`}
        aria-hidden={phase === "error" || (phase === "ready" && contentReady && !isParkTransitioning)}
        role="status"
      >
        <div className="map-scene-loading-tree" aria-hidden="true">
          <i className="map-scene-loading-crown is-back" />
          <i className="map-scene-loading-crown is-front" />
          <i className="map-scene-loading-trunk" />
        </div>
        <p>Préparation du parc</p>
        <span>Plan, arbres et reliefs</span>
      </div>

      <div className={`map-navigation ${selectedTree ? "is-tree-open" : ""} ${isMobilePanelOpen ? "is-mobile-panel-open" : ""}`} aria-label="Navigation de la carte">
        <button type="button" className={`map-locate-button ${userLocation ? "is-active" : ""}`} onClick={() => {
          if (ignoreLocationClickRef.current) {
            ignoreLocationClickRef.current = false;
            return;
          }
          locateUser();
        }} onPointerDown={startLocationLongPress} onPointerUp={() => cancelLocationLongPress()} onPointerLeave={() => cancelLocationLongPress(true)} onPointerCancel={() => cancelLocationLongPress(true)} aria-label="Me localiser" title="Me localiser — maintenir appuyé pour désactiver">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="7.5" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>
        </button>
        <button type="button" className="map-recenter-button" onClick={onRecenter} aria-label="Recentrer la carte sur le parc" title="Recentrer sur le parc">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /><path d="M9 14.5 12 8l3 6.5M10.2 12h3.6" /></svg>
        </button>
        <button type="button" className="map-compass" onClick={orientNorth} aria-label="Orienter la carte vers le nord">
          <span className="compass-dial" aria-hidden="true" style={{ transform: `rotate(${-cameraHeading}rad)` }}>
            <span className="compass-north-label">N</span><svg viewBox="0 0 24 24"><path className="compass-north" d="m12 3.5 4.3 10.2-4.3-2-4.3 2L12 3.5Z" /><path className="compass-south" d="m12 20.5-4.3-10.2 4.3 2 4.3-2L12 20.5Z" /></svg>
          </span>
        </button>
        <button type="button" className="map-dimension-button" onClick={onChangeViewMode} aria-label={`Passer en vue ${viewMode === "3d" ? "2D" : "3D"}`}>{viewMode.toUpperCase()}</button>
        <div className="map-zoom-controls">
          <button type="button" className="map-control-button" onClick={() => changeZoom("in")} aria-label="Zoomer"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></button>
          <button type="button" className="map-control-button" onClick={() => changeZoom("out")} aria-label="Dézoomer"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg></button>
        </div>
      </div>

      {locationStatus === "locating" && <p className="map-location-notice" role="status">Localisation en cours…</p>}
      {locationNoticeVisible && locationStatus === "imprecise" && <p className="map-location-notice" role="status">Position non obtenue pour le parc. Relancez la localisation si besoin.</p>}
      {locationNoticeVisible && locationStatus === "stale" && <p className="map-location-notice" role="status">Dernière position connue. Relancez la localisation pour l’actualiser.</p>}
      {locationStatus === "idle" && userLocation && <p className="map-location-notice" role="status">{userLocation.accuracy > PRECISE_LOCATION_METRES ? "Position approximative. " : ""}Précision estimée : {Math.ceil(userLocation.accuracy)} m. Le cercle indique la zone d’incertitude.</p>}
      {locationNoticeVisible && locationStatus === "too-far" && <p className="map-location-notice is-error" role="alert">Vous êtes trop loin du parc affiché.</p>}
      {locationNoticeVisible && locationStatus === "error" && <p className="map-location-notice is-error" role="alert">La position n’a pas pu être obtenue. Vérifiez l’autorisation de localisation.</p>}

      {tooltip && (
        <div
          className="map-tooltip"
          style={{
            left: tooltip.x + 13,
            top: tooltip.y - 10,
          }}
          role="status"
        >
          <strong>
            {tooltip.name}
            {tooltip.count !== undefined && ` (${tooltip.count})`}
          </strong>

          <br />

          {tooltip.height != null && (
            <>↕ {tooltip.height} m</>
          )}

          {tooltip.circumference != null && (
            <> · ⟳ {tooltip.circumference} cm</>
          )}

          {tooltip.crownDiameter != null && (
            <> · ⌀ {tooltip.crownDiameter} m</>
          )}
        </div>
      )}

      {phase ===
        "error" && (
          <div
            className="map-notice"
            role="alert"
          >
            <p>
              La carte 3D est
              indisponible.
              Vérifiez que WebGL
              est activé ; la
              liste et les fiches
              restent accessibles.
            </p>

            <button
              onClick={() =>
                setRevision(
                  (value) =>
                    value + 1,
                )
              }
            >
              Réessayer la carte
            </button>
          </div>
        )}
    </>
  );
}
