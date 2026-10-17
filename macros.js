// Example macros for Monster Blocks (Foundry VTT v14, dnd5e 6.x).
// Each block below is a separate macro; copy only the one you want into a script macro.

// Swap the sheet of the selected token between this and the standard 5e NPC sheet.
(async () => {
	const actor = token?.actor;
	if (!actor) return ui.notifications.warn("Select a token first.");
	const current = actor.getFlag("core", "sheetClass");
	const next = current === "dnd5e.MonsterBlock5e" ? "dnd5e.NPCActorSheet" : "dnd5e.MonsterBlock5e";
	await actor.setFlag("core", "sheetClass", next);
})();

// Set all NPC tokens on the current scene to use Monster Blocks. Swap the two sheet IDs to do the opposite.
(async () => {
	console.log("Macro | Setting all NPC token sheets to MonsterBlock5e...");
	console.time("Macro | Sheet conversion completed in");
	for (const tkn of canvas.tokens.placeables) {
		const actor = tkn.actor;
		if (actor?.type !== "npc") continue;
		if (actor.getFlag("core", "sheetClass") === "dnd5e.MonsterBlock5e") continue;
		await actor.setFlag("core", "sheetClass", "dnd5e.MonsterBlock5e");
	}
	console.log("Macro | ...Complete");
	console.timeEnd("Macro | Sheet conversion completed in");
	return true;
})();

// Changes the theme of all actors in the Actor Directory to your default setting.
// This will not effect unlinked actors in any scene.
(async () => {
	const theme = game.settings.get("monsterblock", "default-theme");
	const updates = game.actors
		.filter(a => a.flags?.monsterblock)
		.map(a => ({ _id: a.id, "flags.monsterblock.theme-choice": theme }));
	await Actor.implementation.updateDocuments(updates);
})();

// Changes the theme of all unlinked Monster Block tokens on the current scene to your default setting.
(async () => {
	const theme = game.settings.get("monsterblock", "default-theme");
	console.log("Macro | Setting all Monster Block token themes to ", theme);
	console.time("Macro | Theme conversion completed in");
	for (const tkn of canvas.tokens.placeables) {
		if (tkn.actor?.getFlag("monsterblock", "theme-choice")) {
			await tkn.actor.setFlag("monsterblock", "theme-choice", theme);
		}
	}
	console.log("Macro | ...Complete");
	console.timeEnd("Macro | Theme conversion completed in");
	return true;
})();
