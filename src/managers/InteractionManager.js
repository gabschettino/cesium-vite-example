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
  Transforms,
  HeadingPitchRoll,
  Matrix4,
  Matrix3,
  Math as CesiumMath,
} from "cesium";
import { createTransmissionLine } from "../utils/catenary.js";
import { TransformGizmo } from "../utils/TransformGizmo.js";

//Tower Local Offsets (these are the connection points on the model, 3 phases each side)
const TOWER_OFFSETS = [
  { x: 0.21, y: 6.09, z: 45.47, label: true, id: "L1" },
  { x: 0.35, y: 6.4, z: 36.61, label: false, id: "L2" },
  { x: 0.39, y: 6.97, z: 28.53, label: false, id: "L3" },

  { x: 0.2, y: -6.09, z: 45.49, label: false, id: "R1" },
  { x: 0.33, y: -6.38, z: 36.56, label: false, id: "R2" },
  { x: 0.44, y: -6.93, z: 27.96, label: false, id: "R3" },
];

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

    this.gizmo = new TransformGizmo(viewer);

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
    this.pickMode = false;
    this.selectedObjects = [];
    this.viewer.canvas.style.cursor = "crosshair";
  }

  enableConnectMode() {
    this.connectMode = true;
    this.placeMode = false;
    this.pickMode = false;
    this.selectedObjects = [];
    this.viewer.canvas.style.cursor = "crosshair";
  }

  enablePickMode() {
    this.pickMode = true;
    this.placeMode = false;
    this.connectMode = false;
    this.viewer.canvas.style.cursor = "help";
    if (this.uiManager.pickResult) {
      this.uiManager.pickResult.textContent = "Click on the tower model...";
    }
  }

  resetMode() {
    this.placeMode = false;
    this.connectMode = false;
    this.pickMode = false;
    this.selectedObjects = [];
    this.viewer.canvas.style.cursor = "";
    if (this.uiManager && this.uiManager.setCursorModeActive) {
      this.uiManager.setCursorModeActive();
    }
  }

  async handleInput(click) {
    if (this.placeMode) {
      await this.handlePlaceObject(click);
    } else if (this.connectMode) {
      this.handleConnectObject(click);
    } else if (this.pickMode) {
      this.handlePickPoint(click);
    } else {
      this.handleSelectObject(click);
    }
  }

  handlePickPoint(click) {
    const picked = this.viewer.scene.pick(click.position);
    const pickPos = this.viewer.scene.pickPosition(click.position);

    if (picked && picked.id && pickPos) {
      const entity = picked.id;
      const time = JulianDate.now();
      const position = entity.position.getValue(time);
      const orientation = entity.orientation.getValue(time);

      if (position && orientation) {
        const modelMatrix = Matrix4.fromRotationTranslation(
          Matrix3.fromQuaternion(orientation),
          position,
          new Matrix4(),
        );
        const invModelMatrix = Matrix4.inverse(modelMatrix, new Matrix4());
        const localPos = Matrix4.multiplyByPoint(
          invModelMatrix,
          pickPos,
          new Cartesian3(),
        );

        const x = localPos.x.toFixed(2);
        const y = localPos.y.toFixed(2);
        const z = localPos.z.toFixed(2);

        console.log(`Picked Local Offset: x: ${x}, y: ${y}, z: ${z}`);

        if (this.uiManager.pickResult) {
          this.uiManager.pickResult.textContent = `x: ${x}, y: ${y}, z: ${z}`;
          this.uiManager.pickResult.style.color = "#44ff44";
        }

        this.viewer.entities.add({
          position: pickPos,
          point: { pixelSize: 10, color: Color.YELLOW },
          lifetime: 5.0,
        });
      }
    }
    this.resetMode();
  }

  handleSelectObject(click) {
    const picked = this.viewer.scene.pick(click.position);

    if (
      picked &&
      picked.id &&
      picked.id.properties &&
      picked.id.properties.gizmoType
    ) {
      return;
    }

    if (picked && picked.id && this.placedObjects.includes(picked.id)) {
      this.updateSelectionUI(picked.id);
      this.gizmo.setTarget(picked.id);
    } else {
      if (this.uiManager.transformTool) {
        this.uiManager.transformTool.style.display = "none";
      }
      this._currentSelectedEntity = null;
      this.gizmo.setTarget(null);
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

      const hpr = new HeadingPitchRoll(0, 0, 0);
      const orientation = Transforms.headingPitchRollQuaternion(position, hpr);

      const entity = this.viewer.entities.add({
        position: position,
        orientation: orientation,
        model: { uri: resource, scale: 7 },
        properties: {
          headingDegrees: 0,
        },
      });
      this.placedObjects.push(entity);

      if (!this.weatherManager.weatherData) {
        const cartographic = Cartographic.fromCartesian(position);
        const lat = (cartographic.latitude * 180) / Math.PI;
        const lon = (cartographic.longitude * 180) / Math.PI;

        document.body.style.cursor = "wait";

        await this.weatherManager.fetchWeatherData(lat, lon);

        document.body.style.cursor = "default";
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

      this.updateSelectionUI(picked.id);
      if (this.selectedObjects.length === 1) {
        picked.id.model.color = Color.CYAN;
      }

      if (this.selectedObjects.length === 2) {
        this.createConnection();
      }
    }
  }

  updateSelectionUI(entity) {
    this._currentSelectedEntity = entity;
  }

  updateSelectedTowerHeading(degrees) {
    if (!this._currentSelectedEntity) {
      return;
    }

    const entity = this._currentSelectedEntity;
    const position = entity.position.getValue(JulianDate.now());
    if (!position) {
      return;
    }

    const radians = CesiumMath.toRadians(degrees);
    const hpr = new HeadingPitchRoll(radians, 0, 0);
    const orientation = Transforms.headingPitchRollQuaternion(position, hpr);

    entity.orientation = orientation;
    if (!entity.properties) {
      entity.properties = {};
    }
    entity.properties.headingDegrees = degrees;
  }

  //local offset (right, forward, up) to world coordinate
  computeModuleWorldPos(entity, localOffset, time) {
    const position = entity.position.getValue(time);
    const orientation = entity.orientation.getValue(time);
    if (!position || !orientation) {
      return null;
    }

    const modelMatrix = Matrix4.fromRotationTranslation(
      Matrix3.fromQuaternion(orientation),
      position,
      new Matrix4(),
    );

    const local = new Cartesian3(localOffset.x, localOffset.y, localOffset.z);
    const world = Matrix4.multiplyByPoint(modelMatrix, local, new Cartesian3());
    return world;
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

    const options = this.uiManager.getLineOptions();

    TOWER_OFFSETS.forEach((offset) => {
      const now = JulianDate.now();
      const p1 = this.computeModuleWorldPos(entity1, offset, now);
      const p2 = this.computeModuleWorldPos(entity2, offset, now);

      if (!p1 || !p2) {
        console.warn("Could not compute module position");
        return;
      }

      const initialPositions = createTransmissionLine(p1, p2, options);

      let initialLength = 0;
      for (let i = 0; i < initialPositions.length - 1; i++) {
        initialLength += Cartesian3.distance(
          initialPositions[i],
          initialPositions[i + 1],
        );
      }

      const lineData = {
        entity1: entity1,
        entity2: entity2,
        localOffset: offset,
        start: p1,
        end: p2,
        refLength: initialLength,
        refTemp: 20,
        alpha: options.alpha,
        designMode: options.mode, //'sag', 'tension', 'length'
        designSagRatio: options.sagRatio,
        designTension: options.hTension,
        designWeight: options.linearWeight,

        options: { ...options, mode: "length" },
        lastTemp: null,
      };

      const midPoint = Cartesian3.midpoint(p1, p2, new Cartesian3());

      const entityDesc = {
        position: new CallbackProperty((time) => {
          if (lineData.lastPositions && lineData.lastPositions.length > 0) {
            const idx = Math.floor(lineData.lastPositions.length / 2);
            return lineData.lastPositions[idx];
          }
          return midPoint;
        }, false),
        polyline: {
          positions: new CallbackProperty((time) => {
            if (offset.label) {
              this.drawLoadProfile(time);
            }
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
        polylineVolume: {
          positions: new CallbackProperty((time) => {
            if (!this.uiManager.showSafetyZoneCheckbox?.checked) {
              return [];
            }
            const positions = this.updateLineGeometry(lineData, time);
            const verticalOffset = this.getSafetyRadius();

            const volumePositions = positions.map((p) => {
              const up = Cartesian3.normalize(p, new Cartesian3());
              const offset = Cartesian3.multiplyByScalar(
                up,
                -verticalOffset,
                new Cartesian3(),
              );
              return Cartesian3.add(p, offset, new Cartesian3());
            });

            return volumePositions;
          }, false),
          shape: new CallbackProperty(() => {
            return this.computePolygonShape(this.getSafetyRadius());
          }, false),
          material: new ColorMaterialProperty(new Color(1.0, 0.2, 0.2, 0.3)),
          show: new CallbackProperty(() => {
            return !!this.uiManager.showSafetyZoneCheckbox?.checked;
          }, false),
          cornerType: 2,
        },
      };

      if (offset.label) {
        entityDesc.label = {
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
        };
      }

      this.viewer.entities.add(entityDesc);
      this.lines.push(lineData);
    });

    this.resetMode();
  }

  computePolygonShape(radius, sides = 8) {
    if (
      this._shapeCache &&
      Math.abs(this._shapeCache.radius - radius) < 0.001
    ) {
      return this._shapeCache.positions;
    }

    const positions = [];
    const step = 360 / sides;
    for (let i = 0; i < 360; i += step) {
      const radians = CesiumMath.toRadians(i);
      positions.push(
        new Cartesian2(radius * Math.cos(radians), radius * Math.sin(radians)),
      );
    }
    this._shapeCache = { radius, positions };
    return positions;
  }

  getSafetyRadius() {
    const voltage = parseFloat(this.uiManager.systemVoltageInput?.value || 138);
    //rough aprox: 3m basic clearance + 1cm per kV (common assumption for distribution lines)
    return 3.0 + voltage * 0.01;
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
    let factor = 0.3;
    //simple residential load profile
    if (hour >= 6 && hour < 9) {
      factor = 0.3 + (hour - 6) * (0.5 / 3); //morning
    } else if (hour >= 9 && hour < 17) {
      factor = 0.6; // day plateau
    } else if (hour >= 17 && hour < 19) {
      factor = 0.6 + (hour - 17) * (0.4 / 2); //evening peak
    } else if (hour >= 19 && hour < 22) {
      factor = 1.0;
    } else if (hour >= 22) {
      factor = 1.0 - (hour - 22) * (0.7 / 2);
    }
    return factor;
  }

  drawLoadProfile(time) {
    //throttle updates
    const now = performance.now();
    if (this._lastDrawTime && now - this._lastDrawTime < 100) {
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

    ctx.clearRect(0, 0, 150, 60);

    ctx.fillStyle = "rgba(20, 20, 20, 0.8)";
    ctx.fillRect(0, 0, 150, 60);

    ctx.strokeStyle = "#444";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 50);
    ctx.lineTo(150, 50); // X-axis
    ctx.stroke();

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

    const date = JulianDate.toDate(time);
    const currentHour = date.getUTCHours() + date.getUTCMinutes() / 60;
    const cx = (currentHour / 24) * 150;
    const cFactor = this.getLoadFactor(currentHour);
    const cy = 50 - cFactor * 40;

    ctx.strokeStyle = "#ff3333";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, 60);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "#ff3333";
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#fff";
    ctx.font = "10px sans-serif";
    ctx.fillText("Daily Load", 5, 12);
    ctx.fillText(`${Math.round(cFactor * 100)}%`, cx + 5, cy - 5);

    const centralCanvas = document.getElementById("loadProfileCanvas");
    if (centralCanvas) {
      const ctx2 = centralCanvas.getContext("2d");
      ctx2.clearRect(0, 0, 150, 60);
      ctx2.drawImage(canvas, 0, 0);
    }
    return "";
  }

  updateLineGeometry(lineData, time) {
    const effectiveOffset = lineData.localOffset;

    let dirty = false;

    if (lineData.entity1 && lineData.entity2) {
      const start = this.computeModuleWorldPos(
        lineData.entity1,
        effectiveOffset,
        time,
      );
      const end = this.computeModuleWorldPos(
        lineData.entity2,
        effectiveOffset,
        time,
      );

      if (start && end) {
        if (
          !lineData.start ||
          !lineData.end ||
          Cartesian3.distanceSquared(start, lineData.start) > 0.001 ||
          Cartesian3.distanceSquared(end, lineData.end) > 0.001
        ) {
          dirty = true;

          if (lineData.designMode === "sag" && lineData.designSagRatio) {
            const tempOpts = {
              ...lineData.options,
              mode: "sag",
              sagRatio: lineData.designSagRatio,
              lengthMeters: undefined,
            };
            const newPositions = createTransmissionLine(start, end, tempOpts);

            let newRefLength = 0;
            for (let i = 0; i < newPositions.length - 1; i++) {
              newRefLength += Cartesian3.distance(
                newPositions[i],
                newPositions[i + 1],
              );
            }
            lineData.refLength = newRefLength;
          }
        }
        lineData.start = start;
        lineData.end = end;
      }
    }

    if (
      !dirty &&
      lineData._frameCache &&
      JulianDate.equals(time, lineData._frameCache.time)
    ) {
      return lineData._frameCache.positions;
    }

    const ambientTemp = this.weatherManager.getTemperatureAtTime(time);

    let loadHeating = parseFloat(this.uiManager.loadHeatingInput?.value || 0);

    if (this.uiManager.dynamicLoadCheckbox?.checked) {
      const date = JulianDate.toDate(time);
      const hour = date.getUTCHours() + date.getUTCMinutes() / 60;
      const factor = this.getLoadFactor(hour);
      loadHeating = loadHeating * factor;
    }

    //a little visual exaggeration
    const multiplier = 5;

    const totalTemp = ambientTemp + loadHeating;

    if (
      !dirty &&
      lineData.lastTemp !== null &&
      Math.abs(totalTemp - lineData.lastTemp) < 0.1 &&
      lineData.lastMultiplier === multiplier
    ) {
      return lineData.lastPositions;
    }

    //thermal expansion: L = L_ref * (1 + alpha * (T - T_ref))
    const alpha = lineData.alpha || 0.00002061;
    const newLength =
      lineData.refLength *
      (1 + alpha * (totalTemp - lineData.refTemp) * multiplier);

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
    lineData._frameCache = {
      time: time.clone(),
      positions: positions,
    };

    return positions;
  }
}
