import { Cause, Schedule } from "effect";

/** Interruption redelivery is guarded by the workflow projection, not retried in-process. */
export const activityInterruptRetryPolicy: Schedule.Schedule<
  number,
  Cause.Cause<unknown>
> = Schedule.recurs(0).pipe(Schedule.setInputType<Cause.Cause<unknown>>());
