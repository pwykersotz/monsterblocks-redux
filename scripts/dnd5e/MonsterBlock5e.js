import { MenuItem, MenuTree } from "../MenuTree.js";
import { debug, getTranslationArray, castType, evaluateExpression, getActivity, getActivities, splitSemicolons } from "../utilities.js";
import ItemPrep from "./ItemPrep.js";
import Flags from "./Flags5e.js";
import PopupHandler from "../PopupHandler.js";

/* global QuickInsert:readonly */
/* global dnd5e:readonly */

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

/** Path prefix for all templates */
const TEMPLATE_PATH = "modules/monsterblock/templates/dnd5e";

/** Icons used to show proficiency levels in menus */
const PROFICIENCY_ICONS = {
	0:   '<i class="far fa-circle"></i>',
	0.5: '<i class="fas fa-adjust"></i>',
	1:   '<i class="fas fa-check"></i>',
	2:   '<i class="fas fa-check-double"></i>'
};

/** The ID this sheet is registered under. Kept as `dnd5e.MonsterBlock5e` so existing actors keep their sheet. */
export const SHEET_ID = "dnd5e.MonsterBlock5e";

/** The ID of the dnd5e system's default NPC sheet. */
export const DEFAULT_NPC_SHEET_ID = "dnd5e.NPCActorSheet";

/**
 * Main class for the Monster Blocks module
 *
 * Built on ApplicationV2 for Foundry VTT v14 and dnd5e 6.x.
 *
 * @export
 * @class MonsterBlock5e
 * @extends {ActorSheetV2}
 */
export default class MonsterBlock5e extends HandlebarsApplicationMixin(ActorSheetV2) {
	constructor(options = {}) {
		super(options);

		this.flagManager = new Flags(this);
		this.lastSelection = {};
		this.lastValue = undefined;

		this.prepMenus();
	}

	/** @override */
	static DEFAULT_OPTIONS = {
		classes: ["monsterblock", "sheet", "actor"],
		position: {
			width: 406,	// 406 Column width of 390, plus 8px of padding on each side.
			height: 400 // Arbitrary, the sheet is re-sized to fit its content after rendering.
		},
		window: {
			resizable: false
		},
		form: {
			submitOnChange: true,
			closeOnSubmit: false
		}
	};

	/** @override */
	static PARTS = {
		sheet: {
			template: `${TEMPLATE_PATH}/monsterblock5e.hbs`
		}
	};

	/**
	 * All the templates used as partials by the sheet.
	 *
	 * @type {string[]}
	 */
	static PARTIALS = [
		// Shared Partials
		"switches.hbs",
		"parts/switch.hbs",
		"parts/trigger.hbs",

		// Actor Sheet Sections
		"bio.hbs",
		"header.hbs",
		"main.hbs",
		"collapsibleSection.hbs",
		"sectionHeader.hbs",

		// Actor Sheet Partials
		"parts/header/identity.hbs",
		"parts/header/attributes1.hbs",
		"parts/header/abilities.hbs",
		"parts/header/attributes2.hbs",

		"parts/header/attributes/armorclass.hbs",
		"parts/header/attributes/hitpoints.hbs",
		"parts/header/attributes/movement.hbs",
		"parts/header/attributes/saves.hbs",
		"parts/header/attributes/skills.hbs",
		"parts/header/attributes/senses.hbs",
		"parts/header/attributes/damage.hbs",

		"parts/main/spellcasting.hbs",
		"parts/main/attack.hbs",
		"parts/main/legendaryActs.hbs",
		"parts/main/lairActs.hbs",

		"parts/menuItem.hbs",
		"parts/resource.hbs",
		"parts/featureBlock.hbs",
		"parts/damageRoll.hbs"
	].map(p => `${TEMPLATE_PATH}/${p}`);

	get flags() {
		return this.flagManager.flags;
	}
	get allFlags() {
		return this.flagManager.allFlags();
	}
	get defaultFlags() {
		return this.flagManager.constructor.defaultFlags;
	}

	/* -------------------------------------------- */
	/*  Rendering                                   */
	/* -------------------------------------------- */

	/**
	 * Provides the data used in Handlebars for the sheet template.
	 *
	 * @param {object} options
	 * @return {Promise<object>}
	 * @memberof MonsterBlock5e
	 * @override
	 */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		const actor = this.actor;
		const system = actor.system;

		Object.assign(context, {
			actor,
			system,
			source: system._source ?? actor._source.system,
			config: CONFIG.DND5E,
			owner: actor.isOwner,
			notOwner: !actor.isOwner,
			limited: actor.limited,
			cssClass: this.isEditable ? "editable" : "locked"
		});

		context.labels = this.prepLabels();
		context.hp = {
			...system.attributes.hp,
			average: this.constructor.averageRoll(system.attributes.hp.formula, actor.getRollData())
		};
		context.abilities = this.prepAbilities();
		context.skills = this.prepSkills();
		context.languages = this.prepLanguages();
		context.damageTraits = this.prepDamageTraits();
		context.legendary = this.prepLegendary();
		this.prepMovement(context);
		this.prepSenses(context);

		context.flags = {};
		context.allFlags = [];

		for (let flag of this.allFlags) {
			context.flags[flag.name] = flag.value;
			context.allFlags.push(flag);
		}

		context.switches = this.getSwitches(context);

		if (context.notOwner || !this.isEditable) context.flags.editing = false;
		if (!context.flags.editing) context.flags["show-delete"] = false;
		if (actor.limited) context.flags["show-bio"] = true;

		// Prepare items in the old "getData" format, then classify them.
		context.items = actor.items.contents
			.slice()
			.sort((a, b) => (a.sort || 0) - (b.sort || 0))
			.map(item => this.constructor.itemContext(item));
		new ItemPrep(this, context);

		const TextEditor = foundry.applications.ux.TextEditor.implementation;
		for (let fk of Object.keys(context.features)) {
			for (let item of context.features[fk].items) {
				const document = item.document;
				item.enrichedValue = await TextEditor.enrichHTML(document.system.description?.value ?? "", {
					secrets: (context.owner && !context.flags["hidden-secrets"]),
					rollData: document.getRollData?.() ?? {},
					relativeTo: document
				});
				const recharge = this.constructor.getRecharge(document);
				item.rechargeValue = recharge ? (Number(recharge.formula) || 6) : null;
				item.isCharged = recharge ? !recharge.uses.spent : null;
				item.activationCost = getActivities(document).find(a => a.activation?.type === "legendary")?.activation.value
					?? getActivities(document).find(a => a.activation?.value)?.activation.value;
			}
		}

		const features = context.features;
		context.info = {		// A collection of extra information used mainly for conditionals
			hasSaveProfs: this.hasSaveProfs(),
			hasSkills: this.hasSkills(),
			hasCastingFeature: Boolean(features.casting.items.length),
			hasLegendaryActions: Boolean(features.legendary.items.length),
			hasLair: Boolean(features.lair.items.length),
			hasActions: Boolean(features.attacks.items.length || features.actions.items.length || features.multiattack.items.length),
			hasBonusActions: Boolean(features.bonusActions.items.length),
			hasReactions: Boolean(features.reaction.items.length),
			hasFeatures: Boolean(features.features.items.length || features.casting.items.length || features.legResist.items.length),
			hasLoot: Boolean(features.equipment.items.length),
			vttatokenizer: Boolean(window.Tokenizer)
		};
		context.info.hasAbilities = Boolean(
			context.info.hasFeatures ||
			context.info.hasActions ||
			context.info.hasBonusActions ||
			context.info.hasReactions ||
			context.info.hasLegendaryActions ||
			context.info.hasLair ||
			context.info.hasLoot
		);

