import {
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  IonResource,
  Color,
  ColorMaterialProperty,
  Cartesian3,
  Cartographic,
  CallbackProperty,
  Cartesian2,
  VerticalOrigin,
  DistanceDisplayCondition,
} from "cesium";
import { createTransmissionLine } from "../utils/catenary.js";

export class InteractionManager {
  constructor(viewer, uiManager, weatherManager) {
    this.viewer = viewer;
    this.uiManager = uiManager;
    this.weatherManager = weatherManager;
    this.handler = new ScreenSpaceEventHandler(viewer.canvas);
    this.placedObjects = [];
    this.selectedObjects = [];
    this.placeMode = false;
    this.connectMode = false;
    this.lines = [];

    this.initialize();
  }

  initialize() {
    this.handler.setInputAction(
      this.handleInput.bind(this),
      ScreenSpaceEventType.LEFT_CLICK,
    );
  }

  enablePlaceMode() {
    this.placeMode = true;
    this.connectMode = false;
    this.selectedObjects = [];
    this.viewer.canvas.style.cursor = "crosshair";
  }

  enableConnectMode() {
    this.connectMode = true;
    this.placeMode = false;
    this.selectedObjects = [];
    this.viewer.canvas.style.cursor = "crosshair";
  }

  resetMode() {
    this.placeMode = false;
    this.connectMode = false;
    this.selectedObjects = [];
    this.viewer.canvas.style.cursor = "";
  }

  async handleInput(click) {
    if (this.placeMode) {
      await this.handlePlaceObject(click);
    } else if (this.connectMode) {
      this.handleConnectObject(click);
    }
  }

  async handlePlaceObject(click) {
    const pickPosition = this.viewer.scene.pickPosition(click.position);
    if (pickPosition) {
      try {
        const resource = await IonResource.fromAssetId(3512572);
        const entity = this.viewer.entities.add({
          position: pickPosition,
          model: { uri: resource, scale: 7 },
        });
        this.placedObjects.push(entity);

        // Fetch weather data for this location if not already loaded
        if (!this.weatherManager.weatherData) {
          const cartographic = Cartographic.fromCartesian(pickPosition);
          const lat = (cartographic.latitude * 180) / Math.PI;
          const lon = (cartographic.longitude * 180) / Math.PI;

          // Show loading indicator (simple console log for now, could be UI toast)
          console.log("Fetching weather data...");
          document.body.style.cursor = "wait";

          await this.weatherManager.fetchWeatherData(lat, lon);

          document.body.style.cursor = "default";
          console.log("Weather data ready.");
        }
      } catch (err) {
        console.error("Failed to place object:", err);
        document.body.style.cursor = "default";
      }
      this.resetMode();
    }
  }

  handleConnectObject(click) {
    const picked = this.viewer.scene.pick(click.position);
    if (picked && picked.id && this.placedObjects.includes(picked.id)) {
      this.selectedObjects.push(picked.id);

      if (this.selectedObjects.length === 1) {
        picked.id.model.color = Color.CYAN;
      }

      if (this.selectedObjects.length === 2) {
        this.createConnection();
      }
    }
  }

