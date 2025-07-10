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

        const transmissionLinePositions = createTransmissionLine(
          entity1OffsetPos,
          entity2OffsetPos,
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

// Function to create a sagging transmission line between two points
function createTransmissionLine(startPos, endPos) {
  // Calculate distance for sag calculation
  const distance = Cartesian3.distance(startPos, endPos);

  // Sag parameters - adjust these for different sag amounts
  const sagFactor = 0.1; // How much the line sags (0.1 = 10% of span)
  const numPoints = 50; // Number of points for smooth curve

  const positions = [];

  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;

    // Linear interpolation between start and end positions
    const interpolatedPos = Cartesian3.lerp(
      startPos,
      endPos,
      t,
      new Cartesian3(),
    );
    const interpolatedCartographic =
      Cartographic.fromCartesian(interpolatedPos);

    // Calculate sag using parabolic approximation of catenary
    // Maximum sag occurs at the middle (t = 0.5)
    const sagAmount = sagFactor * distance * (4 * t * (1 - t));

    // Apply sag downward from the linear interpolation
    interpolatedCartographic.height -= sagAmount;

    // Convert back to Cartesian3
    const saggedPos = Cartesian3.fromRadians(
      interpolatedCartographic.longitude,
      interpolatedCartographic.latitude,
      interpolatedCartographic.height,
    );

    positions.push(saggedPos);
  }

  return positions;
}
