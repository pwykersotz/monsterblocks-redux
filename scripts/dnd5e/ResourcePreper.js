import { getActivities } from "../utilities.js";

export default class ResourcePreper {
	/**
	 * Creates an instance of ResourcePreper.
	 *
	 * @param {object} templateData
	 * @param {Item5e} item
	 * @memberof ResourcePreper
	 */
	constructor (templateData, item, sheet) {
		this.templateData = templateData;
		this.item = item;
		this.sheet = sheet;
		this.res = {};
	}

	/**
	 * Get the first consumption target from any of the item's activities.
	 *
	 * @static
	 * @param {Item5e} item
	 * @return {object|undefined} - The consumption target `{ type, target, value }`
	 * @memberof ResourcePreper
	 */
	static getConsumptionTarget(item) {
		for (const activity of getActivities(item)) {
			const targets = Array.from(activity.consumption?.targets ?? []);
			// Consuming the item's own uses is represented by its "charges" instead.
			const target = targets.find(t => t?.type && t.type !== "activityUses" && !(t.type === "itemUses" && !t.target));
			if (target) return target;
		}
		return undefined;
	}

	/**
	 * Checks whether or not an item has a resource limitation
	 *
	 * @static
	 * @param {Item5e} item - The item to check
	 * @return {boolean}
	 * @memberof ResourcePreper
	 */
	static hasResource(item) {
		return Boolean(
			   item.type == "consumable"
			|| item.type == "loot"
			|| this.hasCharges(item)
			|| this.getConsumptionTarget(item)
		);
	}

	/**
	 * Whether or not an item has limited uses that are not just a recharge.
	 * Recharge abilities are shown with their own "(Recharge X-6)" label instead.
	 *
	 * @static
	 * @param {Item5e} item
	 * @return {boolean}
	 * @memberof ResourcePreper
	 */
	static hasCharges(item) {
		if (!item.system.uses?.max) return false;
		const recovery = Array.from(item.system.uses.recovery ?? []);
		return !(recovery.length && recovery.every(r => r.period === "recharge"));
	}

	/**
	 * Returns the prepared resource.
	 *
	 * @return {*}
	 */
	getResource() {
		if (!this.templateData.hasresource) return null;

		this.setType();
		this.prep();

		return this.res;
	}

	/**
	 * Determines the resource type
	 *
	 * @memberof ResourcePreper
	 */
	setType() {
		if (this.item.type == "consumable" || this.item.type == "loot")
			this.res.type = "consume";
		else if (this.constructor.hasCharges(this.item))
			this.res.type = "charges";
		else
			this.res.type = this.constructor.getConsumptionTarget(this.item)?.type;
	}

	/**
	 * Prepare the resources.
	 *
	 * Delegates preparation to the appropriate method
	 * depending on resource type.
	 *
	 * @memberof ResourcePreper
	 */
	prep() {
		switch (this.res.type) {
			case "attribute":
				this.prepAttribute();
				break;
			case "charges":
				this.prepCharges();
				break;
			case "itemUses":
				this.prepItemUses();
				break;
			case "material":
			case "ammo":
				this.prepMaterial();
				break;
			case "consume":
				this.prepConsume();
				break;
			case "spellSlots":
				this.prepSpellSlots();
				break;
		}
	}

	/**
	 * Get a label for the recovery period of an item's uses.
	 *
	 * @param {Item5e} item
	 * @return {string}
	 */
	getRefresh(item) {
		const recovery = Array.from(item.system.uses?.recovery ?? []).find(r => r.period !== "recharge");
		const period = recovery ? CONFIG.DND5E.limitedUsePeriods[recovery.period] : null;
		return period?.label ?? game.i18n.localize("MOBLOKS5E.ResourceRefresh");
	}

	/**
	 * Prepares items that consume a particular attribute of the actor.
	 *
	 * @memberof ResourcePreper
	 */
	prepAttribute() {
		const target = this.constructor.getConsumptionTarget(this.item)?.target ?? "";
		const parts = target.split(".");
		const field = parts.pop();
		const base = parts.join(".");

		// Attributes like legendary actions are now tracked as "spent", show the remaining value instead.
		const valueKey = field === "spent" ? `system.${base}.value` : `system.${target}`;

		this.res.target = valueKey;
		this.res.current = foundry.utils.getProperty(this.sheet.actor, valueKey);
		this.res.limit = foundry.utils.getProperty(this.sheet.actor, `system.${base}.max`);
		this.res.refresh = game.i18n.localize("MOBLOKS5E.ResourceRefresh");
	}
	/**
	 * Prepares items that have charges
	 *
	 * @memberof ResourcePreper
	 */
	prepCharges() {
		this.res.target = "system.uses.value";
		this.res.entity = this.item.id;
		this.res.current = this.item.system.uses.value;
		this.res.limit = this.item.type == "spell" ? false : this.item.system.uses.max;
		this.res.limTarget = "system.uses.max";
		this.res.refresh = this.getRefresh(this.item);
	}
	/**
	 * Prepares items that consume the uses of another item
	 *
	 * @memberof ResourcePreper
	 */
	prepItemUses() {
		const id = this.constructor.getConsumptionTarget(this.item)?.target;
		const other = this.sheet.actor.items.get(id);
		if (!other) return;

		this.res.type = "charges";
		this.res.entity = other.id;
		this.res.target = "system.uses.value";
		this.res.current = other.system.uses?.value;
		this.res.limit = other.system.uses?.max;
		this.res.limTarget = "system.uses.max";
		this.res.refresh = this.getRefresh(other);
		if (other.id !== this.item.id) this.res.name = other.name;
	}
	/**
	 * Prepares items that consume material components/loot
	 *
	 * @return {*}
	 * @memberof ResourcePreper
	 */
	prepMaterial() {
		this.res.entity = this.constructor.getConsumptionTarget(this.item)?.target;
		let ammo = this.sheet.actor.items.get(this.res.entity);
		if (!ammo) return;

		this.res.limit = false;
		this.res.current = ammo.system.quantity;
		this.res.target = "system.quantity";
		this.res.name = ammo.name;
	}
	/**
	 * Prepares items that consume spell slots
	 *
	 * @memberof ResourcePreper
	 */
	prepSpellSlots() {
		const target = this.constructor.getConsumptionTarget(this.item)?.target;
		const key = Number.isNumeric?.(target) ? `spell${target}` : target;
		const slot = this.sheet.actor.system.spells?.[key];
		if (!slot) return;

		this.res.target = `system.spells.${key}.value`;
		this.res.current = slot.value;
		this.res.limit = slot.max;
		this.res.refresh = game.i18n.localize("MOBLOKS5E.ResourceRefresh");
	}
	/**
	 * Prepares items that consume consumables such as ammunition
	 *
	 * @memberof ResourcePreper
	 */
	prepConsume() {
		this.res.entity = this.item.id;
		this.res.limit = false;
		this.res.current = this.item.system.quantity;
		this.res.target = "system.quantity";
	}
}
