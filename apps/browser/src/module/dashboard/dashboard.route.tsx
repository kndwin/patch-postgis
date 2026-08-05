import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Link, Outlet, createFileRoute } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard")({
  component: DashboardLayout,
});

const navigation = [
  {
    to: "/dashboard/cadastre",
    label: "Cadastre",
    description: "Parcel map and syncs",
  },
  {
    to: "/dashboard/runs",
    label: "Runs & Schedule",
    description: "Executions and cadence",
  },
] as const;

function DashboardLayout() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-8">
        <header className="flex flex-col items-start justify-between gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl bg-slate-950 text-sm font-bold text-white">
              P
            </div>
            <div>
              <p className="eyebrow">PATCH / OPERATIONS</p>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
                Cadastre control room
              </h1>
            </div>
          </div>
          <Badge className="bg-emerald-50 text-emerald-700">Operations workspace</Badge>
        </header>

        <div className="flex flex-col gap-8 py-7 lg:flex-row lg:gap-8 lg:items-start">
          <Card className="p-1.5 w-full lg:w-52 lg:sticky lg:top-5">
            <nav aria-label="Dashboard sections" className="flex flex-col gap-1">
              <p className="px-3 pb-2 pt-2 text-[0.65rem] font-bold uppercase tracking-[0.16em] text-slate-400">
                Workspace
              </p>
              {navigation.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  activeOptions={{ exact: true }}
                  activeProps={{
                    className: "bg-slate-950 text-white shadow-sm",
                  }}
                  className={cn(
                    "group block rounded-lg px-3 py-2.5 text-left text-sm text-slate-600 transition hover:bg-slate-100 hover:text-slate-950",
                  )}
                >
                  <span className="block font-semibold">{item.label}</span>
                  <span className="block text-xs text-slate-400 group-[.bg-slate-950]:text-slate-300">
                    {item.description}
                  </span>
                </Link>
              ))}
            </nav>
          </Card>

          <div className="min-w-0 flex-1">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
}
