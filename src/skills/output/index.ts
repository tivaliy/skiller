export type { OutputSink, OutputDeps, DeliveryOutcome, DeliveryTarget } from './types';
export { parseSink, deliverOutput, describeSink, outputNeedsTarget, KNOWN_SINK_TOKENS } from './sinks';
export { deliverSkillOutput, stripCodeFence } from './deliver-skill-output';
export { createVsCodeOutputDeps, captureDeliveryTarget } from './accessors';
