import {
  Viewer,
  Ion,
  createGooglePhotorealistic3DTileset,
  JulianDate,
  ClockRange,
  ClockStep,
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
