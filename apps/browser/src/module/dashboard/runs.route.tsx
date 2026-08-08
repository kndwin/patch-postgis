import { createFileRoute } from "@tanstack/react-router";
import { AsyncResult } from "effect/unstable/reactivity";
import { useAtomValue, useAtomRefresh, useAtom } from "@effect/atom-react";
import { runsDataAtom, workflowCursorAtom, workflowPageSizeAtom } from "./runs.atoms";
import type { WorkflowExecution, Schedule, WorkflowPage } from "@patch/http-contract";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState } from "react";
import { IconChevronDown, IconChevronRight, IconX } from "@tabler/icons-react";
import { runsFilterMachine, type FilterEvent } from "./runs-filter.machine";
import { formatRunDate, parseRunDate } from "./runs-dates";
import { Spinner } from "@/components/ui/spinner";

export const Route = createFileRoute("/dashboard/runs")({
  component: Runs,
});

const statusFilterLabels: Record<string, string> = {
  all: "All statuses",
  succeeded: "Succeeded",
  failed: "Failed",
  running: "Running",
};

const sortLabels: Record<string, string> = {
  "startedAt-desc": "Newest first",
  "startedAt-asc": "Oldest first",
  "duration-desc": "Longest duration",
  "duration-asc": "Shortest duration",
};

