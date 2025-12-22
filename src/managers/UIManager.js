export class UIManager {
  constructor() {
    this.lineModeSelect = document.getElementById("lineMode");
    this.conductorTypeSelect = document.getElementById("conductorType");

    this.physicsInputs = document.getElementById("physicsInputs");
    this.tensionPctInput = document.getElementById("tensionPct");
    this.hTensionInput = document.getElementById("hTension");
    this.linearWeightInput = document.getElementById("linearWeight");
    this.rtsStrengthInput = document.getElementById("rtsStrength");
    this.loadHeatingInput = document.getElementById("loadHeating");
    this.loadHeatingVal = document.getElementById("loadHeatingVal");
    this.thermalMultiplierInput = document.getElementById("thermalMultiplier");
    this.thermalMultiplierVal = document.getElementById("thermalMultiplierVal");

    this.geometricInputs = document.getElementById("geometricInputs");
    this.sagInputGroup = document.getElementById("sagInputGroup");
    this.lengthInputGroup = document.getElementById("lengthInputGroup");
    this.sagRatioInput = document.getElementById("sagRatio");
    this.cableLengthInput = document.getElementById("cableLength");

    this.catenaryConstantDisplay = document.getElementById(
      "catenaryConstantDisplay",
    );

    this.placeObjectBtn = document.getElementById("placeObjectBtn");
    this.connectObjectsBtn = document.getElementById("connectObjectsBtn");

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
    this.updateVisibility();
    this.updateConductorValues();
    this.updateCalculations();

    this.lineModeSelect.addEventListener("change", () =>
      this.updateVisibility(),
    );
    this.conductorTypeSelect.addEventListener("change", () => {
      this.updateConductorValues();
      this.updateCalculations();
    });

    this.tensionPctInput.addEventListener("input", () =>
      this.updateCalculations(true),
    );
    this.hTensionInput.addEventListener("input", () =>
      this.updateCalculations(false),
    );
    this.linearWeightInput.addEventListener("input", () =>
      this.updateCalculations(false),
    );
    this.loadHeatingInput.addEventListener("input", () => {
      this.loadHeatingVal.textContent = `${this.loadHeatingInput.value}°C`;
    });
    this.thermalMultiplierInput.addEventListener("input", () => {
      this.thermalMultiplierVal.textContent = `${this.thermalMultiplierInput.value}x`;
    });
  }

  setupEventListeners({ onPlace, onConnect }) {
    if (this.placeObjectBtn) {
      this.placeObjectBtn.addEventListener("click", onPlace);
    }
    if (this.connectObjectsBtn) {
      this.connectObjectsBtn.addEventListener("click", onConnect);
    }
  }

  updateVisibility() {
    const mode = this.lineModeSelect.value;

    if (mode === "physics") {
      this.physicsInputs.style.display = "block";
      this.geometricInputs.style.display = "none";
    } else {
      this.physicsInputs.style.display = "none";
      this.geometricInputs.style.display = "block";

      if (mode === "sag") {
        this.sagInputGroup.style.display = "block";
        this.lengthInputGroup.style.display = "none";
      } else {
        this.sagInputGroup.style.display = "none";
        this.lengthInputGroup.style.display = "block";
      }
    }
  }

  updateConductorValues() {
    const type = this.conductorTypeSelect.value;
    const data = this.conductors[type];

    if (type !== "custom") {
      this.linearWeightInput.value = data.weight;
      this.rtsStrengthInput.value = data.rts;
      this.linearWeightInput.readOnly = true;
      this.rtsStrengthInput.readOnly = true;
      this.linearWeightInput.style.background = "rgba(0,0,0,0.2)";
      this.linearWeightInput.style.color = "#888";
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