		context.menus = this.menuTrees;
		Object.values(this.menuTrees).forEach(m => m.update(m, context));

		context.themes = this.themes;

		context.sourceStringId = "DND5E.SOURCE.FIELDS.source.label";
		context.sourceLabel = system.source?.label || system.source?.custom || system.source?.book || "";

		context.portrait = this.flags["use-token-image"] ? {
			src: actor.prototypeToken?.texture?.src || actor.img,
			path: "prototypeToken.texture.src"
		} : {
			src: actor.img,
			path: "img"
		};

		context.biography = {
			value: context.source?.details?.biography?.value ?? system.details?.biography?.value ?? "",
			enriched: await TextEditor.enrichHTML(system.details?.biography?.value ?? "", {
				secrets: context.owner,
				rollData: actor.getRollData(),
				relativeTo: actor
			})
		};

		this.templateData = context;
		return context;
	}

	/**
	 * Create a plain object representing an item for use in templates.
	 * Item preparers add their own data to this object without modifying the document.
	 *
	 * @param {Item5e} item
	 * @return {object}
	 */
	static itemContext(item) {
		return {
			_id: item.id,
			id: item.id,
			name: item.name,
			img: item.img,
			type: item.type,
			system: item.system,
			flags: item.flags,
			labels: item.labels,
			document: item
		};
	}

	/**
	 * Prepare the various header labels.
	 *
	 * @return {object}
	 */
	prepLabels() {
		const system = this.actor.system;
		const formatCR = dnd5e.utils?.formatCR;
		const cr = system.details.cr;
		const xp = cr === null || cr === undefined ? 0 : (this.actor.getCRExp?.(cr) ?? system.details.xp?.value ?? 0);

		return {
			...this.actor.labels,
			type: dnd5e.documents.Actor5e.formatCreatureType?.(system.details.type) ?? system.details.type?.label ?? "",
			size: CONFIG.DND5E.actorSizes[system.traits.size]?.label ?? system.traits.size,
			cr: cr === null || cr === undefined ? "—" : (formatCR ? formatCR(cr, { narrow: false }) : String(cr)),
			xp: this.constructor.formatNumberCommas(xp),
			proficiency: this.constructor.formatModifier(system.attributes.prof ?? 0),
			armorType: system.attributes.ac.label ?? ""
		};
	}

	/**
	 * Prepare ability scores for display.
	 *
	 * @return {object}
	 */
	prepAbilities() {
		return Object.fromEntries(Object.entries(this.actor.system.abilities).map(([id, ability]) => {
			const save = typeof ability.save === "object" ? ability.save?.value : ability.save;
			return [id, {
				...ability,
				id,
				label: CONFIG.DND5E.abilities[id]?.label ?? id,
				abbr: game.i18n.localize("MOBLOKS5E.Abbr" + id),
				modLabel: this.constructor.formatModifier(ability.mod ?? 0),
				saveValue: save ?? ability.mod ?? 0,
				saveLabel: this.constructor.formatModifier(save ?? ability.mod ?? 0),
				proficient: Boolean(ability.proficient)
			}];
		}));
	}

	/**
	 * Prepare skills for display.
	 *
	 * @return {object}
	 */
	prepSkills() {
		return Object.fromEntries(Object.entries(this.actor.system.skills ?? {})
			.filter(([id]) => id in CONFIG.DND5E.skills)
			.map(([id, skill]) => [id, {
				...skill,
				id,
				label: CONFIG.DND5E.skills[id]?.label ?? id,
				abilityAbbr: game.i18n.localize(`MOBLOKS5E.Abbr${skill.ability}`),
				icon: this._getProficiencyIcon(skill.value),
				hover: CONFIG.DND5E.proficiencyLevels[skill.value],
				totalLabel: this.constructor.formatModifier(skill.total ?? 0)
			}]));
	}

	/**
	 * Prepare the list of languages and communication types.
	 *
	 * @return {string[]}
	 */
	prepLanguages() {
		const languages = this.actor.system.traits?.languages;
		const list = [...(languages?.labels?.languages ?? [])];
		for (const [key, { label }] of Object.entries(CONFIG.DND5E.communicationTypes ?? {})) {
			const data = languages?.communication?.[key];
			if (!data?.value) continue;
			const units = data.units ?? this.actor.system.attributes?.senses?.units ?? "ft";
			list.push(`${label.toLowerCase()} ${data.value} ${units}${game.i18n.localize("MOBLOKS5E.SpeedUnitAbbrEnd")}`);
		}
		return list;
	}

	/**
	 * Re-localizes the text for damage resistances, immunities, and vulnerabilities
	 * to match the working in the books, and prepares condition immunities.
	 *
	 * @return {object}
	 * @memberof MonsterBlock5e
	 */
	prepDamageTraits() {
		const Trait = dnd5e.documents.Trait;
		const traits = this.actor.system.traits;
		const result = {};

		["dv", "dr", "di"].forEach(damageSet => {
			const trait = traits[damageSet];
			if (!trait) return;
			const damageTypes = new Set(trait.value ?? []);
			const bypasses = trait.bypasses ?? new Set();
			const entry = { selected: [], physical: false, visible: false };

			if (damageTypes.has("bludgeoning") && damageTypes.has("piercing") && damageTypes.has("slashing") && bypasses.size > 0) {
				damageTypes.delete("bludgeoning");
				damageTypes.delete("piercing");
				damageTypes.delete("slashing");
				if (bypasses.size === 1 && bypasses.has("mgc")) entry.physical = game.i18n.localize("MOBLOKS5E.physicalDamage");
				else {
					const types = Array.from(bypasses).map(p => (CONFIG.DND5E.itemProperties[p]?.label ?? p).toLowerCase());
					entry.physical = game.i18n.format("MOBLOKS5E.physicalDamageBypass", {
						bypass: game.i18n.getListFormatter({ type: "disjunction" }).format(types)
					});
				}
			}

			entry.selected = [
				...Array.from(damageTypes).map(k => Trait.keyLabel(k, { trait: damageSet }) ?? k),
				...splitSemicolons(trait.custom)
			];
			entry.visible = Boolean(entry.physical || entry.selected.length > 0);
			result[damageSet] = entry;
		});

		const ci = traits.ci;
		if (ci) {
			const selected = [
				...Array.from(ci.value ?? []).map(k => Trait.keyLabel(k, { trait: "ci" }) ?? k),
				...splitSemicolons(ci.custom)
			];
			result.ci = { selected, physical: false, visible: selected.length > 0 };
		}

		return result;
	}

	/**
	 * Prepare legendary action counts.
	 *
	 * @return {object}
	 */
	prepLegendary() {
		const legact = this.actor.system.resources?.legact ?? {};
		return {
			value: legact.value ?? 0,
			max: legact.max ?? 0
		};
	}

	/**
	 * @typedef moveData
	 * A set of data about a movement speed
	 * used to generate the text to display on the sheet.
	 *
	 * @property {string} name - The name of the movement type
	 * @property {Boolean} showLabel - True if the label should be shown, otherwise the label is hidden.
	 * @property {string} label - The label for this movement speed, should not be capitalized
	 * @property {number|string} value - The speed, if zero this is set to an empty string so that nothing is displayed
	 * @property {string} unit - The unit these measurements are in, typically an abbreviation ending in a character like a period
	 */
	/**
	 * Prepares a new `movement` property on the context
	 * containing information needed to format the
	 * various movements speeds on the sheet.
	 *
	 * @param {object} context - The context object for the template.
	 * @memberof MonsterBlock5e
	 */
	prepMovement(context) {
		const movementData = this.actor.system.attributes.movement;
		const speeds = movementData.speeds ?? movementData;
		const types = Object.entries(CONFIG.DND5E.movementTypes ?? {})
			.filter(([k, config]) => !config?.hidden || k === "walk");
		const unit = (movementData.units ?? "ft") + game.i18n.localize("MOBLOKS5E.SpeedUnitAbbrEnd");

		/** @type moveData[] */
		const movement = [];
		for (const [move, config] of types) {
			const speed = Number(speeds[move]) || 0;
			const label = game.i18n.localize(config?.label ?? config ?? move);
			movement.push({
				name: move,
				fly: move == "fly",
				showLabel: move != "walk",
				label: label.toLowerCase(),
				value: speed > 0 ? speed : move != "walk" ? "" : "0",
				unit
			});
		}

		context.movement = movement.filter(m => m.value || m.name == "walk");
		context.movementSpecial = splitSemicolons(movementData.special).join(", ");
		context.hover = Boolean(movementData.hover);
	}

	/**
	 * Prepares a new `senses` property on the context
	 * containing information needed to format the
	 * various senses on the sheet.
	 *
	 * @param {object} context - The context object for the template.
	 * @memberof MonsterBlock5e
	 */
	prepSenses(context) {
		const sensesData = this.actor.system.attributes.senses ?? {};
		const ranges = sensesData.ranges ?? sensesData;
		const unit = (sensesData.units ?? "ft") + game.i18n.localize("MOBLOKS5E.SpeedUnitAbbrEnd");

		const senses = Object.entries(CONFIG.DND5E.senses ?? {}).map(([sense, config]) => {
			const range = Number(ranges[sense]) || 0;
			const label = game.i18n.localize(config?.label ?? config ?? sense);
			return {
				name: sense,
				label: label.toLowerCase(),
				value: range > 0 ? range : "",
				unit
			};
		});

		context.senses = senses.filter(s => s.value);
		context.specialSenses = {
			passivePerception: this.getPassivePerception(),
			special: { value: splitSemicolons(sensesData.special).join(", ") }
		};
	}

	listsPassPercept(senses) {
		return senses?.toLowerCase().indexOf(game.i18n.localize("MOBLOKS5E.PerceptionLocator")) > -1;
	}
	getPassivePerception() {
		return game.i18n.format("MOBLOKS5E.PassivePerception", {
			pp: this.actor.system.skills?.prc?.passive ?? 10
		});
	}

	getSwitches(context) {
		return Object.fromEntries(
			Object.entries(context.allFlags).map(([, f]) => [f.name, {
				enable: game.i18n.localize(`MOBLOKS5E.${f.name}.enable`),
				disable: game.i18n.localize(`MOBLOKS5E.${f.name}.disable`)
			}])
		);
	}

	/** @override */
	async _preFirstRender(context, options) {
		await super._preFirstRender(context, options);
		await this.constructor.preLoadTemplates();
	}

	/** @override */
	async _onFirstRender(context, options) {
		await super._onFirstRender(context, options);

		// Close any open menus when clicking elsewhere on the sheet.
		this.element.addEventListener("click", () => {
			Object.values(this.menuTrees).forEach(m => m.close());
		});
	}

	/** @override */
	async _onRender(context, options) {
		await super._onRender(context, options);

		this.applyTheme();
		this.setWindowClasses();
		this.applyFontSize();
		this.activateListeners(this.element);
		this.fitToContent();

		// Fonts, images and the window frame may still be settling on the first render, so fit again once they have.
		requestAnimationFrame(() => this.fitToContent());
	}

	/**
	 * Re-size the window to fit the stat block columns.
	 */
	fitToContent() {
		if (this.minimized) return;
		if (!this.element?.isConnected) return;
		if (this.element.closest(".grid-cell-content")) return;	// GM Screen compatibility

		const popup = new PopupHandler(
			this, 							// The Application window
			".monsterblock-body",
			this.options.position.width,	// From default options
			window.innerHeight - game.settings.get("monsterblock", "max-height-offset"),	// Configurable offset, default is 72 to give space for the macro bar and 10px of padding.
			8,								// The margins on the window content are 8px
			this.flags.scale
		);
		popup.fix();
	}

	/* -------------------------------------------- */
	/*  Menus                                       */
	/* -------------------------------------------- */

	prepMenus() {
		this.menus = [];
		this.menuTrees = {
			attributes: this.prepAttributeMenu(),
			features: this.prepFeaturesMenu(),
			skills: this.addMenu("skill-roller"),
			saves: this.addMenu("save-roller")
		};
	}
	/**
	 * @param {...*} args - Array of arguments
	 * @return {MenuTree}
	 * @memberof MonsterBlock5e
	 */
	addMenu(...args) {
		let menuTree = new MenuTree(this, ...args);
		if (!(this.menus)) this.menus = [];
		this.menus.push(menuTree);
		return menuTree;
	}
	/**
	* @return {MenuTree}
	* @memberof MonsterBlock5e
	*/
	prepFeaturesMenu() {
		let featMenu = this.addMenu("monster-features", `<i class="fa fa-plus"></i>`, undefined, undefined, ".main-section", "menu-active");

		featMenu.add(this.createFeatureAdder("feat", "MOBLOKS5E.AddFeat"));
		featMenu.add(this.createFeatureAdder("attack", "MOBLOKS5E.AddAttack"));
		featMenu.add(this.createFeatureAdder("action", "MOBLOKS5E.AddAct"));
		featMenu.add(this.createFeatureAdder("spell", "MOBLOKS5E.AddSpell"));
		featMenu.add(this.createFeatureAdder("loot", "MOBLOKS5E.AddInventory"));
		featMenu.add(this.createFeatureAdder("consumable", "MOBLOKS5E.AddConsumable"));

		if (window.QuickInsert) {
			featMenu.add(new MenuItem("trigger", {
				control: "quickInsert",
				icon: `<i class="fas fa-search"></i>`,
				label: game.i18n.localize("MOBLOKS5E.QuickInsert")
			}));
		}

		return featMenu;
	}
	createFeatureAdder(preset, label) {
		return new MenuItem("trigger", {
			control: "addFeature",
			data: { preset },
			icon: `<i class="fa fa-plus"></i>`,
			label: game.i18n.localize(label)
		});
	}
	quickInsert() {
		QuickInsert.open({
			allowMultiple: true,
			restrictTypes: ["Item"],
			onSubmit: async (item) => {
				const theItem = await fromUuid(item.uuid);
				this.actor.createEmbeddedDocuments("Item", [theItem.toObject()]);
			}
		});
	}

	/**
	 * @return {MenuTree}
	 * @memberof MonsterBlock5e
	 */
	prepAttributeMenu() {
		let attrMenu = this.addMenu("monster-attributes", `<i class="fa fa-edit"></i>`, undefined, undefined, ".monster-attributes2", "menu-active");

		attrMenu.add(this.prepareSavingThrowsMenu(attrMenu));
		attrMenu.add(this.prepSkillsMenu(attrMenu));
		attrMenu.add(this.prepDamageTypeMenu("dv", "DND5E.TRAIT.Damage.Vulnerability.title", attrMenu));
		attrMenu.add(this.prepDamageTypeMenu("dr", "DND5E.TRAIT.Damage.Resistance.title", attrMenu));
		attrMenu.add(this.prepDamageTypeMenu("di", "DND5E.TRAIT.Damage.Immunity.title", attrMenu));
		attrMenu.add(this.prepConditionTypeMenu("ci", "DND5E.TRAIT.Condition.Immunity.title", attrMenu));
		attrMenu.add(this.prepLanguageMenu("languages", "DND5E.Languages", attrMenu));

		return attrMenu;
	}
	prepareSavingThrowsMenu(attrMenu) {
		let menu = this.addMenu("saves", game.i18n.localize("MOBLOKS5E.SavingThrowS"), attrMenu);

		Object.entries(this.actor.system.abilities).forEach(([ab, ability]) => {
			let flag = Boolean(ability.proficient);
			menu.add(new MenuItem("save-toggle", {
				name: CONFIG.DND5E.abilities[ab]?.label ?? ab,
				flag, d: ab,
				target: `system.abilities.${ab}.proficient`,
				icon: flag ? '<i class="fas fa-check"></i>' : '<i class="far fa-circle"></i>'
			}, (m) => {
				m.flag = Boolean(this.actor.system.abilities[ab]?.proficient);
				m.icon = m.flag ? '<i class="fas fa-check"></i>' : '<i class="far fa-circle"></i>';
			}));
		});

		return menu;
	}
	prepSkillsMenu(attrMenu) {
		let menu = this.addMenu("skills", game.i18n.localize("MOBLOKS5E.SkillS"), attrMenu);

		Object.entries(this.actor.system.skills ?? {}).forEach(([id, skillData]) => {
			if (!(id in CONFIG.DND5E.skills)) return;
			const skill = {
				ability: skillData.ability,
				value: skillData.value,
				abilityAbbr: game.i18n.localize(`MOBLOKS5E.Abbr${skillData.ability}`),
				icon: this._getProficiencyIcon(skillData.value),
				hover: CONFIG.DND5E.proficiencyLevels[skillData.value],
				label: CONFIG.DND5E.skills[id].label
			};
			menu.add(new MenuItem("skill", { id, skill }, (m, data) => {
				const current = data.skills[m.id];
				if (!current) return;
				m.skill.icon = current.icon;
				m.skill.value = current.value;
				m.skill.hover = current.hover;
				m.skill.abilityAbbr = current.abilityAbbr;
			}));
		});

		this._skillMenu = menu;
		return menu;
	}
	prepLanguageMenu(id, label, attrMenu) {
		let menu = this.addMenu("languages", game.i18n.localize(label), attrMenu);
		this.getLanguageChecklist(id, menu, "system.traits.languages", "language-opt", CONFIG.DND5E.languages);
		return menu;
	}
	prepDamageTypeMenu(id, label, attrMenu) {
		let menu = this.addMenu(id, game.i18n.localize(label), attrMenu);
		this.getTraitChecklist(id, menu, `system.traits.${id}`, "damage-type", CONFIG.DND5E.damageTypes);
		return menu;
	}
	prepConditionTypeMenu(id, label, attrMenu) {
		let menu = this.addMenu(id, game.i18n.localize(label), attrMenu);
		const conditions = Object.fromEntries(Object.entries(CONFIG.DND5E.conditionTypes).filter(([, c]) => !c.pseudo));
		this.getTraitChecklist(id, menu, `system.traits.${id}`, "condition-type", conditions);
		return menu;
	}

	/**
	 * Check if a trait on the actor contains a value.
	 *
	 * @param {string} id  - The id of the trait
	 * @param {string} key - The value to check
	 * @return {boolean}
	 */
	traitHas(id, key) {
		const value = this.actor.system.traits?.[id]?.value;
		if (!value) return false;
		if (value instanceof Set) return value.has(key);
		if (Array.isArray(value)) return value.includes(key);
		return false;
	}

	/**
	 * This method creates MenuItems and populates the target menu for trait lists.
	 *
	 * @param {String} id - The id of the data attribute
	 * @param {MenuTree} menu - The parent menu
	 * @param {String} target - The data attribute target
	 * @param {String} itemType - The type of item
	 * @param {Object} traitList - The CONFIG.System.List of trait options.
	 * @memberof MonsterBlock5e
	 */
	getTraitChecklist(id, menu, target, itemType, traitList) {
		const labelOf = (data) => game.i18n.localize(typeof data === "string" ? data : (data?.label ?? data?.name ?? ""));
		Object.entries(traitList).forEach(([d, traitData]) => {
			const entries = traitData?.children ? Object.entries(traitData.children) : [[d, traitData]];
			for (const [key, data] of entries) {
				let flag = this.traitHas(id, key);
				menu.add(new MenuItem(itemType, {
					d: key, name: labelOf(data), flag,
					target: target,
					icon: flag ? '<i class="fas fa-check"></i>' : '<i class="far fa-circle"></i>'
				}, (m) => {
					m.flag = this.traitHas(id, key);
					m.icon = m.flag ? '<i class="fas fa-check"></i>' : '<i class="far fa-circle"></i>';
				}));
			}
		});

		menu.add(new MenuItem("custom-val", {
			d: "custom",
			name: game.i18n.localize("DND5E.Special"),
			target: target + ".custom",
			icon: "",
			value: this.actor.system.traits[id]?.custom ?? ""
		}, (m) => {
			m.value = this.actor.system.traits[id]?.custom ?? "";
		}));
	}
	/**
	 * This method creates MenuItems and populates the target menu for languages,
	 * which may be nested in groups.
	 *
	 * @param {String} id - The id of the data attribute
	 * @param {MenuTree} menu - The parent menu
	 * @param {String} target - The data attribute target
	 * @param {String} itemType - The type of item
	 * @param {Object} traitList - The CONFIG.System.List of trait options.
	 * @param {Boolean} skipCustom - Don't add the "custom" field
	 * @memberof MonsterBlock5e
	 */
	getLanguageChecklist(id, menu, target, itemType, traitList, skipCustom = false) {
		Object.entries(traitList).forEach(([d, traitData]) => {
			const isObject = typeof traitData === "object" && traitData !== null;
			const selectable = !isObject || (traitData.selectable !== false);

			// Languages have children for each subgroup of languages.
			if (selectable) {
				let flag = this.traitHas(id, d);
				menu.add(new MenuItem(itemType, {
					d, name: game.i18n.localize(isObject ? traitData.label : traitData), flag,
					target: target,
					icon: flag ? '<i class="fas fa-check"></i>' : '<i class="far fa-circle"></i>'
				}, (m) => {
					m.flag = this.traitHas(id, d);
					m.icon = m.flag ? '<i class="fas fa-check"></i>' : '<i class="far fa-circle"></i>';
				}));
			}
			if (isObject && traitData.children) {
				this.getLanguageChecklist(id, menu, target, itemType, traitData.children, true);
			}
		});

		if (!skipCustom) {
			menu.add(new MenuItem("custom-val", {
				d: "custom",
				name: game.i18n.localize("DND5E.Special"),
				target: target + ".custom",
				icon: "",
				value: this.actor.system.traits[id]?.custom ?? ""
			}, (m) => {
					m.value = this.actor.system.traits[id]?.custom ?? "";
			}));
		}
	}

	_getProficiencyIcon(level) {
		return PROFICIENCY_ICONS[level] ?? PROFICIENCY_ICONS[0];
	}

	hasSaveProfs() {
		return Object.values(this.actor.system.abilities)?.some(ability => ability.proficient);
	}
	hasSkills() {
		return Object.values(this.actor.system.skills ?? {})?.some(skill => skill.value);
	}
	hasAtWillSpells() {	// Some normal casters also have a few spells that they can cast "At will"
		return this.actor.items.some((item) => {
			return item.type === "spell" && item.system.method === "atwill";
		});
	}
	hasBonusActions() {
		return this.actor.items.some((item) => this.constructor.isBonusAction(item));
	}
	hasReactions() {
		return this.actor.items.some((item) => this.constructor.isReaction(item));
	}
	hasLair() {
		return this.actor.items.some((item) => this.constructor.isLairAction(item));
	}
	hasLegendaryActions() {
		return this.actor.items.some((item) => this.constructor.isLegendaryAction(item));
	}

	/* -------------------------------------------- */
	/*  Themes & Appearance                         */
	/* -------------------------------------------- */

	static themes = {
		"default": { name: "MOBLOKS5E.DefaultThemeName", class: "default-theme" },
		"foundry": { name: "MOBLOKS5E.FoundryThemeName", class: "foundry-theme" },
		"srd":     { name: "MOBLOKS5E.SimpleThemeName", class: "srd-theme" },
		"dark":    { name: "MOBLOKS5E.DarkThemeName", class: "dark-theme" },
		"cool":    { name: "MOBLOKS5E.CoolThemeName", class: "cool-theme" },
		"hot":     { name: "MOBLOKS5E.HotThemeName", class: "hot-theme" },
		"system":  { name: "MOBLOKS5E.SystemThemeName", class: "system-theme" },
		"custom":  { name: "MOBLOKS5E.CustomThemeName", class: "" }
	}
	get themes() {
		const themes = foundry.utils.deepClone(MonsterBlock5e.themes);
		themes.custom.class = this.flags["custom-theme-class"] ?? "";
		return themes;
	}
	get currentTheme() {
		const theme = this.flags["theme-choice"];
		return theme in MonsterBlock5e.themes ? theme : "default";
	}
	set currentTheme(t) {
		this.setCurrentTheme(t);
	}
	async setCurrentTheme(theme) {
		if (!(theme in this.themes)) return this.currentTheme;
		const result = await Flags.setFlag(this.flagManager, "theme-choice", theme);
		this.applyTheme(theme);
		return result;
	}

	/**
	 * Apply the class for the current theme to the window, removing any other theme class.
	 *
	 * @param {string} [theme]
	 */
	applyTheme(theme = this.currentTheme) {
		if (!this.element) return;
		const themes = this.themes;
		for (const t of Object.values(themes)) {
			for (const cls of String(t.class ?? "").split(/\s+/).filter(c => c)) this.element.classList.remove(cls);
		}
		for (const cls of String(themes[theme]?.class ?? "").split(/\s+/).filter(c => c)) this.element.classList.add(cls);
	}

	async pickTheme(event) {
		let value = event.currentTarget.dataset.value;

		if (value == "custom") {
			const className = event.currentTarget.nextElementSibling?.value ?? "";
			await Flags.setFlag(this.flagManager, "custom-theme-class", className);
		}

		return this.setCurrentTheme(value);
	}
	async setFontSize(event) {
		const value = parseFloat(event.currentTarget.nextElementSibling.value);

		if (isNaN(value)) {
			ui.notifications.error(game.i18n.localize("MOBLOKS5E.font-size.NaN-error"));
			throw new Error(game.i18n.localize("MOBLOKS5E.font-size.NaN-error"));
		}

		await Flags.setFlag(this.flagManager, "font-size", value);
	}

	setWindowClasses() {
		const outer = this.element;
		if (!outer) return;

		const miniBlockFlags = [
			"compact-window",
			"compact-layout",
			"compact-feats"
		];

		miniBlockFlags.forEach(flag => {
			outer.classList.toggle(flag, Boolean(this.flags[flag]));
		});
	}
	applyFontSize() {
		const outer = this.element;
		if (!outer) return;
		const size = this.flags["font-size"] || parseFloat(window.getComputedStyle(document.body).fontSize);
		outer.style.fontSize = `${size}px`;
	}

	/* -------------------------------------------- */
	/*  Sheet switching                             */
	/* -------------------------------------------- */

	async openTokenizer() {
		/* global Tokenizer */
		if (window.Tokenizer) {
			window.Tokenizer.tokenizeActor(this.actor);
		}
	}
	async resetDefaults() {
		await this.setCurrentTheme(game.settings.get("monsterblock", "default-theme"));
		return this.actor.update({ "flags.monsterblock": this.defaultFlags });
	}

	async switchToDefault() {
		const DocumentSheetConfig = foundry.applications.apps.DocumentSheetConfig;
		let defcls = DocumentSheetConfig.getSheetClassesForSubType?.("Actor", this.actor.type)?.defaultClass;

		// When Monster Blocks *is* the default, use the system default instead.
		if (!defcls || defcls == SHEET_ID) defcls = DEFAULT_NPC_SHEET_ID;

		return this.constructor.switchSheetTo(defcls, this.actor);
	}

	/**
	 * Change the sheet used by an actor.
	 *
	 * @param {string} sheetClass  - The registered id of the sheet class
	 * @param {Actor5e|object} actorOrSheet - The actor, or a sheet for the actor
	 * @return {Promise}
	 */
	static async switchSheetTo(sheetClass, actorOrSheet) {
		const actor = actorOrSheet?.documentName === "Actor" ? actorOrSheet : (actorOrSheet?.actor ?? actorOrSheet?.document);
		if (!actor) return;

		if (actor.pack || !actor.isOwner) {
			ui.notifications.warn(game.i18n.localize("MOBLOKS5E.CannotSwitchSheet"));
			return;
		}

		// Updating the core sheetClass flag makes Foundry close the current sheet and open the new one.
		return actor.setFlag("core", "sheetClass", sheetClass);
	}

	static async getQuickInserts() {
		this.CharacterSheetContext = false;
	}

	/* -------------------------------------------- */
	/*  Event Listeners                             */
	/* -------------------------------------------- */

	/**
	 * Attach event listeners to the rendered sheet.
	 *
	 * @param {HTMLElement} html
	 */
	activateListeners(html) {
		const on = (selector, event, handler) => {
			html.querySelectorAll(selector).forEach(el => el.addEventListener(event, (ev) => {
				// Mimic jQuery: make `currentTarget` point at the element the listener was bound to.
				Object.defineProperty(ev, "currentTarget", { value: el, configurable: true });
				return handler.call(this, ev);
			}));
		};

		on(".collapse-switch", "click", (event) => {
			event.preventDefault();

			const section = event.currentTarget.dataset.section;
			const collapsed = foundry.utils.deepClone(this.flagManager.flags.collapsed ?? {});

			collapsed[section] = !collapsed[section];

			this.flags.collapsed = collapsed;
		});
		on(".switch", "click", (event) => {							// Switches are the primary way that settings are applied per-actor.
			event.preventDefault();
			let control = event.currentTarget.dataset.control;			// A data attribute is used on an element with the class .switch, and it contains the name of the switch to toggle.

			let state = !this.flagManager.flags[control];	            // Get the current setting of this flag, and reverse it.
			if (debug.enabled) console.debug(`Monster Block | %cSwitching: ${control} to: ${state}`, "color: orange");

			this.flagManager.flags[control] = state;                    // Set the flag to the new state.
		});
		on(".trigger", "click", (event) => {
			event.preventDefault();
			let control = event.currentTarget.dataset.control;

			if (typeof this[control] === "function") this[control](event);
		});
		on(".switch-input", "keydown", (event) => {
			if (event.key !== "Enter") return;
			event.preventDefault();
			event.stopPropagation();
			let anchor = event.currentTarget.previousElementSibling;
			Object.defineProperty(event, "currentTarget", { value: anchor, configurable: true });

			if (typeof this[anchor.dataset.control] === "function") this[anchor.dataset.control](event);
		});
		// The text inputs in the cog menu are not part of the document, don't submit the form for them.
		on(".switch-input", "change", (event) => event.stopPropagation());

		on(".profile-image img", "click", (event) => {
			event.preventDefault();
			this.showImage(event.currentTarget.getAttribute("src"));
		});

		on("[data-roll-formula]", "click", this._onQuickRoll);

		// Special Roll Handlers
		on(".ability", "click", async (event) => {
			if (event.target.closest(".config-button, [contenteditable=true]")) return;
			event.preventDefault();
			const ability = event.currentTarget.dataset.ability;
			return this.actor.rollAbilityCheck({ ability, event });
		});
		on(".saving-throw", "click", async (event) => {
			event.preventDefault();
			const ability = event.currentTarget.dataset.ability;
			return this.actor.rollSavingThrow({ ability, event });
		});
		on(".skill", "click", async (event) => {
			event.preventDefault();
			const skill = event.currentTarget.dataset.skill;
			return this.actor.rollSkill({ skill, event });
		});

		// Item and spell "roll" handlers. Pops their chat card into chat, allowing for rolling from there.
		on(".item-name, .spell", "click", async (event) => {
			if (event.target.closest(".delete-item, [contenteditable=true]")) return;
			event.preventDefault();
			event.stopPropagation();
			let id = event.currentTarget.dataset.itemId;
			const item = this.actor.items.get(id);
			return item?.use({ event });
		});

		// Uses the built in attack roll from the item's attack activity
		on(".item-attackRoll", "click", async (event) => {
			event.preventDefault();
			event.stopPropagation();
			document.getSelection().removeAllRanges();

			const item = this.actor.items.get(event.currentTarget.dataset.itemId);
			const activity = getActivity(item, "attack");
			return activity?.rollAttack({ event });
		});

		// Uses the built in damage roll from the item's attack activity
		on(".item-damageRoll", "click", async (event) => {
			event.preventDefault();
			event.stopPropagation();
			document.getSelection().removeAllRanges();

			const versatile = event.currentTarget.dataset.versatile === "true";
			const item = this.actor.items.get(event.currentTarget.dataset.itemId);
			const activity = getActivity(item, "attack")
				?? getActivities(item).find(a => typeof a.rollDamage === "function");
			const config = { event };
			if (versatile) config.attackMode = "twoHanded";
			return activity?.rollDamage(config);
		});

		// Item editing handlers. Allows right clicking on the description of any item (features, action, etc.) to open its own sheet to edit.
		on(".item", "contextmenu", this.openItemEditor);
		on(".spell", "contextmenu", this.openSpellEditor);

		on(".select-field", "click", (event) => {
			let control = event.currentTarget;
			let selection = event.target;
			let value = selection.dataset.selectionValue;
			if (!value) return false;
			let label = control.querySelector(".select-label");

			label.innerText = selection.innerText;
			control.dataset.selectedValue = value;

			const key = control.dataset.selectKey;
			return this.actor.update({ [key]: value });
		});

		on("[contenteditable=true]", "click", (event) => {
			event.stopPropagation();
		});
		on("[contenteditable=true]", "keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				event.currentTarget.blur();
			}
		});
		on("[contenteditable=true]", "focusin", this._onFocusEditable);
		on("[contenteditable=true]", "focusout", this._onUnfocusEditable);

		on(".toggle-button", "click", (event) => {
			const el = event.currentTarget;
			const value = el.dataset.toggleValue != "true";
			el.dataset.toggleValue = value;
			return this.actor.update({ [el.dataset.toggleKey]: value });
		});

		on(".custom-trait input", "keydown", (event) => {
			if (event.key !== "Enter") return;
			event.preventDefault();
			event.currentTarget.blur();
		});

		on("[data-skill-id]", "contextmenu", this._onCycleProficiency);
		on("[data-skill-id]", "click", this._onCycleProficiency);
		on("[data-damage-type]", "click", this._onToggleDamage);
		on("[data-save-toggle]", "click", this._onToggleSave);
		on("[data-language-opt]", "click", this._onToggleLanguage);
		on("[data-condition-type]", "click", this._onToggleCondition);

		this.menus.forEach(m => m.attachHandler());

		on(".menu", "click", e => e.stopPropagation());

		on(".delete-item", "click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			const el = event.currentTarget;
			const item = this.actor.items.get(el.dataset.itemId);
			return item?.delete();
		});

		if (this.isEditable && this.flags.editing) {
			on("img[data-edit]", "contextmenu", this._onEditImage);
		}

		const key    = this.lastSelection.key    ? `[data-field-key="${this.lastSelection.key}"]` : "";
		const entity = this.lastSelection.entity ? `[data-entity="${this.lastSelection.entity}"]` : "";
		if (key) this.selectElement(html.querySelector(`${key}${entity}`));

		on(".description img, .biography img", "click", (event) => {
			event.preventDefault();
			this.showImage(event.target.src);
		});

		on(".item", "click", this.toggleExpanded);

		// Configure Special Flags
		on(".config-button", "click", this._onConfigMenu);
	}

	/**
	 * Display an image in a popout.
	 *
	 * @param {string} src
	 */
	showImage(src) {
		const ImagePopout = foundry.applications.apps.ImagePopout;
		new ImagePopout({
			src,
			uuid: this.actor.uuid,
			window: { title: this.actor.name }
		}).render({ force: true });
	}

	/**
	 * Universal way to add an element that provides a roll, just add the data attribute "data-roll-formula" with a formula in it.
	 * This handler makes "quick rolls" possible, it just takes some data stored on the HTML element, and rolls dice directly.
	 *
	 * @param {Event} event
	 */
	async _onQuickRoll(event) {
		event.preventDefault();
		event.stopPropagation();

		const el = event.currentTarget;
		const { rollFormula: formula, rollTarget: target, rollSuccess: success, rollFailure: failure, rollHandler: handler } = el.dataset;
		let flavor = el.dataset.rollFlavor ?? "";	// Optionally, you can include data-roll-flavor to add text to the message.

		// Recharge rolls use the system's own handling where available.
		if (handler === "setCharged") {
			const item = this.actor.items.get(el.dataset.itemId);
			const recharge = this.constructor.getRecharge(item);
			if (recharge?.uses.rollRecharge) {
				if (!recharge.uses.spent) return ui.notifications.info(`${item.name}: ${game.i18n.localize("DND5E.Charged")}`);
				return recharge.uses.rollRecharge({ event });
			}
		}

		let roll;
		try {
			roll = await new Roll(formula, this.actor.getRollData()).evaluate();
		}
		catch (e) {
			console.error(e);
			ui.notifications.error(e.message ?? e);
			roll = await new Roll("0").evaluate();
		}

		if (target) {
			let s = roll.total >= parseInt(target, 10);
			if (handler && typeof this[handler] === "function") await this[handler](s, event);

			flavor += `<span style="font-weight: bold; color: ${s ? "green" : "red"};">${s ? success : failure}</span>`;
		}

		return roll.toMessage({
			flavor: flavor,
			speaker: ChatMessage.getSpeaker({ actor: this.actor })
		});
	}

	toggleExpanded(event) {
		if (!this.flags["compact-feats"]) return;

		const element = event.currentTarget;
		const name = element.querySelector(".item-name");
		const id = name?.dataset.itemId;

		const item = this.actor.items.get(id);
		if (!item) return;
		const expanded = item.getFlag("monsterblock", "expanded");

		return item.setFlag("monsterblock", "expanded", !expanded);
	}

	selectInput(event) {
		let el = event.currentTarget;
		this.selectElement(el);
		this.lastSelection.key = el.dataset.fieldKey;
		this.lastSelection.entity = el.dataset.entity;
	}
	selectElement(el) {
		if (!el || !el.firstChild) return;
		let selection = window.getSelection();
		selection.removeAllRanges();
		let range = document.createRange();
		range.selectNode(el.firstChild);
		selection.addRange(range);
	}

	openItemEditor(event, d) {
		event.preventDefault();
		event.stopPropagation();
		let id = d ?? event.currentTarget.querySelector(".item-name")?.dataset.itemId;
		const item = this.actor.items.get(id);
		return item?.sheet.render({ force: true });
	}

	openSpellEditor(event, d) {
		event.preventDefault();
		event.stopPropagation();
		let id = d ?? event.currentTarget.dataset.itemId;
		const item = this.actor.items.get(id);
		return item?.sheet.render({ force: true });
	}

	_onFocusEditable(event) {
		this.lastValue = event.currentTarget.innerText;
		this.selectInput(event);
	}
	_onUnfocusEditable(event) {
		if (event.currentTarget.innerText == this.lastValue) return;
		this.lastValue = undefined;
		return this._onChangeEditable(event);
	}

	/**
	 * This method is used as an event handler when a contenteditable field is changed.
	 * Numeric values are evaluated as expressions, roll formulas are validated.
	 * If the input is attached to an item, it updates that item, otherwise the actor.
	 *
	 * @param {Event} event - The triggering event.
	 * @return {Promise}
	 * @memberof MonsterBlock5e
	 */
	async _onChangeEditable(event) {
		const input = event.currentTarget;

		input.innerText = input.innerText.replace(/\s+/gm, " ");	// Strip excess whitespace
		let value = input.innerText.trim();							// .innerText will not include any HTML tags

		const doc = input.dataset.entity ? this.actor.items.get(input.dataset.entity) : this.actor;
		if (!doc) return;
		const key = input.dataset.fieldKey;
		const dtype = input.dataset.dtype || "String";
		const current = foundry.utils.getProperty(doc, key);

		value = this.handleSpecial(key, value);

		try {
			switch (dtype) {
				case "Number":
					if (value !== "") value = evaluateExpression(value, current, this.actor.getRollData());
					break;
				case "Roll":
				case "Formula": {
					if (value && !Roll.validate(value)) throw new Error(`"${value}" is not a valid roll formula.`);
					break;
				}
			}
		}
		catch (e) {
			console.error(e);
			ui.notifications.error(e.message ?? e);
			input.innerText = current ?? "";
			return;
		}

		value = ["Text", "String", "Formula", "Roll"].includes(dtype) ? value : castType(value, dtype);
		if (dtype === "Number") input.innerText = value ?? "";	// Show the result of the expression rather than the expression
		return doc.update(this.constructor.convertDerivedValue(doc, key, value));
	}

	/**
	 * Some values (like item uses or legendary actions) are derived from a "spent" count.
	 * Convert an update to such a value into an update of the source data.
	 *
	 * @param {Document} doc
	 * @param {string} key
	 * @param {any} value
	 * @return {object} - The update data
	 */
	static convertDerivedValue(doc, key, value) {
		if (key.endsWith(".value")) {
			const base = key.slice(0, -".value".length);
			const source = doc._source;
			if (foundry.utils.hasProperty(source, `${base}.spent`) && !foundry.utils.hasProperty(source, key)) {
				const max = Number(foundry.utils.getProperty(doc, `${base}.max`)) || 0;
				const spent = Math.clamp(max - (Number(value) || 0), 0, Math.max(max, 0));
				return { [`${base}.spent`]: spent };
			}
		}
		return { [key]: value };
	}

	handleSpecial(key, value) {
		switch (key) {
			case "system.details.cr": {
				if (value.indexOf("/") > -1) {
					let cr = { "1/8": 0.125, "1/4": 0.25, "1/2": 0.5 }[value.trim()];
					return cr != undefined ? String(cr) : value;
				}
				break;
			}
		}

		return value;
	}

	/**
	 * Open a file picker to change an image.
	 *
	 * @param {Event} event
	 */
	_onEditImage(event) {
		event.preventDefault();
		event.stopPropagation();
		const img = event.currentTarget;
		const attr = img.dataset.edit;
		const current = foundry.utils.getProperty(this.actor._source, attr) ?? img.getAttribute("src");
		const FilePicker = foundry.applications.apps.FilePicker.implementation;
		const fp = new FilePicker({
			current,
			type: "image",
			callback: path => this.actor.update({ [attr]: path })
		});
		return fp.browse();
	}

	/**
	 * Open one of the system's configuration applications.
	 *
	 * @param {Event} event
	 */
	_onConfigMenu(event) {
		event.preventDefault();
		event.stopPropagation();

		const target = event.currentTarget;
		const apps = dnd5e.applications;
		const config = { document: this.actor };
		let app;

		switch (target.dataset.config) {
			case "ability": {
				const ability = target.closest("[data-ability]")?.dataset.ability;
				app = new apps.actor.AbilityConfig({ ...config, key: ability });
				break;
			}
			case "armor":
			case "armorClass":
				app = new apps.actor.ArmorClassConfig(config);
				break;
			case "type":
			case "creatureType":
				app = new apps.shared.CreatureTypeConfig(config);
				break;
			case "hitPoints":
				app = new apps.actor.HitPointsConfig(config);
				break;
			case "movement":
			case "senses":
				app = new apps.shared.MovementSensesConfig({ ...config, type: target.dataset.config });
				break;
			case "skill": {
				const skill = target.closest("[data-key]")?.dataset.key ?? target.dataset.key;
				app = new apps.actor.SkillToolConfig({ ...config, trait: "skills", key: skill });
				break;
			}
			case "spellSlots":
				app = new apps.actor.SpellSlotsConfig(config);
				break;
			case "source":
				app = new apps.shared.SourceConfig(config);
				break;
		}

		if (!app) return;
		if (typeof this.renderChild === "function") return this.renderChild(app);
		return app.render({ force: true });
	}

	/** @override */
	async close(options) {
		this.lastValue = undefined;
		this.lastSelection = {};
		this._monsterblockPositioned = false;
		return super.close(options);
	}

	/**
	 * Roll the hit points formula and set current and maximum hit points.
	 */
	async _onRollHPFormula() {
		const roll = await this.actor.rollNPCHitPoints();
		if (!roll) return;
		return this.actor.update({
			"system.attributes.hp.value": roll.total,
			"system.attributes.hp.max": roll.total
		});
	}

	/**
	 * Fallback handler for recharge rolls if the system method is unavailable.
	 *
	 * @param {boolean} success - Whether or not the roll was a success.
	 * @param {Event} event - The event object associated with this roll.
	 * @memberof MonsterBlock5e
	 */
	async setCharged(success, event) {
		if (!success) return;
		const item = this.actor.items.get(event.currentTarget.dataset.itemId);
		const recharge = this.constructor.getRecharge(item);
		if (!item || !recharge) return;
		if (recharge.uses === item.system.uses) return item.update({ "system.uses.spent": 0 });
		const activity = getActivities(item).find(a => a.uses === recharge.uses);
		return activity ? item.updateActivity?.(activity.id, { "uses.spent": 0 }) : undefined;
	}

	/* -------------------------------------------- */
	/*  Item Creation                               */
	/* -------------------------------------------- */

	async addFeature(event) {
		const preset = event.currentTarget.dataset.preset;
		const [item] = await this._onItemCreate(preset) ?? [];
		if (!item) return;
		return item.sheet.render({ force: true });
	}

	/**
	 * Build the data for a newly created item based on a preset.
	 *
	 * @param {string} preset
	 * @return {object}
	 */
	static getItemPreset(preset) {
		const activity = (type, activationType) => {
			const _id = foundry.utils.randomID();
			return { [_id]: { _id, type, activation: { type: activationType } } };
		};

		switch (preset) {
			case "attack": return {
				type: "weapon",
				system: {
					type: { value: "natural" },
					range: { reach: 5, units: "ft" },
					activities: activity("attack", "action")
				}
			};
			case "action": return {
				type: "feat",
				system: { activities: activity("utility", "action") }
			};
			case "spell": return { type: "spell", system: { level: 0 } };
			case "loot": return { type: "loot" };
			case "consumable": return { type: "consumable" };
			case "feat":
			default: return { type: "feat" };
		}
	}

	_onItemCreate(preset) {
		const itemData = this.constructor.getItemPreset(preset);
		itemData.name = game.i18n.format("DND5E.ItemNew", {
			type: game.i18n.localize(CONFIG.Item.typeLabels[itemData.type])
		});
		return this.actor.createEmbeddedDocuments("Item", [itemData]);
	}

	/* -------------------------------------------- */
	/*  Trait toggles                               */
	/* -------------------------------------------- */

	_onToggleTrait(event, key) {
		const dataset = event.currentTarget.dataset;
		const path = `${dataset[key]}.value`;
		const typ = dataset.option;
		const value = new Set(foundry.utils.getProperty(this.actor, path) ?? []);
		if (value.has(typ)) value.delete(typ);
		else value.add(typ);

		return this.actor.update({ [path]: Array.from(value) });
	}

	_onToggleDamage(event) {
		return this._onToggleTrait(event, "damageType");
	}

	_onToggleCondition(event) {
		return this._onToggleTrait(event, "conditionType");
	}

	_onToggleLanguage(event) {
		return this._onToggleTrait(event, "languageOpt");
	}

	_onToggleSave(event) {
		const dataset = event.currentTarget.dataset;
		const path = `system.abilities.${dataset.option}.proficient`;
		const value = foundry.utils.getProperty(this.actor, path);
		return this.actor.update({ [path]: value ? 0 : 1 });
	}

	_onCycleProficiency(event) {
		event.preventDefault();
		if (event.target.closest(".config-button")) return;
		const dataset = event.currentTarget.dataset;
		const path = `system.skills.${dataset.skillId}.value`;
		const value = foundry.utils.getProperty(this.actor, path) ?? 0;

		// Cycle to the next or previous skill level.
		const levels = [0, 1, .5, 2];
		const idx = Math.max(0, levels.indexOf(value));
		const next = idx + (event.type === "contextmenu" ? 3 : 1);
		const newValue = levels[next % levels.length];

		return this.actor.update({ [path]: newValue });
	}

	/* -------------------------------------------- */
	/*  Item purpose checks                         */
	/* -------------------------------------------- */

	static isMultiAttack(item) {	// Checks if the item is the multiattack action.
		let name = item.name.toLowerCase().replace(/\s+/g, "");	// Convert the name of the item to all lower case, and remove whitespace.
		return getTranslationArray("MOBLOKS5E.MultiattackLocators").some(loc => name.includes(loc));
	}

	static isLegendaryResistance(item) {
		const document = item.document ?? item;
		if (document.system?.identifier === "legendary-resistance") return true;
		return getActivities(document).some(a => Array.from(a.consumption?.targets ?? []).some(t =>
			typeof t === "string"
				? t.startsWith("resources.legres")
				: String(t?.target ?? "").startsWith("resources.legres")
		));
	}

	static activationTypes(item) {
		return getActivities(item.document ?? item).map(a => a.activation?.type).filter(t => t);
	}

	static isLegendaryAction(item) {
		return this.activationTypes(item).some(t => t === "legendary" || t === "mythic");
	}

	static isLairAction(item) {
		return this.activationTypes(item).includes("lair");
	}

	static isAction(item) {
		return this.activationTypes(item).some(t => !["none", "special", ""].includes(t));
	}

	static isBonusAction(item) {
		return this.activationTypes(item).includes("bonus");
	}

	static isReaction(item) {
		return this.activationTypes(item).includes("reaction");
	}

	/**
	 * Find the recharge configuration of an item, either on the item's uses or on one of its activities.
	 *
	 * @param {Item5e} item
	 * @return {{formula: string, uses: object}|null}
	 */
	static getRecharge(item) {
		if (!item) return null;
		const sources = [item.system?.uses, ...getActivities(item).map(a => a.uses)];
		for (const uses of sources) {
			const recharge = Array.from(uses?.recovery ?? []).find(r => r.period === "recharge");
			if (recharge) return { formula: recharge.formula, uses };
		}
		return null;
	}

	static getItemAbility(item, actor, master) {
		return master.actor.items.get(item._id)?.abilityMod;
	}

	/* -------------------------------------------- */
	/*  Formatting                                  */
	/* -------------------------------------------- */

	static formatNumberCommas(number) {
		return (number ?? 0).toString().replace(/\B(?<!\.\d*)(?=(\d{3})+(?!\d))/g, ",");	// https://stackoverflow.com/questions/2901102/how-to-print-a-number-with-commas-as-thousands-separators-in-javascript
	}
	static formatModifier(number) {
		const n = Number(number) || 0;
		return n >= 0 ? `+${n}` : `${n}`;
	}
	static averageRoll(formula, mods) {
		if (!formula) return 0;
		try {
			const rollMin = new Roll(String(formula), mods);
			const rollMax = rollMin.clone();
			return Math.floor((		// The maximum roll plus the minimum roll, divided by two, rounded down.
				rollMax.evaluateSync({ maximize: true, strict: false }).total +
				rollMin.evaluateSync({ minimize: true, strict: false }).total
			) / 2);
		}
		catch (e) {
			console.error(e);
			return 0;
		}
	}
	static handlebarsHelpers = {
		"moblok-hascontents": (obj) => { // Check if an array is empty.
			return obj && Object.keys(obj).length > 0;
		},
		"moblok-getProperty": (obj, key) => foundry.utils.getProperty(obj, key)
	}
	static async preLoadTemplates() {
		if (this._templatesLoaded) return;
		this._templatesLoaded = true;
		return foundry.applications.handlebars.loadTemplates(this.PARTIALS);
	}
}
