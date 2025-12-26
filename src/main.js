import {
  Viewer,
  Ion,
  createGooglePhotorealistic3DTileset,
  JulianDate,
  ClockRange,
  ClockStep,
  Cartesian3,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import "./style.css";
import { UIManager } from "./managers/UIManager.js";
import { InteractionManager } from "./managers/InteractionManager.js";
import { WeatherManager } from "./managers/WeatherManager.js";

const cesiumToken = import.meta.env.VITE_CESIUM_ION_ACCESS_TOKEN;
Ion.defaultAccessToken = cesiumToken;

const viewer = new Viewer("cesiumContainer", {
  baseLayerPicker: false,
  homeButton: false,
  navigationHelpButton: false,
  timeline: true,
  animation: true,
  fullscreenButton: false,
  sceneModePicker: false,
  selectionIndicator: false,
  geocoder: false,
  globe: false,
});

viewer.scene.skyAtmosphere.show = true;

// Configure Clock for Simulation
const start = JulianDate.fromIso8601("2023-01-01T00:00:00Z");
const stop = JulianDate.fromIso8601("2023-12-31T23:59:59Z");
viewer.clock.startTime = start.clone();
viewer.clock.stopTime = stop.clone();
viewer.clock.currentTime = start.clone();
viewer.clock.clockRange = ClockRange.LOOP_STOP;
viewer.clock.multiplier = 3600 * 24; //1 day per second
viewer.clock.clockStep = ClockStep.SYSTEM_CLOCK_MULTIPLIER;
viewer.timeline.zoomTo(start, stop);

const uiManager = new UIManager();
const weatherManager = new WeatherManager();
const interactionManager = new InteractionManager(
  viewer,
  uiManager,
  weatherManager,
);

uiManager.setupEventListeners({
  onPlace: () => interactionManager.enablePlaceMode(),
  onConnect: () => interactionManager.enableConnectMode(),
});

try {
  const tileset = await createGooglePhotorealistic3DTileset({
    onlyUsingWithGoogleGeocoder: true,
  });
  viewer.scene.primitives.add(tileset);
} catch (error) {
  console.log(`Failed to load tileset: ${error}`);
}

const loadingOverlay = document.getElementById("loadingOverlay");
if (loadingOverlay) {
  loadingOverlay.style.opacity = "0";
  setTimeout(() => {
    loadingOverlay.style.display = "none";
  }, 500);
}

const toolbar = document.getElementById("toolbar");
const controls = document.getElementById("lineControls");
if (toolbar) {
  toolbar.style.display = "";
}
if (controls) {
  controls.style.display = "";
}

// Initial Scene Setup
async function setupInitialScene() {
  // 1. Set Camera View (Rio de Janeiro)
  viewer.camera.setView({
    destination: Cartesian3.fromDegrees(-43.169665, -22.962251, 273.32),
    orientation: {
      heading: 1.4466,
      pitch: -0.2758,
      roll: 0.0,
    },
  });

  // 2. Place 3 Towers (Rio de Janeiro)
  const t1Pos = Cartesian3.fromDegrees(-43.162677, -22.963348, 130.06);
  const t2Pos = Cartesian3.fromDegrees(-43.162133, -22.960038, 126.96);
  const t3Pos = Cartesian3.fromDegrees(-43.16682, -22.95864, 174.56);

  const t1 = await interactionManager.placeTower(t1Pos);
  const t2 = await interactionManager.placeTower(t2Pos);
  const t3 = await interactionManager.placeTower(t3Pos);

  // 3. Connect Towers
  if (t1 && t2) {
    interactionManager.createConnection(t1, t2);
  }
  if (t2 && t3) {
    interactionManager.createConnection(t2, t3);
  }
}

setupInitialScene();
