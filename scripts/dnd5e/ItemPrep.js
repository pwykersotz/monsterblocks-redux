import MonsterBlock5e from "./MonsterBlock5e.js";
import AttackPreper from "./AttackPreper.js";
import CastingPreper from "./CastingPreper.js";
import ActionPreper from "./ActionPreper.js";
import ItemPreper from "./ItemPreper.js";
import InnateSpellbookPrep from "./InnateSpellbookPrep.js"

/**
 * @typedef {import{"../../../../systems/dnd5e/module/item/sheet.js"}.Item5e} Item5e
 */

/**
 * Defines an item classification
 *
 * @typedef   Feature
 * @property {typeof ItemPreper} prep         - An item preparation class for this type of item
 * @property {Function}          filter       - A filtering function to locate items of this type
 * @property {Array}             items        - An array of items of this type
 * @property {object}            dataset      - An object of additional data
 * @property {string}            dataset.type - The "type" of the item that dnd5e recognizes
*/

export default class ItemPrep {
	/**
	 * Creates an instance of ItemPrep.
	 *
	 * @param {MonsterBlock5e} sheet
	 * @param {object}         data
	 * @memberof ItemPrep
	 */
	constructor(sheet, data) {
		this.sheet = sheet;
		this.data = data;
		this.data.features = this.features;

		this.prepareItems();
	}
	
	/** @type {Object.<string, Feature>} A set of item classifications by type */
	features = {
		legResist:	  { prep: ItemPreper,    filter: item => MonsterBlock5e.isLegendaryResistance(item), items: [], dataset: {type: "feat"}   },
		legendary:	  { prep: ActionPreper,  filter: item => MonsterBlock5e.isLegendaryAction(item),     items: [], dataset: {type: "feat"}   },
		lair:		  { prep: ActionPreper,  filter: item => MonsterBlock5e.isLairAction(item),          items: [], dataset: {type: "feat"}   },
		multiattack:  { prep: ActionPreper,  filter: item => MonsterBlock5e.isMultiAttack(item),         items: [], dataset: {type: "feat"}   },
		casting:	  { prep: CastingPreper, filter: item => CastingPreper.isCasting(item),              items: [], dataset: {type: "feat"}   },
		reaction:	  { prep: ActionPreper,  filter: item => MonsterBlock5e.isReaction(item),            items: [], dataset: {type: "feat"}   },
		bonusActions: { prep: ActionPreper,  filter: item => MonsterBlock5e.isBonusAction(item),         items: [], dataset: {type: "feat"}   },
		attacks:	  { prep: AttackPreper,  filter: item => AttackPreper.isAttack(item),                items: [], dataset: {type: "weapon"} },
		actions:	  { prep: ActionPreper,  filter: item => MonsterBlock5e.isAction(item),              items: [], dataset: {type: "feat"}   },
		features:	  { prep: ItemPreper,    filter: item => item.type === "feat",                       items: [], dataset: {type: "feat"}   },
		equipment:	  { prep: ItemPreper,    filter: () => true,                                         items: [], dataset: {type: "loot"}   }
	};
	
	/**
	 * Classify all items, prepare them, and prepare spellbooks.
	 *
	 * @memberof ItemPrep
	 */
	prepareItems() {
		const spells = this.data.items.filter(item => item.type === "spell");
		const other = this.data.items.filter(item => item.type !== "spell");
		this.organizeSpellbooks(spells);
		this.organizeFeatures(other);
	}

	/**
	 * Prepares and organizes the regular and innate spellbooks
	 *
	 * @param {array} spells - All the spell items
	 * @memberof ItemPrep
	 */
	organizeSpellbooks(spells) {
		this.data.spellbook = this.constructor.prepareSpellbook(this.sheet.actor, spells);
		this.data.innateSpellbook = new InnateSpellbookPrep(this.data.spellbook, this.sheet).prepare();
	}

	/**
	 * Organize spells into "pages" by spellcasting method and level.
	 *
	 * This reproduces the structure of the spellbook from older versions of
	 * the dnd5e system so the rest of Monster Blocks can work with it:
	 *  - At-will spells:  order -20, prop "atwill"
	 *  - Innate spells:   order -10, prop "innate"
	 *  - Cantrips:        order 0
	 *  - Pact magic:      order 0.5, prop "pact"
	 *  - Leveled spells:  order = spell level, prop "spellN"
	 *
	 * @static
	 * @param {Actor5e} actor
	 * @param {object[]} spells - Item contexts for spells
	 * @return {object[]}
	 * @memberof ItemPrep
	 */
	static prepareSpellbook(actor, spells) {
		const book = {};
		const slots = actor.system.spells ?? {};

		const getPage = (prop, order, level, label) => {
			if (book[prop]) return book[prop];
			const slot = slots[prop] ?? {};
			return book[prop] = {
				label,
				order,
				prop,
				spells: [],
				uses: slot.value ?? 0,
				slots: slot.max ?? 0,
				override: slot.override ?? null,
				usesSlots: Boolean(slot.max),
				canCreate: false,
				canPrepare: false,
				dataset: { level, type: "spell" }
			};
		};

		for (const spell of spells) {
			const system = spell.system;
			const method = system.method ?? system.preparation?.mode ?? "spell";
			const level = Number(system.level) || 0;

			// Spells granted by other items are not part of the stat block.
			if (spell.document?.getFlag?.("dnd5e", "cachedFor")) continue;

			let page;
			switch (method) {
				case "atwill":
					page = getPage("atwill", -20, level, game.i18n.localize("MOBLOKS5E.AtWill"));
					break;
				case "innate":
					page = getPage("innate", -10, level, CONFIG.DND5E.spellcasting?.innate?.label ?? "Innate");
					break;
				case "pact":
					page = level === 0
						? getPage("spell0", 0, 0, CONFIG.DND5E.spellLevels?.[0] ?? "")
						: getPage("pact", 0.5, level, CONFIG.DND5E.spellcasting?.pact?.label ?? "Pact");
					break;
				default:
					page = getPage(`spell${level}`, level, level, CONFIG.DND5E.spellLevels?.[level] ?? String(level));
			}
			page.spells.push(spell);
		}

		return Object.values(book).sort((a, b) => a.order - b.order);
	}

	/**
	 * Sort and prepare all non-spell items
	 *
	 * @param {array} items
	 * @memberof ItemPrep
	 */
	organizeFeatures(items) {
		for (let item of items) {
			const category = Object.values(this.features).find(cat => cat.filter(item));
			try {
				this.prepareItem(category, item, this.data);
			}
			catch (err) {
				console.error(`Monster Blocks | Failed to prepare item "${item.name}" (${item._id})`, err);
			}
			category.items.push(item);
		}
	}

	/**
	 * Create an instance of the appropriate item preparer, 
	 * then prepare the item and its resources.
	 *
	 * @param {Feature} category - The type of item
	 * @param {Item5e} item      - The instance of the item
	 * @param {object} data      - The data for the template
	 * @return {void} 
	 * @memberof ItemPrep
	 */
	prepareItem(category, item, data) {
		const preparer = new category.prep(this.sheet, item, data);
		preparer.prepResources();
		preparer.prepare();
	}
}