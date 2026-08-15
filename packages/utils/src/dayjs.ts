/** biome-ignore-all lint/style/noExportedImports: the dayjs singleton must be extended before export; a plain `export from` would bypass the extend call. */
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

// Extends the Dayjs prototype with relative time helpers:
// .fromNow(), .from(), .toNow(), .to()
dayjs.extend(relativeTime);

export default dayjs;
