import MonsterBlock5e from "./MonsterBlock5e.js";
import Helpers from "./Helpers5e.js";
import { debug, getActivity } from "../utilities.js";
import ItemPreper from "./ItemPreper.js";

/* global dnd5e:readonly */

/**
 * Prepares the data for an Attack item
 *
 * @export
 * @class AttackPreper
 * @extends {ItemPreper}
 */
export default class AttackPreper extends ItemPreper {
	/**
	 * Determine whether an item should be displayed as an attack.
	 *
	 * @static
	 * @param {Item5e|object} item
	 * @return {boolean}
	 * @memberof AttackPreper
	 */
	static isAttack(item) {
		const document = item.document ?? item;
		return document.type === "weapon" || Boolean(getActivity(document, "attack"));
	}

	/**
	 * The attack activity of this item.
	 *
	 * @type {Activity|undefined}
	 * @readonly
	 * @memberof AttackPreper
	 */
	get activity() {
		if (this._activity === undefined) this._activity = getActivity(this.item, "attack") ?? null;
		return this._activity;
	}

	/**
	 * @override
	 * @memberof AttackPreper
	 */
	prepare() {
		this.data.tohit = this.activity?.labels?.toHit ?? this.item.labels?.attacks?.[0]?.toHit ?? "";
		this.data.description = this.getDescription();
		this.data.continuousDescription =
			Helpers.isContinuousDescription(this.item.system.description?.value ?? "");

		if (debug.enabled) console.debug(this);
	}

	/**
	 * @typedef AttackDescription
	 * @property {string} attackType        - Type of attack, melee vs ranged, weapon, etc.
	 * @property {string} tohit             - Bonus to hit
	 * @property {string} range             - Range or reach
	 * @property {string} target            - What type of target, and how many
	 * @property {DamageData} versatile     - The damage and formula for versatile damage
	 * @property {Array<DamageData>} damage - All of the damage formulas for all types of additional damage
	 *
	 *//**
	 * Constructs the data for this attack's description
	 *
	 * @return {AttackDescription}
	 * @memberof AttackPreper
	 */
	getDescription() {
		const damage = this.getAllDamageData();
		return {
			attackType: this.getAttackType(),
			tohit: this.formatToHit(),
			range: this.formatRange(),
			target: this.formatTarget(),
			versatile: this.getVersatileData(),
			damage
		};
	}

	/**
	 * Formats the "to hit" part of the description.
	 *
	 * "{+/-bonus} to hit"
	 *
	 * @return {string}
	 * @memberof AttackPreper
	 */
	formatToHit() {
		const tohit = String(this.data.tohit || "0").replace(/\s+/g, "");
		const bonus = ["+", "-"].includes(tohit.charAt(0)) ? tohit : `+${tohit}`;

		return game.i18n.format("MOBLOKS5E.AttackToHit", { bonus });
	}

	/**
	 * Formats the range part of the description
	 *
	 * "{reachRange} {range}{sep}{max} {units}.",
	 *
	 * @return {string}
	 * @memberof AttackPreper
	 */
	formatRange() {
		const ranged = this.isRangedAttack();
		const itemRange = this.item.system.range ?? {};
		const activityRange = this.activity?.range ?? {};
		const useActivity = this.item.type !== "weapon" || activityRange.override;

		let range, longRange, units;
		if (ranged) {
			range = useActivity ? activityRange.value : itemRange.value;
			longRange = useActivity ? null : itemRange.long;
			units = (useActivity ? activityRange.units : itemRange.units) || "ft";
		}
		else {
			range = (useActivity ? activityRange.value : (itemRange.reach || itemRange.value)) || 5;
			units = (useActivity ? activityRange.units : itemRange.units) || "ft";
			if (!["ft", "m", "mi", "km"].includes(units)) units = "ft";
		}

		const reachRange = game.i18n.localize(
			ranged                              // If the attack is ranged
				? "MOBLOKS5E.range"             // Localize range, otherwise reach
				: "MOBLOKS5E.reach"
		);

		return game.i18n.format("MOBLOKS5E.AttackRange", {
			reachRange,
			range: range ?? "",
			sep: longRange && longRange != range ? "/" : "",
			max: longRange && longRange != range ? longRange : "",
			units
		});
	}

	/**
	 * Formats the target(s) part of the description.
	 *
	 * @return {string}
	 * @memberof AttackPreper
	 */
	formatTarget() {
		const condition = this.activity?.activation?.condition;
		if (condition) return condition; // if the user has specified a custom targeting condition, use that instead of 1 target / 1 creature

		const affects = this.activity?.target?.affects ?? {};
		const count = Number(affects.count) || 1;
		const quantity = Helpers.getNumberString(count);
		const config = CONFIG.DND5E.individualTargetTypes?.[affects.type];

		let type = config?.label ? game.i18n.localize(config.label).toLowerCase() : "";
		if (!type) type = count > 1                     // If the type wasn't defined, then
			? game.i18n.localize("MOBLOKS5E.targetS")   // if the value is greater than one it's plural
			: game.i18n.localize("MOBLOKS5E.target");   // Otherwise singular

		return game.i18n.format("MOBLOKS5E.AttackTarget", { quantity, type });
	}

