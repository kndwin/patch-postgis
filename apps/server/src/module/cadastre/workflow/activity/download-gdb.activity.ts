import { Effect } from "effect";
import { Activity } from "effect/unstable/workflow";
import { CadastreActivityErrorSchema, type DownloadGdbInput } from "./download-gdb.activity.schema";
import { CadastreWorkflowNotImplemented } from "./cadastre-workflow-error.schema";

/** Explicit mock boundary; no GDB download occurs. */
export const DownloadGdbActivity = (_input: DownloadGdbInput) =>
  Activity.make({
    name: "CadastreSyncWorkflow/download-gdb",
    error: CadastreActivityErrorSchema,
    execute: Effect.fail(
      new CadastreWorkflowNotImplemented({
        activity: "download-gdb",
        message: "Activity is not implemented: download-gdb",
      }),
    ),
  });
