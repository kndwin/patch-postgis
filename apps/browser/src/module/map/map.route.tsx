import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import { createFileRoute } from "@tanstack/react-router";
import { Option } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { Snapshot, SyncRun } from "@patch/http-contract";
import { initialSyncState, type SyncState } from "./map.machine";
import {
  cadastreFailureAtom,
  cadastreLoadedAtom,
  cadastreLoadingAtom,
  cadastreMachineAtom,
} from "./cadastre.machine";
import "mapbox-gl/dist/mapbox-gl.css";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/dashboard/cadastre")({
  component: CadastrePage,
});

const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string | undefined;

function ParcelMap({ archiveUrl }: { archiveUrl: string | null | undefined }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!container.current || !token || !archiveUrl) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: container.current,
      style: "mapbox://styles/mapbox/light-v11",
      center: [151.2093, -33.8688],
      zoom: 13.5,
    });
    map.on("load", () => {
      map.addSource("parcels", {
        type: "vector",
        url: archiveUrl,
        minzoom: 14,
        maxzoom: 18,
        promoteId: "id",
      });
      map.addLayer({
        id: "parcels-fill",
        type: "fill",
        source: "parcels",
        "source-layer": "lots",
        paint: { "fill-color": "#2455d6", "fill-opacity": 0.28 },
      });
      map.addLayer({
        id: "parcels-line",
        type: "line",
        source: "parcels",
        "source-layer": "lots",
        paint: { "line-color": "#173b9b", "line-width": 1 },
      });
    });
    return () => map.remove();
  }, [archiveUrl]);
  if (!token || !archiveUrl)
    return (
      <div className="map-placeholder">
        <strong>{!token ? "Map preview unavailable" : "Map not published"}</strong>
        <span>
          {!token
            ? "Set VITE_MAPBOX_ACCESS_TOKEN to enable Mapbox."
            : "No published PMTiles archive is available yet."}
        </span>
      </div>
    );
  return <div ref={container} className="map" aria-label="Cadastre parcel map" />;
}

