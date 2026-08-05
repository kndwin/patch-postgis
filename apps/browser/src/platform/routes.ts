import { index, rootRoute, route } from "@tanstack/virtual-file-routes";

export default rootRoute("platform/routes/root.tsx", [
  index("platform/routes/index.tsx"),
  route("/dashboard", "module/dashboard/dashboard.route.tsx", [
    route("/cadastre", "module/map/map.route.tsx"),
    route("/runs", "module/dashboard/runs.route.tsx"),
  ]),
]);
