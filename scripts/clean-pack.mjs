// `taco pack` regenerates these files in the repository root and stops on an interactive
// "overwrite?" prompt when they already exist (which hangs CI): remove them first.
import { rmSync } from "node:fs";

for (const f of ["manifest.xml", "connection-fields.xml", "connection-metadata.xml"]) rmSync(f, { force: true });
for (const f of (await import("node:fs")).readdirSync(".").filter((n) => n.endsWith(".taco"))) rmSync(f, { force: true });
