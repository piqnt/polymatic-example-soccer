import fieldSvg from "../art/field.svg?raw";
import { parseField } from "../soccer/Field";

/** The field, bundled with the client, see field.svg. */
export const FIELD = parseField(fieldSvg);
