// Thin entrypoint – all sync logic lives in the cadastre sync module.
// The CLI file bootstraps its own `BunRuntime.runMain`; importing it is
// enough to execute the sync program with Bun.
import "../module/cadastre/sync/cadastre.sync.cli";
