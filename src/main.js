import {
  Viewer,
  Ion,
  IonResource,
  Cartesian3,
  IonGeocodeProviderType,
  createGooglePhotorealistic3DTileset,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Color,
  Cartographic,
  Transforms,
  Matrix4,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import "./style.css";

const cesiumToken = import.meta.env.VITE_CESIUM_ION_ACCESS_TOKEN;
Ion.defaultAccessToken = cesiumToken;

const viewer = new Viewer("cesiumContainer", {
  baseLayerPicker: false,
  homeButton: false,
  navigationHelpButton: false,
  timeline: false,
  animation: false,
  fullscreenButton: false,
  sceneModePicker: false,
  selectionIndicator: false,
  geocoder: IonGeocodeProviderType.GOOGLE,
  globe: false,
});

viewer.scene.skyAtmosphere.show = true;

const placedObjects = [];
let connectMode = false;
let selectedObjects = [];

const placeObjectBtn = document.getElementById("placeObjectBtn");
const connectObjectsBtn = document.getElementById("connectObjectsBtn");
// Controls
const sagRatioInput = document.getElementById("sagRatio");
const cableLengthInput = document.getElementById("cableLength");
const cablePresetSelect = document.getElementById("cablePreset");
const lineModeSelect = document.getElementById("lineMode");
const linearWeightInput = document.getElementById("linearWeight");
const hTensionInput = document.getElementById("hTension");

let placeMode = false;
const handler = new ScreenSpaceEventHandler(viewer.canvas);

placeObjectBtn.addEventListener("click", function () {
  placeMode = true;
  connectMode = false;
  selectedObjects = [];
  viewer.canvas.style.cursor = "crosshair";
});

connectObjectsBtn.addEventListener("click", function () {
  connectMode = true;
  placeMode = false;
  selectedObjects = [];
  viewer.canvas.style.cursor = "crosshair";
});

handler.setInputAction(async function (click) {
  if (placeMode) {
    const pickPosition = viewer.scene.pickPosition(click.position);
    if (pickPosition) {
      try {
        const resource = await IonResource.fromAssetId(3512572);
        const entity = viewer.entities.add({
          position: pickPosition,
          model: { uri: resource, scale: 7 },
        });
        placedObjects.push(entity);
      } catch (err) {
        console.error("Failed to place object:", err);
      }
      // exit place mode
      placeMode = false;
      viewer.canvas.style.cursor = "";
    }
  } else if (connectMode) {
    const picked = viewer.scene.pick(click.position);
    if (picked && picked.id && placedObjects.includes(picked.id)) {
      selectedObjects.push(picked.id);

      if (selectedObjects.length === 1) {
        picked.id.model.color = Color.CYAN;
      }

      if (selectedObjects.length === 2) {
        const entity1 = selectedObjects[0];
        const entity2 = selectedObjects[1];

        entity1.model.color = Color.WHITE;

        // Create transmission line with sag between the two objects
        // Add vertical offset to connect at the top of the towers
        const towerHeight = 40; // Adjust this value based on your model height
        const entity1TopPos = Cartesian3.clone(entity1.position._value);
        const entity2TopPos = Cartesian3.clone(entity2.position._value);

        // Convert to cartographic to add height offset
        const entity1Cartographic = Cartographic.fromCartesian(entity1TopPos);
        const entity2Cartographic = Cartographic.fromCartesian(entity2TopPos);

        // Add height offset
        entity1Cartographic.height += towerHeight;
        entity2Cartographic.height += towerHeight;

        // Convert back to Cartesian3
        const entity1OffsetPos = Cartesian3.fromRadians(
          entity1Cartographic.longitude,
          entity1Cartographic.latitude,
          entity1Cartographic.height,
        );
        const entity2OffsetPos = Cartesian3.fromRadians(
          entity2Cartographic.longitude,
          entity2Cartographic.latitude,
          entity2Cartographic.height,
        );

        // Gather UI parameters
        const sagRatio = parseFloat(sagRatioInput?.value ?? "0.06");
        const lengthVal = parseFloat(cableLengthInput?.value ?? "");
        const lengthMeters =
          Number.isFinite(lengthVal) && lengthVal > 0 ? lengthVal : undefined;
        const preset = cablePresetSelect?.value || "custom";
        const linearWeight = parseFloat(linearWeightInput?.value ?? "30");
        const hTension = parseFloat(hTensionInput?.value ?? "15000");
        const mode = lineModeSelect?.value || "physics";

        // Presets can override defaults (future refinement could map to real values)
        const presetMap = {
          acsr: { defaultSag: 0.05 },
          aaac: { defaultSag: 0.06 },
          steel: { defaultSag: 0.04 },
          custom: { defaultSag: sagRatio },
        };
        const chosen = presetMap[preset] || presetMap.custom;
        const usedSag = Number.isFinite(sagRatio)
          ? sagRatio
          : chosen.defaultSag;

        const options = {
          numPoints: 96,
          sagRatio: usedSag,
          lengthMeters,
          linearWeight,
          hTension,
          mode,
        };

        const transmissionLinePositions = createTransmissionLine(
          entity1OffsetPos,
          entity2OffsetPos,
          options,
        );

        viewer.entities.add({
          polyline: {
            positions: transmissionLinePositions,
            width: 3,
            material: Color.WHITE,
            clampToGround: false,
          },
        });

        console.log("Transmission line created with realistic sag");

        connectMode = false;
        selectedObjects = [];
        viewer.canvas.style.cursor = "";
      }
    }
  }
}, ScreenSpaceEventType.LEFT_CLICK);

try {
  const tileset = await createGooglePhotorealistic3DTileset({
    onlyUsingWithGoogleGeocoder: true,
  });
  viewer.scene.primitives.add(tileset);
} catch (error) {
  console.log(`Failed to load tileset: ${error}`);
}

// Function to create a true catenary between two supports (handles uneven heights)
function createTransmissionLine(startPos, endPos, options = {}) {
  const numPoints = options.numPoints ?? 64;
  const sagRatio = options.sagRatio ?? 0.06; // used in sag mode
  const lengthMeters = options.lengthMeters; // optional: total cable length (length mode)
  const linearWeight = options.linearWeight ?? 30; // N/m
  const hTension = options.hTension ?? 15000; // N (horizontal component)
  const mode = options.mode ?? "physics"; // physics | length | sag

  // Build a stable local frame (ENU) around the midpoint
  const mid = Cartesian3.midpoint(startPos, endPos, new Cartesian3());
  const enu = Transforms.eastNorthUpToFixedFrame(mid);
  const invEnu = Matrix4.inverse(enu, new Matrix4());

  const p0 = Matrix4.multiplyByPoint(invEnu, startPos, new Cartesian3());
  const p1 = Matrix4.multiplyByPoint(invEnu, endPos, new Cartesian3());

  // Align horizontal baseline along local X-Y plane; vertical is Z
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const L = Math.hypot(dx, dy);
  if (L < 0.1) {
    return [startPos, endPos];
  }
  const dirX = dx / L;
  const dirY = dy / L;
  const z0 = p0.z;
  const z1 = p1.z;
  const dz = z1 - z0;
  const chordLen = Math.hypot(L, dz);

  // Helper: build positions from catenary params (a,b,c)
  function buildPositionsFromParams(a, b, c) {
    const positions = [];
    for (let i = 0; i <= numPoints; i++) {
      const t = i / numPoints;
      const x = t * L;
      const z = a * Math.cosh((x - b) / a) + c;
      const xLocal = p0.x + dirX * x;
      const yLocal = p0.y + dirY * x;
      const local = new Cartesian3(xLocal, yLocal, z);
      positions.push(Matrix4.multiplyByPoint(enu, local, new Cartesian3()));
    }
    return positions;
  }

  // Mode: physics — compute a from H/w; solve b from endpoints; auto length
  if (mode === "physics") {
    const a = hTension / Math.max(1e-6, linearWeight);
    // Solve b so that z(L) - z(0) = dz
    const D = dz;
    const solveB = () => {
      const fb = (b) => a * (Math.cosh((L - b) / a) - Math.cosh(-b / a)) - D;
      let lo = -L * 10;
      let hi = L * 10;
      let fLo = fb(lo);
      let fHi = fb(hi);
      let expand = 0;
      while (
        (fLo * fHi > 0 || !isFinite(fLo) || !isFinite(fHi)) &&
        expand < 30
      ) {
        lo *= 2;
        hi *= 2;
        fLo = fb(lo);
        fHi = fb(hi);
        expand++;
      }
      if (fLo * fHi > 0 || !isFinite(fLo) || !isFinite(fHi)) {
        return 0;
      }
      for (let i = 0; i < 60; i++) {
        const bm = 0.5 * (lo + hi);
        const f = fb(bm);
        if (Math.abs(f) < 1e-5) {
          return bm;
        }
        if (f * fLo < 0) {
          hi = bm;
          fHi = f;
        } else {
          lo = bm;
          fLo = f;
        }
      }
      return 0.5 * (lo + hi);
    };
    const b = solveB();
    const c = z0 - a * Math.cosh(-b / a);
    return buildPositionsFromParams(a, b, c);
  }

  // Mode: length — solve a to match cable length, then b,c
  if (
    mode === "length" &&
    typeof lengthMeters === "number" &&
    isFinite(lengthMeters) &&
    lengthMeters > 0
  ) {
    // If requested length is shorter than straight chord, clamp
    const S = Math.max(lengthMeters, chordLen + 1e-6);
    const D = dz;

    const solveBForA = (a) => {
      const fb = (b) => {
        const u0 = -b / a;
        const u1 = (L - b) / a;
        return a * (Math.cosh(u1) - Math.cosh(u0)) - D;
      };
      let lo = -L * 10;
      let hi = L * 10;
      let fLo = fb(lo);
      let fHi = fb(hi);
      let expand = 0;
      while (
        (fLo * fHi > 0 || !isFinite(fLo) || !isFinite(fHi)) &&
        expand < 30
      ) {
        lo *= 2;
        hi *= 2;
        fLo = fb(lo);
        fHi = fb(hi);
        expand++;
      }
      if (fLo * fHi > 0 || !isFinite(fLo) || !isFinite(fHi)) {
        return null;
      }
      for (let i = 0; i < 60; i++) {
        const bm = 0.5 * (lo + hi);
        const f = fb(bm);
        if (Math.abs(f) < 1e-5) {
          return bm;
        }
        if (f * fLo < 0) {
          hi = bm;
          fHi = f;
        } else {
          lo = bm;
          fLo = f;
        }
      }
      return 0.5 * (lo + hi);
    };

    const lengthResidual = (a) => {
      const b = solveBForA(a);
      if (b === null) {
        return Number.POSITIVE_INFINITY;
      }
      const u1 = (L - b) / a;
      const S_pred = a * (Math.sinh(u1) + Math.sinh(b / a));
      return S_pred - S;
    };

    // Bracket a
    let aLo = Math.max(0.01, L * 0.001);
    let aHi = L * 1000;
    let fLo = lengthResidual(aLo);
    let fHi = lengthResidual(aHi);
    let guard = 0;
    while ((fLo * fHi > 0 || !isFinite(fLo) || !isFinite(fHi)) && guard < 20) {
      if (!isFinite(fLo) || Math.abs(fLo) > Math.abs(fHi)) {
        aLo *= 0.5;
        fLo = lengthResidual(aLo);
      } else {
        aHi *= 2;
        fHi = lengthResidual(aHi);
      }
      guard++;
    }
    if (fLo * fHi > 0 || !isFinite(fLo) || !isFinite(fHi)) {
      // Fallback to sag-based if we failed to bracket
      // eslint-disable-next-line no-use-before-define
      return createSagBased();
    }
    // Solve a by bisection
    let a = 0.5 * (aLo + aHi);
    for (let i = 0; i < 60; i++) {
      const f = lengthResidual(a);
      if (Math.abs(f) < 1e-4) {
        break;
      }
      if (f * fLo < 0) {
        aHi = a;
        fHi = f;
      } else {
        aLo = a;
        fLo = f;
      }
      a = 0.5 * (aLo + aHi);
    }
    const b = solveBForA(a);
    if (b === null) {
      // eslint-disable-next-line no-use-before-define
      return createSagBased();
    }
    const c = z0 - a * Math.cosh(-b / a);
    return buildPositionsFromParams(a, b, c);
  }

  // Sag-based (no cable length provided): target sag at mid-span
  function createSagBased() {
    const lineMid = z0 + dz / 2;
    function solveP(a) {
      const target = dz;
      function g(p) {
        const u = p / a;
        const v = (L - p) / a;
        return a * (Math.cosh(v) - Math.cosh(u)) - target;
      }
      let lo = -L * 4;
      let hi = L * 4;
      let fLo = g(lo);
      let fHi = g(hi);
      let expand = 0;
      while (fLo * fHi > 0 && expand < 20) {
        lo *= 2;
        hi *= 2;
        fLo = g(lo);
        fHi = g(hi);
        expand++;
      }
      if (fLo * fHi > 0 || !isFinite(fLo) || !isFinite(fHi)) {
        return null;
      }
      for (let i = 0; i < 50; i++) {
        const midp = 0.5 * (lo + hi);
        const f = g(midp);
        if (Math.abs(f) < 1e-5) {
          return midp;
        }
        if (f * fLo < 0) {
          hi = midp;
          fHi = f;
        } else {
          lo = midp;
          fLo = f;
        }
      }
      return 0.5 * (lo + hi);
    }
    function h(a) {
      const p = solveP(a);
      if (p === null) {
        return Number.POSITIVE_INFINITY;
      }
      const uMid = (L / 2 - p) / a;
      const u0 = -p / a;
      const zMid = a * Math.cosh(uMid) + (z0 - a * Math.cosh(u0));
      return lineMid - zMid - sagRatio * L;
    }
    let aLo = Math.max(0.1, L * 0.01);
    let aHi = L * 100;
    let fLo = h(aLo);
    let fHi = h(aHi);
    let tries = 0;
    while (!isFinite(fLo) && tries < 5) {
      aLo *= 0.5;
      fLo = h(aLo);
      tries++;
    }
    tries = 0;
    while (!isFinite(fHi) && tries < 5) {
      aHi *= 2;
      fHi = h(aHi);
      tries++;
    }
    let expand = 0;
    while (fLo * fHi > 0 && expand < 20) {
      if (Math.abs(fLo) < Math.abs(fHi)) {
        aHi *= 2;
        fHi = h(aHi);
      } else {
        aLo *= 0.5;
        fLo = h(aLo);
      }
      expand++;
    }
    if (fLo * fHi > 0 || !isFinite(fLo) || !isFinite(fHi)) {
      // last resort: simple parabola
      const positions = [];
      for (let i = 0; i <= numPoints; i++) {
        const t = i / numPoints;
        const x = t * L;
        const yLine = z0 + dz * t;
        const sag = sagRatio * L * (4 * t * (1 - t));
        const z = yLine - sag;
        const xLocal = p0.x + dirX * x;
        const yLocal = p0.y + dirY * x;
        const local = new Cartesian3(xLocal, yLocal, z);
        positions.push(Matrix4.multiplyByPoint(enu, local, new Cartesian3()));
      }
      return positions;
    }
    let a = 0.5 * (aLo + aHi);
    for (let i = 0; i < 40; i++) {
      const f = h(a);
      if (Math.abs(f) < 1e-4) {
        break;
      }
      if (f * fLo < 0) {
        aHi = a;
        fHi = f;
      } else {
        aLo = a;
        fLo = f;
      }
      a = 0.5 * (aLo + aHi);
    }
    const p = solveP(a);
    if (p === null) {
      // last resort: simple parabola again
      const positions = [];
      for (let i = 0; i <= numPoints; i++) {
        const t = i / numPoints;
        const x = t * L;
        const yLine = z0 + dz * t;
        const sag = sagRatio * L * (4 * t * (1 - t));
        const z = yLine - sag;
        const xLocal = p0.x + dirX * x;
        const yLocal = p0.y + dirY * x;
        const local = new Cartesian3(xLocal, yLocal, z);
        positions.push(Matrix4.multiplyByPoint(enu, local, new Cartesian3()));
      }
      return positions;
    }
    const c = z0 - a * Math.cosh(-p / a);
    return buildPositionsFromParams(a, p, c);
  }

  return createSagBased();
}