function formatTimestamp(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function SyncAttempt({ run }: { run: SyncRun }) {
  const detail = run.error ?? run.message;
  return (
    <Card className="sync-attempt">
      <CardContent>
        <div className="sync-attempt-heading">
          <div>
            <span className="label">SYNC ATTEMPT</span>
            <strong className="sync-attempt-id">{run.id}</strong>
          </div>
          <Badge className={run.status === "failed" ? "badge-error" : ""}>{run.status}</Badge>
        </div>
        <dl className="sync-attempt-details">
          <div>
            <dt>Phase</dt>
            <dd>{run.phase}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>{run.source ?? "—"}</dd>
          </div>
          <div>
            <dt>Started</dt>
            <dd>{formatTimestamp(run.startedAt)}</dd>
          </div>
          <div>
            <dt>Finished</dt>
            <dd>{formatTimestamp(run.finishedAt)}</dd>
          </div>
        </dl>
        {run.progress !== null && (
          <div className="sync-attempt-progress">
            <div className="sync-attempt-progress-label">
              <span>Progress</span>
              <span>{run.progress}%</span>
            </div>
            <Progress value={run.progress} />
          </div>
        )}
        <p className={run.error ? "sync-attempt-error" : "muted"}>
          <span className="sync-attempt-message-label">{run.error ? "Error" : "Message"}: </span>
          {detail ?? "No error or message supplied"}
        </p>
      </CardContent>
    </Card>
  );
}

export function CadastrePage() {
  const loadingResult = useAtomValue(cadastreLoadingAtom);
  const loadedResult = useAtomValue(cadastreLoadedAtom);
  const failureResult = useAtomValue(cadastreFailureAtom);
  const send = useAtomSet(cadastreMachineAtom.send);
  const loaded = AsyncResult.isSuccess(loadedResult)
    ? Option.getOrUndefined(loadedResult.value)
    : undefined;
  const failure = AsyncResult.isSuccess(failureResult)
    ? Option.getOrUndefined(failureResult.value)
    : undefined;
  const loading =
    loadingResult.waiting || (AsyncResult.isSuccess(loadingResult) && loadingResult.value);
  const error =
    AsyncResult.isFailure(loadingResult) ||
    AsyncResult.isFailure(loadedResult) ||
    AsyncResult.isFailure(failureResult)
      ? "Status unavailable"
      : failure
        ? failure.message
        : undefined;
  const snapshot = loaded ? (loaded.snapshot as Snapshot | null) : null;
  const runs = loaded ? (loaded.runs as readonly SyncRun[]) : [];
  const latest = runs[0];
  const sync: SyncState = latest
    ? {
        phase: latest.phase as SyncState["phase"],
        progress: latest.progress,
        message: latest.message ?? "No progress message supplied",
      }
    : initialSyncState;
  return (
    <main className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <p className="eyebrow">PATCH / CADASTRE</p>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
            Published cadastre
          </h1>
          <p className="mt-2 max-w-xl text-sm text-slate-500">
            Verify the published snapshot and parcel map before operational work begins.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge>Production API</Badge>
          <Button variant="outline" onClick={() => send({ _tag: "Refresh" })} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh status"}
          </Button>
        </div>
      </header>
      <section className="stats" aria-label="Published snapshot status">
        <Card>
          <CardContent>
            <span className="label">CURRENT SNAPSHOT</span>
            <strong>{snapshot?.version ?? "No snapshot"}</strong>
            <span className="muted">
              {snapshot
                ? new Date(snapshot.importedAt).toLocaleString()
                : (error ?? "No published snapshot is available")}
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <span className="label">PARCEL FEATURES</span>
            <strong>{snapshot?.lotCount.toLocaleString() ?? "--"}</strong>
            <span className="muted">{snapshot ? "Current snapshot" : "Unavailable"}</span>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <span className="label">LATEST SYNC PHASE</span>
            <strong>{sync.phase}</strong>
            <Progress value={sync.progress ?? 0} />
            <span className="muted">
              {sync.progress === null
                ? "Progress unavailable"
                : `${sync.progress}% · ${sync.message}`}
            </span>
          </CardContent>
        </Card>
      </section>
      <section className="map-card">
        <div className="map-heading">
          <div>
            <p className="eyebrow">GEOSPATIAL COVERAGE</p>
            <h2>Cadastre parcels</h2>
          </div>
          <span className="muted">{snapshot?.pmtilesStatus ?? "PMTiles status unavailable"}</span>
        </div>
        <ParcelMap archiveUrl={snapshot?.pmtilesUrl} />
      </section>
      <section className="sync-attempts" aria-labelledby="sync-attempts-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">PIPELINE HISTORY</p>
            <h2 id="sync-attempts-heading">Sync attempts</h2>
          </div>
          {!loading && !error && (
            <span className="muted">
              {runs.length} attempt{runs.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
        {loading ? (
          <Card>
            <CardContent>
              <p className="muted">Loading sync attempts…</p>
            </CardContent>
          </Card>
        ) : error ? (
          <Card>
            <CardContent>
              <p className="sync-attempt-error">Unable to load sync attempts: {error}</p>
            </CardContent>
          </Card>
        ) : runs.length === 0 ? (
          <Card>
            <CardContent>
              <p className="muted">No sync attempts have been recorded.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="sync-attempt-list">
            {runs.map((run) => (
              <SyncAttempt key={run.id} run={run} />
            ))}
          </div>
        )}
      </section>
      <footer>
        {snapshot?.pmtilesUrl ? "PMTiles archive configured" : "No PMTiles archive published"}
        {runs.length > 0 ? ` · ${runs.length} sync run(s)` : " · No sync runs"}
        {error ? ` · ${error}` : ""}
      </footer>
    </main>
  );
}
