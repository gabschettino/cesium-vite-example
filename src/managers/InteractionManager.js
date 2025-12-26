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
  JulianDate,
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
      await this.placeTower(pickPosition);
      this.resetMode();
    }
  }

  async placeTower(position) {
    try {
      const resource = await IonResource.fromAssetId(3512572);
      const entity = this.viewer.entities.add({
        position: position,
        model: { uri: resource, scale: 7 },
      });
      this.placedObjects.push(entity);

      // Fetch weather data for this location if not already loaded
      if (!this.weatherManager.weatherData) {
        const cartographic = Cartographic.fromCartesian(position);
        const lat = (cartographic.latitude * 180) / Math.PI;
        const lon = (cartographic.longitude * 180) / Math.PI;

        // Show loading indicator (simple console log for now, could be UI toast)
        console.log("Fetching weather data...");
        document.body.style.cursor = "wait";

        await this.weatherManager.fetchWeatherData(lat, lon);

        document.body.style.cursor = "default";
        console.log("Weather data ready.");
      }
      return entity;
    } catch (err) {
      console.error("Failed to place object:", err);
      document.body.style.cursor = "default";
      return null;
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

  createConnection(obj1, obj2) {
    const entity1 = obj1 || this.selectedObjects[0];
    const entity2 = obj2 || this.selectedObjects[1];

    if (!entity1 || !entity2) {
      return;
    }

    entity1.model.color = Color.WHITE;
    if (entity2.model) {
      entity2.model.color = Color.WHITE;
    }

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
      billboard: {
        image: new CallbackProperty((time) => {
          return this.drawLoadProfile(time);
        }, false),
        show: new CallbackProperty(() => {
          return !!this.uiManager.dynamicLoadCheckbox?.checked;
        }, false),
        verticalOrigin: VerticalOrigin.TOP,
        pixelOffset: new Cartesian2(0, 10), // Below the label
        width: 150,
        height: 60,
        distanceDisplayCondition: new DistanceDisplayCondition(0, 5000),
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

  getLoadFactor(hour) {
    let factor = 0.3; // Base load (night)
    // Simple Residential Load Profile
    if (hour >= 6 && hour < 9) {
      factor = 0.3 + (hour - 6) * (0.5 / 3); // Morning Ramp (0.3 -> 0.8)
    } else if (hour >= 9 && hour < 17) {
      factor = 0.6; // Day Plateau
    } else if (hour >= 17 && hour < 19) {
      factor = 0.6 + (hour - 17) * (0.4 / 2); // Evening Peak Ramp (0.6 -> 1.0)
    } else if (hour >= 19 && hour < 22) {
      factor = 1.0; // Peak
    } else if (hour >= 22) {
      factor = 1.0 - (hour - 22) * (0.7 / 2); // Night Ramp (1.0 -> 0.3)
    }
    return factor;
  }

  drawLoadProfile(time) {
    // Throttle updates to prevent performance issues with toDataURL()
    // If we update too fast (e.g. every frame at 60fps), the base64 decoding can choke the render loop,
    // causing the billboard to disappear during playback.
    const now = performance.now();
    if (this._lastDrawTime && now - this._lastDrawTime < 100) {
      // Limit to 10 FPS
      return this._cachedDataURL || "";
    }
    this._lastDrawTime = now;

    if (!this._loadProfileCanvas) {
      this._loadProfileCanvas = document.createElement("canvas");
      this._loadProfileCanvas.width = 150;
      this._loadProfileCanvas.height = 60;
    }
    const canvas = this._loadProfileCanvas;
    const ctx = canvas.getContext("2d");

    // Clear previous frame
    ctx.clearRect(0, 0, 150, 60);

    // Background
    ctx.fillStyle = "rgba(20, 20, 20, 0.8)";
    ctx.fillRect(0, 0, 150, 60);

    // Draw Grid/Axes
    ctx.strokeStyle = "#444";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 50);
    ctx.lineTo(150, 50); // X-axis
    ctx.stroke();

    // Draw Load Curve
    ctx.strokeStyle = "#00ffcc";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let h = 0; h <= 24; h += 0.5) {
      const factor = this.getLoadFactor(h);
      const x = (h / 24) * 150;
      const y = 50 - factor * 40; // Scale 0-1 to 50-10 px (height 40)
      if (h === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // Draw Current Time Indicator
    const date = JulianDate.toDate(time);
    const currentHour = date.getUTCHours() + date.getUTCMinutes() / 60;
    const cx = (currentHour / 24) * 150;
    const cFactor = this.getLoadFactor(currentHour);
    const cy = 50 - cFactor * 40;

    // Vertical Line
    ctx.strokeStyle = "#ff3333";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, 60);
    ctx.stroke();
    ctx.setLineDash([]);

    // Dot
    ctx.fillStyle = "#ff3333";
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();

    // Text
    ctx.fillStyle = "#fff";
    ctx.font = "10px sans-serif";
    ctx.fillText("Daily Load", 5, 12);
    ctx.fillText(`${Math.round(cFactor * 100)}%`, cx + 5, cy - 5);

    this._cachedDataURL = canvas.toDataURL();
    return this._cachedDataURL;
  }

  updateLineGeometry(lineData, time) {
    const ambientTemp = this.weatherManager.getTemperatureAtTime(time);

    let loadHeating = parseFloat(this.uiManager.loadHeatingInput?.value || 0);

    // Apply Daily Load Profile if enabled
    if (this.uiManager.dynamicLoadCheckbox?.checked) {
      const date = JulianDate.toDate(time);
      const hour = date.getUTCHours() + date.getUTCMinutes() / 60;
      const factor = this.getLoadFactor(hour);
      loadHeating = loadHeating * factor;
    }

    // Fixed visual exaggeration
    const multiplier = 5;

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
