import { Cartesian3, Transforms, Matrix4 } from "cesium";

/**
 * Function to create a true catenary between two supports (assuming always uneven heights)
 * @param {Cartesian3} startPos
 * @param {Cartesian3} endPos
 * @param {Object} options
 * @returns {Cartesian3[]}
 */
export function createTransmissionLine(startPos, endPos, options = {}) {
  const numPoints = options.numPoints ?? 64;
  const sagRatio = options.sagRatio ?? 0.06; //sag mode
  const lengthMeters = options.lengthMeters; //length mode
  const linearWeight = options.linearWeight ?? 30;
  const hTension = options.hTension ?? 15000;
  const mode = options.mode ?? "physics";

  const mid = Cartesian3.midpoint(startPos, endPos, new Cartesian3());
  const enu = Transforms.eastNorthUpToFixedFrame(mid);
  const invEnu = Matrix4.inverse(enu, new Matrix4());

  const p0 = Matrix4.multiplyByPoint(invEnu, startPos, new Cartesian3());
  const p1 = Matrix4.multiplyByPoint(invEnu, endPos, new Cartesian3());

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

  function buildPositionsFromParams(a, b, c) {
    const positions = [];
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;

    for (let i = 0; i <= numPoints; i++) {
      const t = i / numPoints;
      const x = t * L;
      const z = a * Math.cosh((x - b) / a) + c;

      if (z < minZ) {
        minZ = z;
      }
      if (z > maxZ) {
        maxZ = z;
      }

      const xLocal = p0.x + dirX * x;
      const yLocal = p0.y + dirY * x;
      const local = new Cartesian3(xLocal, yLocal, z);
      positions.push(Matrix4.multiplyByPoint(enu, local, new Cartesian3()));
    }

    //calculate Sag (approximate as max vertical distance from chord)
    let maxSag = 0;
    for (let i = 0; i <= numPoints; i++) {
      const t = i / numPoints;
      const x = t * L;
      const zCurve = a * Math.cosh((x - b) / a) + c;
      const zChord = z0 + (z1 - z0) * t;
      const sag = zChord - zCurve;
      if (sag > maxSag) {
        maxSag = sag;
      }
    }

    positions.metadata = {
      a: a,
      sag: maxSag,
      hTension: a * linearWeight,
      linearWeight: linearWeight,
    };

    return positions;
  }

  if (mode === "physics") {
    const a = hTension / Math.max(1e-6, linearWeight);
    //solve b so that z(L) - z(0) = dz
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

  if (
    mode === "length" &&
    typeof lengthMeters === "number" &&
    isFinite(lengthMeters) &&
    lengthMeters > 0
  ) {
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

    let aLo = Math.max(L / 600, 0.1);
    let aHi = L * 1000;

    let fLo = lengthResidual(aLo);
    let fHi = lengthResidual(aHi);

    const hasBracket = (v1, v2) => {
      if (v1 === Number.POSITIVE_INFINITY && v2 < 0) {
        return true;
      }
      if (v2 === Number.POSITIVE_INFINITY && v1 < 0) {
        return true;
      }
      return v1 * v2 < 0;
    };

    let guard = 0;
    while (!hasBracket(fLo, fHi) && guard < 20) {
      if (fLo > 0 && fHi > 0) {
        aHi *= 2;
        fHi = lengthResidual(aHi);
      } else if (fLo < 0 && fHi < 0) {
        aLo *= 0.5;
        fLo = lengthResidual(aLo);
      } else {
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
      return createSagBased();
    }
    //solve a by bisection
    let a = 0.5 * (aLo + aHi);
    for (let i = 0; i < 60; i++) {
      const f = lengthResidual(a);
      if (Math.abs(f) < 1e-4) {
        break;
      }
      if (f === Number.POSITIVE_INFINITY) {
        aLo = a;
        fLo = f;
      } else if (f * fLo < 0) {
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
      return createSagBased();
    }
    const c = z0 - a * Math.cosh(-b / a);
    return buildPositionsFromParams(a, b, c);
  }

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
      //last resort: simple parabola
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
      //last resort: simple parabola again
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
