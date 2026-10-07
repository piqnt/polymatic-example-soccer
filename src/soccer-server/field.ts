import { readFileSync } from "fs";

import { parseField } from "../soccer/Field";

/** The field, read once when the server starts, see field.svg. */
export const FIELD = parseField(readFileSync(new URL("../art/field.svg", import.meta.url), "utf8"));
