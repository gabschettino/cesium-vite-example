import {
  Color,
  Cartesian3,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  CallbackProperty,
  Transforms,
  Matrix4,
  Matrix3,
  Plane,
  IntersectionTests,
  Math as CesiumMath,
  HeadingPitchRoll,
  defined,
  PolylineArrowMaterialProperty,
} from "cesium";

export class TransformGizmo {
  constructor(viewer) {
    this.viewer = viewer;
    this.handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    this._target = null;
    this._dragging = false;
    this._dragMode = null;
    this._dragStartPos = null;
    this._startEntityPos = null;
    this._startEntityHeading = 0;

    // Gizmo Entities
    this.ringEntity = null;
    this.arrowX = null;
    this.arrowY = null;
    this.arrowZ = null;

    this._gizmoHeight = 5.0; //little gizmo height

    this.createGizmos();
    this.setupEvents();
  }

  createGizmos() {
    const that = this;
    const showGizmo = new CallbackProperty(() => !!that._target, false);

    const getOffsetPos = (time) => {
      if (!that._target) {
        return null;
      }
      const pos = that._target.position.getValue(time);
      if (!pos) {
        return null;
      }

      const up = Cartesian3.normalize(pos, new Cartesian3());
      return Cartesian3.add(
        pos,
        Cartesian3.multiplyByScalar(up, that._gizmoHeight, new Cartesian3()),
        new Cartesian3(),
      );
    };

    this.ringEntity = this.viewer.entities.add({
      polyline: {
        positions: new CallbackProperty((time) => {
          const pos = getOffsetPos(time);
          if (!pos) {
            return [];
          }

          const centerFrame = Transforms.eastNorthUpToFixedFrame(pos);
          const points = [];
          const radius = 12;
          const steps = 60;

          for (let i = 0; i <= steps; i++) {
            const angle = (i / steps) * CesiumMath.TWO_PI;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;
            const localPt = new Cartesian3(x, y, 0); //z=0 is local tangent plane level
            points.push(
              Matrix4.multiplyByPoint(centerFrame, localPt, new Cartesian3()),
            );
          }
          return points;
        }, false),
        width: 5,
        material: Color.YELLOW.withAlpha(0.8),
        depthFailMaterial: Color.YELLOW.withAlpha(0.3),
        show: showGizmo,
      },
      properties: { gizmoType: "rotate" },
    });

    this.arrowX = this.viewer.entities.add({
      polyline: {
        positions: new CallbackProperty((time) => {
          const pos = getOffsetPos(time);
          if (!that._target) {
            return [];
          }
          const orient = that._target.orientation.getValue(time);
          if (!pos || !orient) {
            return [];
          }

          const mat = Matrix3.fromQuaternion(orient);
          const xDir = Matrix3.getColumn(mat, 0, new Cartesian3());
          const end = Cartesian3.add(
            pos,
            Cartesian3.multiplyByScalar(xDir, 18, new Cartesian3()),
            new Cartesian3(),
          );
          return [pos, end];
        }, false),
        width: 10,
        arcType: 0,
        material: new PolylineArrowMaterialProperty(Color.RED),
        depthFailMaterial: new PolylineArrowMaterialProperty(
          Color.RED.withAlpha(0.5),
        ),
        show: showGizmo,
      },
      properties: { gizmoType: "translate-x" },
    });

    this.arrowY = this.viewer.entities.add({
      polyline: {
        positions: new CallbackProperty((time) => {
          const pos = getOffsetPos(time);
          if (!that._target) {
            return [];
          }
          const orient = that._target.orientation.getValue(time);
          if (!pos || !orient) {
            return [];
          }

          const mat = Matrix3.fromQuaternion(orient);
          const yDir = Matrix3.getColumn(mat, 1, new Cartesian3());
          const end = Cartesian3.add(
            pos,
            Cartesian3.multiplyByScalar(yDir, 18, new Cartesian3()),
            new Cartesian3(),
          );
          return [pos, end];
        }, false),
        width: 10,
        arcType: 0,
        material: new PolylineArrowMaterialProperty(Color.GREEN),
        depthFailMaterial: new PolylineArrowMaterialProperty(
          Color.GREEN.withAlpha(0.5),
        ),
        show: showGizmo,
      },
      properties: { gizmoType: "translate-y" },
    });

    this.arrowZ = this.viewer.entities.add({
      polyline: {
        positions: new CallbackProperty((time) => {
          const pos = getOffsetPos(time);
          if (!that._target) {
            return [];
          }
          const orient = that._target.orientation.getValue(time);
          if (!pos || !orient) {
            return [];
          }

          const mat = Matrix3.fromQuaternion(orient);
          const zDir = Matrix3.getColumn(mat, 2, new Cartesian3());
          const end = Cartesian3.add(
            pos,
            Cartesian3.multiplyByScalar(zDir, 18, new Cartesian3()),
            new Cartesian3(),
          );
          return [pos, end];
        }, false),
        width: 10,
        arcType: 0,
        material: new PolylineArrowMaterialProperty(Color.BLUE),
        depthFailMaterial: new PolylineArrowMaterialProperty(
          Color.BLUE.withAlpha(0.5),
        ),
        show: showGizmo,
      },
      properties: { gizmoType: "translate-z" },
    });
  }

  setTarget(entity) {
    if (this._target === entity) {
      return;
    }
    this._target = entity;
  }

  setupEvents() {
    this.handler.setInputAction(
      this.onLeftDown.bind(this),
      ScreenSpaceEventType.LEFT_DOWN,
    );
    this.handler.setInputAction(
      this.onMouseMove.bind(this),
      ScreenSpaceEventType.MOUSE_MOVE,
    );
    this.handler.setInputAction(
      this.onLeftUp.bind(this),
      ScreenSpaceEventType.LEFT_UP,
    );
  }

