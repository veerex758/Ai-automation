/**
 * Deterministic, bounded left-to-right positions for generated registry graphs.
 * The editor validator accepts coordinates from 0 through 2000.
 */
function calculateGraphPositions(steps, edges) {
  const depths = new Map();
  const lanes = new Map();
  const unresolved = new Set(steps.map((step) => step.id));

  for (let pass = 0; pass < steps.length && unresolved.size > 0; pass += 1) {
    let resolvedAny = false;
    for (const step of steps) {
      if (!unresolved.has(step.id)) continue;
      const incoming = edges.filter((edge) => edge.target === step.id);
      if (incoming.some((edge) => !depths.has(edge.source))) continue;
      const depth = incoming.length
        ? Math.max(...incoming.map((edge) => depths.get(edge.source) ?? 0)) + 1
        : 0;
      const nextLanes = incoming.map((edge) => {
        const sourceLane = lanes.get(edge.source) ?? 0;
        return sourceLane + (edge.label === "true" ? -1 : edge.label === "false" ? 1 : 0);
      });
      const lane = nextLanes.length
        ? nextLanes.reduce((sum, value) => sum + value, 0) / nextLanes.length
        : 0;
      depths.set(step.id, depth);
      lanes.set(step.id, Math.max(-1, Math.min(1, lane)));
      unresolved.delete(step.id);
      resolvedAny = true;
    }
    if (!resolvedAny) break;
  }

  const maxDepth = Math.max(0, ...depths.values());
  const horizontalStep = maxDepth > 0 ? Math.min(320, 1840 / maxDepth) : 320;
  return new Map(steps.map((step) => {
    const depth = depths.get(step.id) ?? 0;
    const lane = lanes.get(step.id) ?? 0;
    return [step.id, {
      x: Math.round(160 + depth * horizontalStep),
      y: Math.round(330 + lane * 220),
    }];
  }));
}

module.exports = { calculateGraphPositions };