  createConnection() {
    const entity1 = this.selectedObjects[0];
    const entity2 = this.selectedObjects[1];

    entity1.model.color = Color.WHITE;

    const towerHeight = 40;
    const entity1TopPos = Cartesian3.clone(entity1.position._value);
    const entity2TopPos = Cartesian3.clone(entity2.position._value);

    const entity1Cartographic = Cartographic.fromCartesian(entity1TopPos);
    const entity2Cartographic = Cartographic.fromCartesian(entity2TopPos);

    entity1Cartographic.height += towerHeight;
    entity2Cartographic.height += towerHeight;

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

    const options = this.uiManager.getLineOptions();

    const initialPositions = createTransmissionLine(
      entity1OffsetPos,
      entity2OffsetPos,
      options,
    );

    // Calculate arc length of the initial curve
    let initialLength = 0;
    for (let i = 0; i < initialPositions.length - 1; i++) {
      initialLength += Cartesian3.distance(
        initialPositions[i],
        initialPositions[i + 1],
      );
    }

    const lineData = {
      start: entity1OffsetPos,
      end: entity2OffsetPos,
      refLength: initialLength,
      refTemp: 20,
      alpha: options.alpha,
      options: { ...options, mode: "length" },
      lastTemp: null,
    };

    const midPoint = Cartesian3.midpoint(
      entity1OffsetPos,
      entity2OffsetPos,
      new Cartesian3(),
    );

    this.viewer.entities.add({
      position: midPoint,
      polyline: {
        positions: new CallbackProperty((time) => {
          return this.updateLineGeometry(lineData, time);
        }, false),
        width: 3,
        material: new ColorMaterialProperty(
          new CallbackProperty((time) => {
            return this.getLineColor(lineData.lastTemp || 20);
          }, false),
        ),
        clampToGround: false,
      },
      label: {
        text: new CallbackProperty(() => {
          const temp = lineData.lastTemp !== null ? lineData.lastTemp : 20;
          const meta = lineData.lastMetadata || {};
          const sag = meta.sag ? meta.sag.toFixed(2) : "0.00";
          const tension = meta.hTension ? Math.round(meta.hTension) : 0;
          const name = lineData.options.name || "Conductor";

          return `${name}\nTemp: ${temp.toFixed(1)}°C\nSag: ${sag} m\nTension: ${tension} N`;
        }, false),
        font: "14px monospace",
        fillColor: Color.WHITE,
        showBackground: true,
        backgroundColor: new Color(0.1, 0.1, 0.1, 0.7),
        verticalOrigin: VerticalOrigin.BOTTOM,
        pixelOffset: new Cartesian2(0, -20),
        distanceDisplayCondition: new DistanceDisplayCondition(0, 3000),
      },
    });

    this.lines.push(lineData);

    console.log(
      `Transmission line created. Ref Length: ${initialLength.toFixed(2)}m @ 20°C`,
    );
    this.resetMode();
  }

  getLineColor(temp) {
    if (temp <= 20) {
      let t = (temp - -10) / (20 - -10);
      t = Math.max(0, Math.min(1, t));
      return new Color(t, t, 1, 1.0);
    }

    let t = (temp - 20) / (100 - 20);
    t = Math.max(0, Math.min(1, t));
    return new Color(1, 1 - t, 1 - t, 1.0);
  }

  updateLineGeometry(lineData, time) {
    const ambientTemp = this.weatherManager.getTemperatureAtTime(time);

    const loadHeating = parseFloat(this.uiManager.loadHeatingInput?.value || 0);

    let multiplier = 1;
    if (this.uiManager.thermalMultiplierInput) {
      multiplier = parseFloat(this.uiManager.thermalMultiplierInput.value);
    } else {
      const el = document.getElementById("thermalMultiplier");
      if (el) {
        multiplier = parseFloat(el.value);
      }
    }
    if (isNaN(multiplier)) {
      multiplier = 1;
    }

    const totalTemp = ambientTemp + loadHeating;

    if (
      lineData.lastTemp !== null &&
      Math.abs(totalTemp - lineData.lastTemp) < 0.1 &&
      lineData.lastMultiplier === multiplier
    ) {
      return lineData.lastPositions;
    }

    //thermal Expansion: L = L_ref * (1 + alpha * (T - T_ref))
    const alpha = lineData.alpha || 0.00002061;
    const newLength =
      lineData.refLength *
      (1 + alpha * (totalTemp - lineData.refTemp) * multiplier);

    console.log(
      `[Interaction] Temp: ${totalTemp.toFixed(1)}, Mult: ${multiplier}, Alpha: ${alpha}, RefLen: ${lineData.refLength.toFixed(3)}, NewLen: ${newLength.toFixed(3)}`,
    );

    lineData.options.lengthMeters = newLength;

    const positions = createTransmissionLine(
      lineData.start,
      lineData.end,
      lineData.options,
    );

    lineData.lastPositions = positions;
    lineData.lastTemp = totalTemp;
    lineData.lastMultiplier = multiplier;
    lineData.lastMetadata = positions.metadata;

    return positions;
  }
}
