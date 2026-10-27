/** Wave 1 exit gate: print the headline numbers the demo copy will quote. */
import { runScenario } from '../core/scenario.js';

const base = {
  seed: 42,
  towerSeparationMeters: 20,
  zoneSeparationMeters: 30,
  sampleCount: 160000,
  mu: 0.05,
};

const withLead = runScenario(base);
const withoutLead = runScenario({ ...base, modelFiberLead: false });

console.log(`fiber lead ON   → quiet-zone reduction: ${withLead.reductionDb.toFixed(1)} dB`);
console.log(`fiber lead OFF  → quiet-zone reduction: ${withoutLead.reductionDb.toFixed(1)} dB`);
console.log(`lead advantage over the no-fiber contrast: ${(withLead.reductionDb - withoutLead.reductionDb).toFixed(1)} dB`);