function formatDuration(startMs: number, endMs: number): string {
  const totalSeconds = Math.round((endMs - startMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function ExecutionRow({ execution }: { execution: WorkflowExecution }) {
  const [expanded, setExpanded] = useState(false);
  const hasSteps = execution.steps && execution.steps.length > 0;
  const isFailed = execution.status === "failed";
  const isCancelled = execution.status === "cancelled";

  return (
    <>
      <tr
        onClick={() => {
          if (hasSteps || isFailed || isCancelled) setExpanded(!expanded);
        }}
        className={`border-b border-slate-200 ${hasSteps || isFailed || isCancelled ? "cursor-pointer hover:bg-slate-50" : ""}`}
      >
        <td className="px-3 py-2">
          {hasSteps || isFailed || isCancelled ? (
            expanded ? (
              <IconChevronDown className="h-4 w-4 text-slate-400" />
            ) : (
              <IconChevronRight className="h-4 w-4 text-slate-400" />
            )
          ) : null}
        </td>
        <td className="px-3 py-2">
          <p className="text-sm font-medium text-slate-950">{execution.workflowName}</p>
          <p className="text-xs text-slate-500">{formatRunDate(execution.startedAt)}</p>
        </td>
        <td className="px-3 py-2">
          <Badge
            variant={
              execution.status === "succeeded"
                ? "default"
                : execution.status === "failed"
                  ? "destructive"
                  : "secondary"
            }
            className="text-xs"
          >
            {execution.status === "running" && <Spinner className="mr-1 inline size-3" />}
            {execution.status}
          </Badge>
        </td>
        <td className="px-3 py-2 text-sm text-slate-600">{execution.trigger}</td>
      </tr>

      {expanded && (hasSteps || isFailed || isCancelled) && (
        <tr className="border-b border-slate-200 bg-slate-50">
          <td colSpan={4} className="px-3 py-4">
            <div className="space-y-4">
              {isFailed && execution.failedStep && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3">
                  <p className="text-xs font-semibold text-red-800">
                    Failed Step: {execution.failedStep}
                  </p>
                  {execution.error && (
                    <p className="mt-2 text-xs text-red-600">{execution.error}</p>
                  )}
                </div>
              )}

              {hasSteps && (
                <div>
                  <p className="mb-3 text-xs font-semibold text-slate-700">Execution Timeline</p>
                  <div className="space-y-0">
                    {execution.steps!.map((step, idx) => {
                      const isFailedStep = step.name === execution.failedStep;
                      const startDate =
                        step.status !== "pending" ? parseRunDate(step.startedAt) : null;
                      const endDate = parseRunDate(step.finishedAt);
                      const startMs = startDate?.getTime() ?? 0;
                      const endMs = endDate?.getTime() ?? 0;
                      const duration =
                        startMs && endMs && endMs >= startMs
                          ? formatDuration(startMs, endMs)
                          : null;
                      const isLastStep = idx === execution.steps!.length - 1;

                      const statusDot = isFailedStep
                        ? "bg-red-500"
                        : step.status === "completed"
                          ? "bg-green-500"
                          : step.status === "running"
                            ? "bg-blue-500"
                            : "bg-slate-300";

                      const statusText =
                        step.status === "completed"
                          ? "text-green-700"
                          : step.status === "running"
                            ? "text-blue-700"
                            : isFailedStep
                              ? "text-red-700"
                              : "text-slate-600";

                      return (
                        <div key={idx} className="flex gap-3">
                          <div className="flex flex-col items-center">
                            <div className={`h-3 w-3 rounded-full ${statusDot}`} />
                            {!isLastStep && <div className="mt-1 h-6 w-0.5 bg-slate-200" />}
                          </div>
                          <div className="flex-1 pb-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <p className={`text-sm font-medium ${statusText}`}>{step.name}</p>
                                {isFailedStep && execution.error && (
                                  <p className="text-xs text-red-600">{execution.error}</p>
                                )}
                                {duration && (
                                  <p className="text-xs text-slate-500">Duration: {duration}</p>
                                )}
                                {step.status !== "pending" && (
                                  <p className="text-xs text-slate-400">
                                    {formatRunDate(step.startedAt, {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                      second: "2-digit",
                                    })}
                                  </p>
                                )}
                              </div>
                              <Badge
                                variant={
                                  isFailedStep
                                    ? "destructive"
                                    : step.status === "completed"
                                      ? "default"
                                      : "secondary"
                                }
                                className="text-xs shrink-0"
                              >
                                {step.status === "running" && (
                                  <Spinner className="mr-1 inline size-3" />
                                )}
                                {isFailedStep ? "failed" : step.status}
                              </Badge>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Runs() {
  const result = useAtomValue(runsDataAtom);
  const refresh = useAtomRefresh(runsDataAtom);
  const [, setCursor] = useAtom(workflowCursorAtom);
  const [pageSize, setPageSize] = useAtom(workflowPageSizeAtom);
  const [cursorHistory, setCursorHistory] = useState<(string | null)[]>([]);
  const [machineState, setMachineState] = useState(runsFilterMachine.initial());

  const data = AsyncResult.isSuccess(result) ? result.value : null;
  const isFailure = AsyncResult.isFailure(result);
  const isLoading = AsyncResult.isWaiting(result) || AsyncResult.isInitial(result);

  const workflowPage: WorkflowPage | undefined = data?.workflows;
  const executions: readonly WorkflowExecution[] = workflowPage?.items ?? [];
  const nextCursor = workflowPage?.nextCursor;
  const totalCount = workflowPage?.totalCount ?? 0;
  const schedules: readonly Schedule[] = data?.schedules?.schedules ?? [];

  // Get filter state
  const searchQuery = machineState.searchQuery;
  const statusFilter = machineState.statusFilter;
  const sort = machineState.sort;

  // Helper to transition machine
  const transitionMachine = (event: FilterEvent) => {
    const next = runsFilterMachine.transition(machineState, event);
    setMachineState(next);
  };

  // Filter and sort executions client-side
  const filteredExecutions = executions
    .filter((exec) => {
      // Status filter
      if (statusFilter !== "all" && exec.status !== statusFilter) {
        return false;
      }

      // Search filter (matches workflow name, failed step, or error message)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = exec.workflowName.toLowerCase().includes(q);
        const matchesFailedStep = exec.failedStep?.toLowerCase().includes(q) ?? false;
        const matchesError = exec.error?.toLowerCase().includes(q) ?? false;
        if (!matchesName && !matchesFailedStep && !matchesError) {
          return false;
        }
      }

      return true;
    })
    .sort((a, b) => {
      if (sort === "startedAt-desc") {
        return (
          (parseRunDate(b.startedAt)?.getTime() ?? 0) - (parseRunDate(a.startedAt)?.getTime() ?? 0)
        );
      } else if (sort === "startedAt-asc") {
        return (
          (parseRunDate(a.startedAt)?.getTime() ?? 0) - (parseRunDate(b.startedAt)?.getTime() ?? 0)
        );
      } else if (sort === "duration-desc") {
        const durationA = a.finishedAt
          ? (parseRunDate(a.finishedAt)?.getTime() ?? 0) -
            (parseRunDate(a.startedAt)?.getTime() ?? 0)
          : 0;
        const durationB = b.finishedAt
          ? (parseRunDate(b.finishedAt)?.getTime() ?? 0) -
            (parseRunDate(b.startedAt)?.getTime() ?? 0)
          : 0;
        return durationB - durationA;
      } else if (sort === "duration-asc") {
        const durationA = a.finishedAt
          ? (parseRunDate(a.finishedAt)?.getTime() ?? 0) -
            (parseRunDate(a.startedAt)?.getTime() ?? 0)
          : 0;
        const durationB = b.finishedAt
          ? (parseRunDate(b.finishedAt)?.getTime() ?? 0) -
            (parseRunDate(b.startedAt)?.getTime() ?? 0)
          : 0;
        return durationA - durationB;
      }
      return 0;
    });

  const hasActiveFilters = searchQuery || statusFilter !== "all" || sort !== "startedAt-desc";
  const totalExecutions = executions.length;
  const shownExecutions = filteredExecutions.length;

  const handleNext = () => {
    if (nextCursor) {
      setCursorHistory([...cursorHistory, nextCursor]);
      setCursor(nextCursor);
      refresh();
    }
  };

  const handlePrev = () => {
    if (cursorHistory.length > 0) {
      const newHistory = cursorHistory.slice(0, -1);
      setCursorHistory(newHistory);
      setCursor(newHistory.length > 0 ? newHistory[newHistory.length - 1] : null);
      refresh();
    }
  };

  const pageNum = cursorHistory.filter((c) => c !== null).length + 1;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  // Group executions by ISO date (yyyy-mm-dd) for the chart
  const executionsByDate = new Map<string, number>();
  executions.forEach((exec) => {
    const parsed = parseRunDate(exec.startedAt);
    if (!parsed) return;
    const date = parsed.toISOString().slice(0, 10);
    executionsByDate.set(date, (executionsByDate.get(date) ?? 0) + 1);
  });

  const chartData = Array.from(executionsByDate.entries())
    .map(([date, count]) => ({ date, executions: count }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-14); // Last 14 days

  // Next scheduled run from the API's cron occurrences
  const occurrences = (data?.schedules?.occurrences ?? []) as ReadonlyArray<{
    scheduledTime: string;
  }>;
  const now = Date.now();
  const upcoming = occurrences
    .map((o) => new Date(o.scheduledTime))
    .filter((d) => !Number.isNaN(d.getTime()) && d.getTime() > now)
    .sort((a, b) => a.getTime() - b.getTime());
  const nextRun = upcoming[0] ?? null;

  return (
    <main className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <p className="eyebrow">WORKSPACE / RUNS</p>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
            Runs & Schedule
          </h1>
          <p className="mt-2 max-w-xl text-sm text-slate-500">
            Track workflow executions and scheduled cadence for cadastre refresh operations.
          </p>
        </div>
        <Button variant="outline" onClick={refresh}>
          Refresh
        </Button>
      </div>

      {isFailure ? (
        <Card>
          <CardContent>
            <p className="font-semibold text-red-700">Unable to load runs and schedules</p>
            <p className="text-sm text-slate-500">Try refreshing when the service is online.</p>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent>
            <p className="font-medium text-slate-900">Loading runs and schedules…</p>
            <p className="mt-1 text-sm text-slate-500">
              Fetching workflow executions and schedule data.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Next Scheduled Run - at the top */}
          {schedules.length > 0 && nextRun !== null && (
            <section className="space-y-3">
              <div>
                <p className="eyebrow">NEXT EXECUTION</p>
                <h2 className="text-lg font-semibold tracking-tight text-slate-950">
                  Next scheduled run
                </h2>
              </div>
              <Card>
                <CardContent>
                  <p className="text-sm text-slate-700">
                    {nextRun.toLocaleString("en-AU", {
                      weekday: "long",
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "Australia/Sydney",
                    })}{" "}
                    <span className="text-xs text-slate-500">(Australia/Sydney)</span>
                  </p>
                </CardContent>
              </Card>
            </section>
          )}

          {/* Execution Chart - shorter height */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="eyebrow">ACTIVITY TRENDS</p>
                <h2 className="text-lg font-semibold tracking-tight text-slate-950">
                  Workflow execution history
                </h2>
              </div>
              {executions.length > 0 && (
                <span className="muted">
                  {executions.length} execution{executions.length === 1 ? "" : "s"} total
                </span>
              )}
            </div>
            {executions.length === 0 ? (
              <Card>
                <CardContent>
                  <p className="muted">No workflow executions yet.</p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="pt-6">
                  <ChartContainer
                    config={{
                      executions: {
                        label: "Executions",
                        color: "hsl(221, 83%, 53%)",
                      },
                    }}
                  >
                    <ResponsiveContainer width="100%" height={160}>
                      <BarChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis
                          dataKey="date"
                          tickFormatter={(value: string) => {
                            const date = new Date(value);
                            return date.toLocaleDateString("en-AU", {
                              month: "short",
                              day: "numeric",
                            });
                          }}
                        />
                        <YAxis />
                        <Tooltip
                          content={<ChartTooltipContent />}
                          cursor={{ fill: "rgba(0,0,0,0.05)" }}
                        />
                        <Legend />
                        <Bar
                          dataKey="executions"
                          fill="var(--color-executions)"
                          radius={[4, 4, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartContainer>
                </CardContent>
              </Card>
            )}
          </section>

          {/* Schedules section */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="eyebrow">SCHEDULES</p>
                <h2 className="text-lg font-semibold tracking-tight text-slate-950">
                  Cadastre refresh schedule
                </h2>
              </div>
              {schedules.length > 0 && (
                <span className="muted">
                  {schedules.length} schedule{schedules.length === 1 ? "" : "s"}
                </span>
              )}
            </div>
            {schedules.length === 0 ? (
              <Card>
                <CardContent>
                  <p className="muted">No schedules configured.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {schedules.map((schedule) => (
                  <Card key={schedule.id}>
                    <CardContent>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold text-slate-950">{schedule.workflowName}</p>
                          <p className="text-xs text-slate-500">{schedule.id}</p>
                        </div>
                        <Badge variant={schedule.enabled === "true" ? "default" : "outline"}>
                          {schedule.enabled === "true" ? "Enabled" : "Disabled"}
                        </Badge>
                      </div>
                      <dl className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
                        <div>
                          <dt className="text-xs text-slate-400">Expression</dt>
                          <dd className="font-mono text-xs">{schedule.expression}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-slate-400">Timezone</dt>
                          <dd>{schedule.timezone}</dd>
                        </div>
                      </dl>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>

          {/* Execution Log with filters - at the bottom */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="eyebrow">EXECUTION LOG</p>
                <h2 className="text-lg font-semibold tracking-tight text-slate-950">
                  Recent workflow executions
                </h2>
              </div>
              <p className="text-sm text-slate-600">
                Page {pageNum} / {totalPages}
              </p>
            </div>
            {executions.length === 0 ? (
              <Card>
                <CardContent>
                  <p className="muted">No workflow executions recorded yet.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {/* Filter toolbar */}
                <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      placeholder="Search by workflow, failed step, or error..."
                      value={searchQuery}
                      onChange={(e) =>
                        transitionMachine({
                          _tag: "SearchChanged",
                          query: e.target.value,
                        })
                      }
                      className="flex-1 min-w-52"
                    />
                    <Select
                      value={statusFilter}
                      onValueChange={(value) =>
                        transitionMachine({
                          _tag: "StatusFilterSet",
                          status: value as "all" | "succeeded" | "failed" | "running" | "cancelled",
                        })
                      }
                    >
                      <SelectTrigger className="w-fit">
                        <SelectValue placeholder="Status">
                          {(value: string) => statusFilterLabels[value] ?? value}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All statuses</SelectItem>
                        <SelectItem value="succeeded">Succeeded</SelectItem>
                        <SelectItem value="failed">Failed</SelectItem>
                        <SelectItem value="running">Running</SelectItem>
                        <SelectItem value="cancelled">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>

                    <div className="flex items-center gap-2">
                      <label htmlFor="runs-page-size" className="text-sm text-slate-600">
                        Rows per page
                      </label>
                      <Select
                        value={String(pageSize)}
                        onValueChange={(value) => {
                          setPageSize(Number(value));
                          setCursorHistory([]);
                          setCursor(null);
                          refresh();
                        }}
                      >
                        <SelectTrigger id="runs-page-size" className="w-20">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="10">10</SelectItem>
                          <SelectItem value="25">25</SelectItem>
                          <SelectItem value="50">50</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <Select
                      value={sort}
                      onValueChange={(value) =>
                        transitionMachine({
                          _tag: "SortChanged",
                          sort: value as
                            | "startedAt-desc"
                            | "startedAt-asc"
                            | "duration-desc"
                            | "duration-asc",
                        })
                      }
                    >
                      <SelectTrigger className="w-fit">
                        <SelectValue placeholder="Sort">
                          {(value: string) => sortLabels[value] ?? value}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="startedAt-desc">Newest first</SelectItem>
                        <SelectItem value="startedAt-asc">Oldest first</SelectItem>
                        <SelectItem value="duration-desc">Longest duration</SelectItem>
                        <SelectItem value="duration-asc">Shortest duration</SelectItem>
                      </SelectContent>
                    </Select>

                    {hasActiveFilters && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          transitionMachine({
                            _tag: "ResetFilters",
                          })
                        }
                        className="gap-1"
                      >
                        <IconX className="h-4 w-4" />
                        Reset
                      </Button>
                    )}
                  </div>

                  {shownExecutions < totalExecutions && (
                    <div className="text-xs text-slate-600">
                      Showing {shownExecutions} of {totalExecutions} executions
                    </div>
                  )}
                </div>

                {/* Executions table */}
                <Card>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50">
                            <th className="px-3 py-2 text-left font-semibold text-slate-700 w-8" />
                            <th className="px-3 py-2 text-left font-semibold text-slate-700">
                              Workflow
                            </th>
                            <th className="px-3 py-2 text-left font-semibold text-slate-700">
                              Status
                            </th>
                            <th className="px-3 py-2 text-left font-semibold text-slate-700">
                              Trigger
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredExecutions.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="px-3 py-4 text-center text-slate-500">
                                <p className="text-sm">No executions match your filters.</p>
                              </td>
                            </tr>
                          ) : (
                            filteredExecutions.map((execution) => (
                              <ExecutionRow key={execution.id} execution={execution} />
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>

                {/* Pagination controls */}
                <div className="flex items-center justify-between gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handlePrev}
                    disabled={cursorHistory.length === 0}
                  >
                    Previous
                  </Button>
                  <span className="text-sm text-slate-600">
                    Page {pageNum} / {totalPages}
                  </span>
                  <Button variant="outline" size="sm" onClick={handleNext} disabled={!nextCursor}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
