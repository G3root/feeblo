import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

// Extends the Dayjs prototype with relative time helpers:
// .fromNow(), .from(), .toNow(), .to()
dayjs.extend(relativeTime);

export default dayjs;
