/**
 * Rules for a campaign sequence. Everything must fit inside Instagram's 24 h
 * window with room to spare: at most 5 steps, each wait 1..1380 min, and the
 * total under 23 h. The worker re-checks the window before every step anyway.
 */
export const MAX_SEQUENCE_STEPS = 5;
export const MIN_STEP_DELAY_MIN = 1;
export const MAX_STEP_DELAY_MIN = 1380;
/** Sum of waits must stay strictly below 23 h. */
export const MAX_SEQUENCE_TOTAL_MIN = 23 * 60;
export const MAX_STEP_MESSAGE = 1000;

export type SequenceStepInput = { message: string; delayMinutes: number };

export function validateSequenceSteps(steps: SequenceStepInput[]): string[] {
  const errors: string[] = [];
  if (steps.length > MAX_SEQUENCE_STEPS) {
    errors.push(`At most ${MAX_SEQUENCE_STEPS} steps`);
  }
  let total = 0;
  steps.forEach((step, i) => {
    const n = i + 1;
    const message = (step.message ?? "").trim();
    if (!message) errors.push(`Step ${n}: message is empty`);
    if (message.length > MAX_STEP_MESSAGE) errors.push(`Step ${n}: message over ${MAX_STEP_MESSAGE} characters`);
    if (!Number.isInteger(step.delayMinutes)) {
      errors.push(`Step ${n}: wait must be whole minutes`);
    } else if (step.delayMinutes < MIN_STEP_DELAY_MIN || step.delayMinutes > MAX_STEP_DELAY_MIN) {
      errors.push(`Step ${n}: wait must be between ${MIN_STEP_DELAY_MIN} and ${MAX_STEP_DELAY_MIN} minutes`);
    }
    total += Number.isFinite(step.delayMinutes) ? step.delayMinutes : 0;
  });
  if (total >= MAX_SEQUENCE_TOTAL_MIN) {
    errors.push("Total wait must stay under 23 hours (Instagram's 24-hour window)");
  }
  return errors;
}
