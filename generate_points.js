// generate_points.js
const fs = require('fs');

const RADIUS_NM = 250;
const NM_PER_DEG_LAT = 60;
const OVERLAP = 0.8;        // 80% step to ensure overlap
const LAT_MIN = -85, LAT_MAX = 85;

const degToRad = d => d * Math.PI / 180;
const nmPerDegLon = lat => 60 * Math.cos(degToRad(lat));

const pts = [];
const latStep = (RADIUS_NM / NM_PER_DEG_LAT) * OVERLAP; // ~3.3° per step
for (let lat = LAT_MIN; lat <= LAT_MAX; lat += latStep) {
  const lonStep = Math.min(30, (RADIUS_NM / (nmPerDegLon(lat) || 1)) * OVERLAP);
  for (let lon = -180; lon < 180; lon += lonStep) {
    pts.push({
      name: `P_${lat.toFixed(2)}_${lon.toFixed(2)}`,
      lat: +lat.toFixed(4),
      lon: +lon.toFixed(4)
    });
  }
}

fs.writeFileSync('points.json', JSON.stringify(pts, null, 2));
console.log('points.json written with', pts.length, 'points');