  onLeftDown(click) {
    if (!this._target) {
      return;
    }

    const picked = this.viewer.scene.pick(click.position);
    if (
      defined(picked) &&
      picked.id &&
      picked.id.properties &&
      picked.id.properties.gizmoType
    ) {
      const type = picked.id.properties.gizmoType.getValue();
      this._dragging = true;
      this._dragMode = type;

      this.viewer.scene.screenSpaceCameraController.enableRotate = false;
      this.viewer.scene.screenSpaceCameraController.enableTranslate = false;

      const time = this.viewer.clock.currentTime;
      this._startEntityPos = this._target.position.getValue(time).clone();
      this._startEntityHeading = this._target.properties.headingDegrees
        ? this._target.properties.headingDegrees.getValue()
        : 0;

      const up = Cartesian3.normalize(this._startEntityPos, new Cartesian3());
      this._gizmoCenter = Cartesian3.add(
        this._startEntityPos,
        Cartesian3.multiplyByScalar(up, this._gizmoHeight, new Cartesian3()),
        new Cartesian3(),
      );

      if (this._dragMode === "translate-z") {
        const cameraDir = this.viewer.camera.direction;
        this._dragPlane = Plane.fromPointNormal(this._gizmoCenter, cameraDir);
      } else {
        this._dragPlane = this.getDragPlane(this._gizmoCenter);
      }

      const ray = this.viewer.camera.getPickRay(click.position);
      this._dragStartPos = IntersectionTests.rayPlane(ray, this._dragPlane);
    }
  }

  onMouseMove(move) {
    if (!this._dragging || !this._target) {
      return;
    }

    const ray = this.viewer.camera.getPickRay(move.endPosition);
    const currentPos = IntersectionTests.rayPlane(ray, this._dragPlane);

    if (!currentPos || !this._dragStartPos) {
      return;
    }

    if (this._dragMode === "rotate") {
      this.handleRotate(currentPos);
    } else if (this._dragMode === "translate-x") {
      this.handleTranslate(currentPos, "x");
    } else if (this._dragMode === "translate-y") {
      this.handleTranslate(currentPos, "y");
    } else if (this._dragMode === "translate-z") {
      this.handleTranslate(currentPos, "z");
    }
  }

  onLeftUp() {
    if (this._dragging) {
      this._dragging = false;
      this._dragMode = null;
      this.viewer.scene.screenSpaceCameraController.enableRotate = true;
      this.viewer.scene.screenSpaceCameraController.enableTranslate = true;
    }
  }

  getDragPlane(origin) {
    const normal = Cartesian3.normalize(origin, new Cartesian3());
    return Plane.fromPointNormal(origin, normal);
  }

  handleRotate(currentPos) {
    const center = this._gizmoCenter;
    const vStart = Cartesian3.subtract(
      this._dragStartPos,
      center,
      new Cartesian3(),
    );
    const vCurrent = Cartesian3.subtract(currentPos, center, new Cartesian3());

    const up = Cartesian3.normalize(center, new Cartesian3());

    const vStartNorm = Cartesian3.normalize(vStart, new Cartesian3());
    const vCurrentNorm = Cartesian3.normalize(vCurrent, new Cartesian3());

    const dot = Cartesian3.dot(vStartNorm, vCurrentNorm);
    const cross = Cartesian3.cross(vStartNorm, vCurrentNorm, new Cartesian3());
    const det = Cartesian3.dot(up, cross);

    const angleDiff = Math.atan2(det, dot); // Radians
    const angleDiffDeg = CesiumMath.toDegrees(angleDiff);

    const newHeading = this._startEntityHeading - angleDiffDeg;

    this.updateTargetHeading(newHeading);
  }

  handleTranslate(currentPos, axis) {
    const startDrag = this._dragStartPos;
    const delta = Cartesian3.subtract(currentPos, startDrag, new Cartesian3());

    const time = this.viewer.clock.currentTime;
    const orient = this._target.orientation.getValue(time);
    const mat = Matrix3.fromQuaternion(orient);

    let axisDir;
    if (axis === "x") {
      axisDir = Matrix3.getColumn(mat, 0, new Cartesian3());
    } else if (axis === "y") {
      axisDir = Matrix3.getColumn(mat, 1, new Cartesian3());
    } else if (axis === "z") {
      axisDir = Matrix3.getColumn(mat, 2, new Cartesian3());
    }

    const projection = Cartesian3.multiplyByScalar(
      axisDir,
      Cartesian3.dot(delta, axisDir),
      new Cartesian3(),
    );

    const newPos = Cartesian3.add(
      this._startEntityPos,
      projection,
      new Cartesian3(),
    );

    if (axis !== "z") {
      const carto =
        this.viewer.scene.globe.ellipsoid.cartesianToCartographic(newPos);
      carto.height = this.viewer.scene.globe.ellipsoid.cartesianToCartographic(
        this._startEntityPos,
      ).height;
      const clampedPos =
        this.viewer.scene.globe.ellipsoid.cartographicToCartesian(carto);
      this._target.position.setValue(clampedPos);
    } else {
      this._target.position.setValue(newPos);
    }
  }

  updateTargetHeading(degrees) {
    if (!this._target) {
      return;
    }

    const position = this._target.position.getValue(
      this.viewer.clock.currentTime,
    );
    const hpr = new HeadingPitchRoll(CesiumMath.toRadians(degrees), 0, 0);
    const orientation = Transforms.headingPitchRollQuaternion(position, hpr);

    this._target.orientation.setValue(orientation);
    if (!this._target.properties) {
      this._target.properties = {};
    }
    this._target.properties.headingDegrees = degrees;
  }
}
