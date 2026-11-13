import {normalizeConfig} from './optimizer.js';

// populateLargeConfig also derives N from m, c and the pith setting.
export function candidateToSidebar(candidate){
  return normalizeConfig(candidate.config);
}
