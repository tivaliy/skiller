/**
 * /skill Command Module
 *
 * Re-exports handlers for the /skill command.
 *
 * Internal structure:
 *   - handler.ts: Main orchestration
 *   - argument-parser.ts: Command argument parsing
 *   - input-collector.ts: Interactive input collection
 *   - confirmation-responder.ts: Confirmation step handling
 *   - presenter.ts: UI output functions
 */

export { handleSkill } from './handler';
export { handleInputResponse, checkPendingInputCollection } from './input-collector';
export { handleConfirmationResponse, checkPendingConfirmation } from './confirmation-responder';
