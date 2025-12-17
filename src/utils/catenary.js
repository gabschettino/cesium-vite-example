import { Cartesian3, Transforms, Matrix4 } from "cesium";

/**
 * Function to create a true catenary between two supports (handles uneven heights)
 * @param {Cartesian3} startPos
 * @param {Cartesian3} endPos
 * @param {Object} options
 * @returns {Cartesian3[]}
 */
export function createTransmissionLine(startPos, endPos, options = {}) {
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
    // Start with a safe range to avoid cosh overflow (L/a < 700)
    let aLo = Math.max(L / 600, 0.1);
    let aHi = L * 1000;

    let fLo = lengthResidual(aLo);
    let fHi = lengthResidual(aHi);

    // Helper to check if signs are different (bracketing root)
    // We treat +Infinity as positive.
    const hasBracket = (v1, v2) => {
      if (v1 === Number.POSITIVE_INFINITY && v2 < 0) {
        return true;
      }
      if (v2 === Number.POSITIVE_INFINITY && v1 < 0) {
        return true;
      }
      return v1 * v2 < 0; // Standard sign check
    };

    let guard = 0;
    while (!hasBracket(fLo, fHi) && guard < 20) {
      // If both positive (Length > S), we need larger a (shorter length) -> increase aHi?
      // Wait, small a = long length (pos residual). Large a = short length (neg residual).
      // If both positive, it means even aHi is too small (too long). We need larger aHi.
      if (fLo > 0 && fHi > 0) {
        aHi *= 2;
        fHi = lengthResidual(aHi);
      }
      // If both negative (Length < S), it means even aLo is too large (too short). We need smaller aLo.
      else if (fLo < 0 && fHi < 0) {
        aLo *= 0.5;
        fLo = lengthResidual(aLo);
      }
      // If one is NaN or something weird
      else {
        // Try expanding both
        aLo *= 0.5;
        aHi *= 2;
        fLo = lengthResidual(aLo);
        fHi = lengthResidual(aHi);
      }
      guard++;
    }

    if (!hasBracket(fLo, fHi)) {
      console.warn(
        "Catenary solver failed to bracket 'a'. Falling back to sag ratio.",
        { S, L, aLo, aHi, fLo, fHi },
      );
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
      // Handle Infinity in bisection
      if (f === Number.POSITIVE_INFINITY) {
        // Treat as positive value -> root is to the right (larger a)
        aLo = a;
        fLo = f;
      } else if (f * fLo < 0) {
        // Standard sign check
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
