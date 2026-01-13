export class UIManager {
  constructor() {
    this.lineModeSelect = document.getElementById("lineMode");
    this.lineModeControl = document.getElementById("lineModeControl");

    this.conductorTypeSelect = document.getElementById("conductorType");

    this.physicsInputs = document.getElementById("physicsInputs");
    this.systemVoltageInput = document.getElementById("systemVoltage");
    this.tensionPctInput = document.getElementById("tensionPct");
    this.hTensionInput = document.getElementById("hTension");
    this.linearWeightInput = document.getElementById("linearWeight");
    this.rtsStrengthInput = document.getElementById("rtsStrength");
    this.loadHeatingInput = document.getElementById("loadHeating");
    this.loadHeatingVal = document.getElementById("loadHeatingVal");
    this.dynamicLoadCheckbox = document.getElementById("dynamicLoad");
    this.showSafetyZoneCheckbox = document.getElementById("showSafetyZone");
    this.geometricInputs = document.getElementById("geometricInputs");
    this.sagInputGroup = document.getElementById("sagInputGroup");
    this.lengthInputGroup = document.getElementById("lengthInputGroup");
    this.sagRatioInput = document.getElementById("sagRatio");
    this.cableLengthInput = document.getElementById("cableLength");

    this.catenaryConstantDisplay = document.getElementById(
      "catenaryConstantDisplay",
    );

    // Tools
    this.placeObjectBtn = document.getElementById("toolPlace");
    this.connectObjectsBtn = document.getElementById("toolConnect");
    this.cursorBtn = document.getElementById("toolCursor");

    this.railButtons = [
      this.cursorBtn,
      this.placeObjectBtn,
      this.connectObjectsBtn,
    ].filter((b) => b);

    this.lineControlsHeader = document.getElementById("lineControlsHeader");
    this.lineControlsContent = document.getElementById("lineControlsContent");
    this.lineControlsToggle = document.getElementById("lineControlsToggle");

    this.conductors = {
      drake: {
        name: "ACSR Drake",
        weight: 15.97,
        rts: 139.9,
        alpha: 0.0000189,
      },
      cardinal: {
        name: "ACSR Cardinal",
        weight: 17.94,
        rts: 150.3,
        alpha: 0.0000189,
      },
      curlew: {
        name: "ACSR Curlew",
        weight: 19.46,
        rts: 163.7,
        alpha: 0.0000189,
      },
      bluejay: {
        name: "ACSR Bluejay",
        weight: 18.28,
        rts: 131.2,
        alpha: 0.0000189,
      },
      custom: { name: "Custom", weight: 30, rts: 100, alpha: 0.0000189 },
    };

    this.initialize();
  }

  initialize() {
    this.setupSegmentedControls();
    this.updateVisibility();
    this.updateConductorValues();
    this.updateCalculations();

    if (this.lineModeSelect) {
      this.lineModeSelect.addEventListener("change", () =>
        this.updateVisibility(),
      );
    }

    if (this.conductorTypeSelect) {
      this.conductorTypeSelect.addEventListener("change", () => {
        this.updateConductorValues();
        this.updateCalculations();
      });
    }

    if (this.tensionPctInput) {
      this.tensionPctInput.addEventListener("input", () =>
        this.updateCalculations(true),
      );
    }
    if (this.hTensionInput) {
      this.hTensionInput.addEventListener("input", () =>
        this.updateCalculations(false),
      );
    }
    if (this.linearWeightInput) {
      this.linearWeightInput.addEventListener("input", () =>
        this.updateCalculations(false),
      );
    }
    if (this.loadHeatingInput) {
      this.loadHeatingInput.addEventListener("input", () => {
        if (this.loadHeatingVal) {
          this.loadHeatingVal.textContent = `${this.loadHeatingInput.value}°C`;
        }
      });
    }

    if (this.dynamicLoadCheckbox) {
      this.dynamicLoadCheckbox.addEventListener("change", () => {
        const container = document.getElementById("loadProfileContainer");
        if (container) {
          container.style.display = this.dynamicLoadCheckbox.checked
            ? "flex"
            : "none";
        }
      });
    }
  }

  setupSegmentedControls() {
    if (!this.lineModeControl) {
      return;
    }
    const buttons = this.lineModeControl.querySelectorAll(".segment-btn");

    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        buttons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        const value = btn.getAttribute("data-value");
        if (this.lineModeSelect) {
          this.lineModeSelect.value = value;
          this.updateVisibility();
        }
      });
    });
  }

  setupEventListeners({ onPlace, onConnect, onCursor }) {
    if (this.placeObjectBtn) {
      this.placeObjectBtn.addEventListener("click", () => {
        this.setActiveTool(this.placeObjectBtn);
        if (onPlace) {
          onPlace();
        }
      });
    }
    if (this.connectObjectsBtn) {
      this.connectObjectsBtn.addEventListener("click", () => {
        this.setActiveTool(this.connectObjectsBtn);
        if (onConnect) {
          onConnect();
        }
      });
    }
    if (this.cursorBtn) {
      this.cursorBtn.addEventListener("click", () => {
        this.setActiveTool(this.cursorBtn);
        if (onCursor) {
          onCursor();
        }
      });
    }
  }

  setActiveTool(activeBtn) {
    this.railButtons.forEach((btn) => btn.classList.remove("active"));
    if (activeBtn) {
      activeBtn.classList.add("active");
    }
  }

  setCursorModeActive() {
    this.setActiveTool(this.cursorBtn);
  }

  updateVisibility() {
    const mode = this.lineModeSelect ? this.lineModeSelect.value : "physics";

    if (this.physicsInputs && this.geometricInputs) {
      if (mode === "physics") {
        this.physicsInputs.style.display = "block";
        this.geometricInputs.style.display = "none";
      } else {
        this.physicsInputs.style.display = "none";
        this.geometricInputs.style.display = "block";

        if (mode === "sag") {
          if (this.sagInputGroup) {
            this.sagInputGroup.style.display = "block";
          }
          if (this.lengthInputGroup) {
            this.lengthInputGroup.style.display = "none";
          }
        } else {
          if (this.sagInputGroup) {
            this.sagInputGroup.style.display = "none";
          }
          if (this.lengthInputGroup) {
            this.lengthInputGroup.style.display = "block";
          }
        }
      }
    }
  }

  updateConductorValues() {
    if (!this.conductorTypeSelect) {
      return;
    }
    const type = this.conductorTypeSelect.value;
    const data = this.conductors[type];

    if (type !== "custom") {
      this.linearWeightInput.value = data.weight;
      this.rtsStrengthInput.value = data.rts;
      this.linearWeightInput.readOnly = true;
      this.rtsStrengthInput.readOnly = true;
      this.linearWeightInput.style.background = "rgba(255, 255, 255, 0.05)";
      this.linearWeightInput.style.color = "#aaa";
    } else {
      this.linearWeightInput.readOnly = false;
      this.rtsStrengthInput.readOnly = false;
      this.linearWeightInput.style.background = "";
      this.linearWeightInput.style.color = "";
    }
  }

  updateCalculations(fromPct = false) {
    const rtsKn = parseFloat(this.rtsStrengthInput.value) || 1;
    const rtsN = rtsKn * 1000;

    if (fromPct) {
      const pct = parseFloat(this.tensionPctInput.value) || 20;
      const tension = (pct / 100) * rtsN;
      this.hTensionInput.value = Math.round(tension);
    } else {
      const tension = parseFloat(this.hTensionInput.value) || 0;
      if (rtsN > 0) {
        const pct = (tension / rtsN) * 100;
        this.tensionPctInput.value = pct.toFixed(1);
      }
    }

    const h = parseFloat(this.hTensionInput.value) || 0;
    const w = parseFloat(this.linearWeightInput.value) || 1;
    const constant = h / w;
    this.catenaryConstantDisplay.textContent = `Catenary Constant (H/w): ${Math.round(constant)} m`;
  }

  getLineOptions() {
    const mode = this.lineModeSelect.value;
    const sagRatio = parseFloat(this.sagRatioInput.value) || 0.06;
    const lengthVal = parseFloat(this.cableLengthInput.value);
    const lengthMeters =
      Number.isFinite(lengthVal) && lengthVal > 0 ? lengthVal : undefined;
    const linearWeight = parseFloat(this.linearWeightInput.value) || 10;
    const hTension = parseFloat(this.hTensionInput.value) || 10000;
    const loadHeating = parseFloat(this.loadHeatingInput.value) || 0;

    const type = this.conductorTypeSelect.value;
    const alpha = this.conductors[type]?.alpha || 0.0000189;
    const name = this.conductors[type]?.name || "Custom";

    return {
      numPoints: 96,
      sagRatio,
      lengthMeters,
      linearWeight,
      hTension,
      mode,
      alpha,
      name,
      loadHeating,
    };
  }
}
