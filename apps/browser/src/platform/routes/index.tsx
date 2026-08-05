import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl items-center px-6 py-12">
      <Card className="w-full">
        <CardContent className="space-y-4">
          <p className="eyebrow">PATCH / CADASTRE</p>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
            Operations dashboard
          </h1>
          <p className="text-slate-600">
            Monitor cadastre snapshots and workflow execution projections.
          </p>
          <Link to="/dashboard/cadastre">
            <Button>Open dashboard</Button>
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
