// MediaPipe returns hands and faces in no stable order, so each frame's
// detections are matched to the tracks from the previous frame by distance.
// Closest pairs are matched first; anything farther than `maxDistance` is
// treated as a different person's hand or face.
export function matchDetections(tracks, detections, maxDistance) {
  const pairs = [];
  for (let t = 0; t < tracks.length; t++) {
    for (let d = 0; d < detections.length; d++) {
      const a = tracks[t].position;
      const b = detections[d].position;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (distance <= maxDistance(detections[d])) pairs.push({ t, d, distance });
    }
  }
  pairs.sort((a, b) => a.distance - b.distance);

  const usedTracks = new Set();
  const usedDetections = new Set();
  const matches = [];
  for (const { t, d } of pairs) {
    if (usedTracks.has(t) || usedDetections.has(d)) continue;
    usedTracks.add(t);
    usedDetections.add(d);
    matches.push({ track: tracks[t], detection: detections[d] });
  }

  return {
    matches,
    unmatchedTracks: tracks.filter((_, i) => !usedTracks.has(i)),
    unmatchedDetections: detections.filter((_, i) => !usedDetections.has(i)),
  };
}