	/**
	 * @typedef DamageData
	 * @property {string} text    - The textual description of the damage being dealt
	 * @property {string} formula - The rollable formula for the damage
	 *//**
	 * Compute simplified damage formulas and types from the attack activity.
	 *
	 * @param {object} [config] - Additional roll configuration, e.g. `{ attackMode: "twoHanded" }`
	 * @return {Array<{formula: string, types: string[]}>}
	 * @memberof AttackPreper
	 */
	getDamageParts(config = {}) {
		const activity = this.activity;
		if (!activity?.getDamageConfig) return [];

		const simplify = dnd5e.dice.simplifyRollFormula;
		const aggregate = dnd5e.dice.aggregateDamageRolls;
		const DamageRoll = CONFIG.Dice.DamageRoll;

		try {
			const rollData = activity.getRollData({ deterministic: true });
			const rollConfig = activity.getDamageConfig({ ...config }, { formulaOptions: { modifiers: false }, rollData });
			let rolls = rollConfig.rolls.map(({ base, data, options, parts }) => {
				const formula = parts.filter(p => p !== "").join(" + ");
				if (!formula) return null;
				try {
					return new DamageRoll(formula, data, { base, ...options });
				}
				catch (err) {
					return null;
				}
			}).filter(r => r);
			if (aggregate) rolls = aggregate(rolls);

			return rolls.map(roll => {
				let formula = roll.formula;
				try {
					roll.simplify?.();
					formula = simplify(roll.formula, { preserveFlavor: false });
				}
				catch (err) { /* Keep the unsimplified formula */ }
				const types = roll.options.types ?? (roll.options.type ? [roll.options.type] : []);
				return { formula, types };
			});
		}
		catch (err) {
			console.warn(`Monster Blocks | Unable to prepare damage for ${this.item.name}`, err);
			return [];
		}
	}

	/**
	 * Returns data for formatting versatile damage
	 *
	 * @return {DamageData|false}
	 * @memberof AttackPreper
	 */
	getVersatileData() {
		if (!this.item.system.isVersatile) return false;
		const [part] = this.getDamageParts({ attackMode: "twoHanded" });
		if (!part) return false;
		return this.getDamageData(part);
	}

	/**
	 * Returns data for formatting damage of all damage parts
	 *
	 * @return {Array<DamageData>}
	 * @memberof AttackPreper
	 */
	getAllDamageData() {
		return this.getDamageParts().map(this.getDamageData.bind(this));
	}

	/**
	 * Returns the data for a damage roll
	 *
	 * @param {{formula: string, types: string[]}} part
	 * @return {DamageData}
	 * @memberof AttackPreper
	 */
	getDamageData(part) {
		return {
			text: this.formatAttackAndDamage(part),
			formula: part.formula
		};
	}

	/**
	 * Formats the attack and damage part of the description.
	 *
	 * "{average} ({formula}) {type}"
	 *
	 * @param {{formula: string, types: string[]}} part
	 * @return {string}
	 * @memberof AttackPreper
	 */
	formatAttackAndDamage(part) {
		const labels = part.types.map(t =>
			CONFIG.DND5E.damageTypes[t]?.label ?? CONFIG.DND5E.healingTypes?.[t]?.label ?? t
		).map(l => game.i18n.localize(l).toLowerCase());
		const type = labels.length > 1
			? game.i18n.getListFormatter({ type: "disjunction" }).format(labels)
			: (labels[0] ?? "");

		const average = MonsterBlock5e.averageRoll(part.formula, {});
		const deterministic = this.isDeterministic(part.formula);

		if (deterministic) return `${average} ${type}`.trim();

		return game.i18n.format("MOBLOKS5E.AttackDamageTemplate", {
			average,
			formula: part.formula,
			type
		});
	}

	/**
	 * Whether or not a formula contains any dice.
	 *
	 * @param {string} formula
	 * @return {boolean}
	 */
	isDeterministic(formula) {
		try {
			return new Roll(formula).isDeterministic;
		}
		catch (e) {
			return false;
		}
	}

	/**
	 * The action type of the attack, e.g. "mwak"
	 *
	 * @type {string}
	 * @readonly
	 */
	get actionType() {
		const activity = this.activity;
		if (!activity) return "";
		try {
			return activity.actionType ?? activity.getActionType?.() ?? "";
		}
		catch (e) {
			return "";
		}
	}

	/**
	 * Determine which type of attack this is.
	 *
	 * @return {string}
	 * @memberof AttackPreper
	 */
	getAttackType() {
		const label = CONFIG.DND5E.itemActionTypes?.[this.actionType];
		return label ? game.i18n.localize(label) : "";
	}

	/**
	 * Determine if this attack is ranged or not
	 *
	 * @return {Boolean}
	 * @memberof AttackPreper
	 */
	isRangedAttack() {
		return ["rwak", "rsak"].includes(this.actionType);
	}

	/**
	 * Whether or not this attack deals any damage
	 *
	 * @return {Boolean}
	 * @memberof AttackPreper
	 */
	dealsDamage() {
		return this.getDamageParts().length > 0;
	}
}
