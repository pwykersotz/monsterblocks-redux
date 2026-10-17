import MonsterBlock5e, { SHEET_ID } from "./scripts/dnd5e/MonsterBlock5e.js";
import { debug } from "./scripts/utilities.js";
import Flags5e from "./scripts/dnd5e/Flags5e.js";


Hooks.once("init", () => {
	Handlebars.registerHelper(MonsterBlock5e.handlebarsHelpers); // Register all the helpers needed for Handlebars

	foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, "dnd5e", MonsterBlock5e, {
		types: ["npc"],
		makeDefault: false,
		label: "MOBLOKS5E.MonsterBlocks"
	});

	console.log(`Monster Block | %cInitialized.`, "color: orange");
});

Hooks.once("setup", () => {
	if (debug.INFO) console.debug("Monster Blocks | Registering Settings");

	Object.entries(Flags5e.flagDefaults)
		.filter(([, d]) => !d.hidden)
		.forEach(([name, details]) =>
			game.settings.register(Flags5e.scope, details.setting || name, {
				name: `MOBLOKS5E.${name}.settings.name`,
				hint: `MOBLOKS5E.${name}.settings.hint`,
				scope: "world",
				config: true,
				type: details.type,
				default: details.default
			}
		)
	);

	game.settings.register("monsterblock", "max-height-offset", {
		name: "MOBLOKS5E.max-height-offset.settings.name",
		hint: "MOBLOKS5E.max-height-offset.settings.hint",
		scope: "world",
		config: true,
		type: Number,
		range: {
			min: 0,
			max: 670,
			step: 1
		},
		default: 72
	});

	const themeChoices = {};
	for (const theme in MonsterBlock5e.themes)
		themeChoices[theme] = MonsterBlock5e.themes[theme].name;

	game.settings.register("monsterblock", "default-theme", {
		name: "MOBLOKS5E.default-theme.settings.name",
		hint: "MOBLOKS5E.default-theme.settings.hint",
		scope: "world",
		config: true,
		type: String,
		choices: themeChoices,
		default: "default"
	});
});

Hooks.once("ready", () => {
	MonsterBlock5e.getQuickInserts();
	MonsterBlock5e.preLoadTemplates();
});

/**
 * Add a button to the header of the system's NPC sheet to switch to Monster Blocks.
 *
 * @param {ApplicationV2} sheet
 * @param {HTMLElement} element
 */
function addSwitchButton(sheet, element) {
	if (sheet instanceof MonsterBlock5e) return;
	if (sheet.document?.type !== "npc") return;
	if (!sheet.document.isOwner || sheet.document.pack) return;

	const header = sheet.window?.header ?? element?.querySelector?.(".window-header");
	if (!header || header.querySelector(".monsterblock-switch")) return;

	if (debug.INFO) console.log("Monster Block | Adding switch button to standard sheet");

	const button = document.createElement("button");
	button.type = "button";
	button.classList.add("header-control", "icon", "fa-solid", "fa-dragon", "monsterblock-switch");
	button.dataset.tooltip = "MOBLOKS5E.SwitchToMobloks";
	button.setAttribute("aria-label", game.i18n.localize("MOBLOKS5E.SwitchToMobloks"));
	button.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		return MonsterBlock5e.switchSheetTo(SHEET_ID, sheet.document);
	});

	const anchor = header.querySelector('[data-action="toggleControls"], [data-action="close"]');
	if (anchor) anchor.before(button);
	else header.append(button);
}

Hooks.on("renderNPCActorSheet", addSwitchButton);

Hooks.once("devModeReady", ({ registerPackageDebugFlag }) => {
	registerPackageDebugFlag("monsterblock", "level");
	if (debug.INFO) console.log(`Monster Block | Debug level: ${debug.level}`);
});
