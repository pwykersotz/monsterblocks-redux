export class debug {

	/**
	 * The current debug level setting for this module.
	 *
	 * @readonly
	 * @static
	 * @memberof debug
	 */
	static get level() {
		return game.modules.get("_dev-mode")?.api?.getPackageDebugValue("monsterblock", "level") ?? 0;
	}

	/**
	 * Whether or not the debug mode for Monster Blocks is enabled.
	 *
	 * @return {boolean} - True if debugging is enabled
	 */
	static get enabled() {
		return this.level > 0;
	}

	static get OFF()   { return this.level < 1; }
	static get INFO()  { return this.level > 0; }
	static get ERROR() { return this.level > 1; }
	static get DEBUG() { return this.level > 2; }
	static get WARN()  { return this.level > 3; }
	static get ALL()   { return this.level > 4; }
}

export function getTranslationArray(stringId) {
	let v = foundry.utils.getProperty(game.i18n.translations, stringId);
	if (v) return typeof v == "string" ? [v] : v;

	v = foundry.utils.getProperty(game.i18n._fallback, stringId);
	if (v) return typeof v === "string" ? [v] : v;

	return [stringId];
}

export function getSetting(scope, name) {
	try {
		return game.settings.get(scope, name);
	}
	catch (e) {
		return null;
	}
}

/**
 * Monster Blocks now targets dnd5e 6.x only, which always uses activities.
 * Kept so that any third-party code importing this helper keeps working.
 *
 * @return {boolean}
 */
export function isDndV4OrNewer() {
	return true;
}

/**
 * Get the first activity on an item, optionally of a specific type.
 *
 * @param {Item5e} item
 * @param {string} [type]
 * @return {Activity|undefined}
 */
export function getActivity(item, type) {
	const activities = item?.system?.activities;
	if (!activities) return undefined;
	if (type) return activities.find(a => a.type === type);
	return activities.contents?.[0] ?? Array.from(activities)[0];
}

/**
 * Get all activities on an item as an array.
 *
 * @param {Item5e} item
 * @return {Activity[]}
 */
export function getActivities(item) {
	const activities = item?.system?.activities;
	if (!activities) return [];
	return activities.contents ?? Array.from(activities);
}

/**
 * Split a semicolon separated list into trimmed, non-empty entries.
 *
 * @param {string} input
 * @return {string[]}
 */
export function splitSemicolons(input = "") {
	return String(input ?? "").split(";").map(s => s.trim()).filter(s => s);
}

/**
 * Evaluate a numeric expression typed into a field.
 *
 * This replaces the old Input Expressions / Math.js dependency with Foundry's own
 * Roll parser, which handles arithmetic, dice, Math functions and `@` roll data.
 *  - A leading operator (+, -, *, /) applies the expression to the current value.
 *  - A leading `=` sets the value absolutely, even if it is negative.
 *
 * @param {string} raw         - The text entered
 * @param {number} current     - The current value of the field
 * @param {object} rollData    - Roll data for @ references
 * @return {number}
 */
export function evaluateExpression(raw, current, rollData = {}) {
	let value = String(raw ?? "").trim();
	if (value === "") return "";

	current = Number(current) || 0;
	if (value.startsWith("=")) value = value.slice(1).trim();
	else if (/^[+\-*/]/.test(value)) value = `${current} ${value}`;

	if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);

	const roll = new Roll(value, rollData);
	try {
		roll.evaluateSync({ strict: false });
	}
	catch (e) {
		roll.evaluateSync();
	}

	const total = Number(roll.total);
	if (!Number.isFinite(total)) throw new Error(`The expression "${raw}" did not have a numeric result.`);
	return total;
}

/**
 * Included From Foundry VTT FormDataExtended#castType
 * Used under the Limited License Agreement for Module Development
 * @see https://foundryvtt.com/article/license/
 * No other license is granted for this code.
 */

/**
 * Cast a processed value to a desired data type.
 * @param {any} value         The raw field value
 * @param {string} dataType   The desired data type
 * @returns {any}             The resulting data type
 * @private
 */
export function castType(value, dataType) {
	if (value instanceof Array) return value.map(v => castType(v, dataType));
	if ([undefined, null].includes(value) || (dataType === "String")) return value;

	// Boolean
	if (dataType === "Boolean") {
		if (value === "false") return false;
		return Boolean(value);
	}

	// Number
	else if (dataType === "Number") {
		if ((value === "") || (value === "null")) return null;
		return Number(value);
	}

	// Serialized JSON
	else if (dataType === "JSON") {
		return JSON.parse(value);
	}

	// Other data types
	if (window[dataType] instanceof Function) {
		try {
			return window[dataType](value);
		} catch (err) {
			console.warn(`The form field value "${value}" was not able to be cast to the requested data type ${dataType}`);
		}
	}
	return value;
}

/** End of Foundry VTT Code */
